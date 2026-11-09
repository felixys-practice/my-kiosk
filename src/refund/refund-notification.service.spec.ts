import { vi } from 'vitest';
import {
  notificationScope,
  RefundNotificationRepository,
} from './refund-notification.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetRefundNotificationQueryDto } from './dto/get-refund-notification-query.dto';
import { RefundNotificationService } from './refund-notification.service';
import { BadRequestException } from '@nestjs/common';
import type { NotificationRow } from './refund-notification.repository';
import { RefundNotificationNotFoundError } from './errors';

const notificationAt = new Date('2026-10-29T00:00:00.000Z');
function notificationRow(
  overrides: Partial<NotificationRow> = {},
): NotificationRow {
  return {
    id: 'notification',
    refundId: 'refund',
    paymentCancelId: 'attempt',
    manualRefundPayoutId: null,
    kind: 'PG_REJECTED',
    audience: 'SHOP',
    shopId: 'shop',
    recipientUserId: null,
    eventKey: '내부 사건 키',
    createdAt: notificationAt,
    receipts: [],
    ...overrides,
  };
}

function receiptStore() {
  const receipts = new Map<string, { readAt: Date }>();
  const prisma = {
    refundNotification: {
      findFirst: vi.fn().mockResolvedValue(notificationRow()),
    },
    refundNotificationReceipt: {
      createMany: vi.fn(
        (input: {
          data: { notificationId: string; userId: string; readAt: Date }[];
          skipDuplicates: boolean;
        }) => {
          const row = input.data[0];
          const key = `${row.notificationId}/${row.userId}`;
          if (receipts.has(key)) {
            if (!input.skipDuplicates) throw new Error('중복 읽음');
            return Promise.resolve({ count: 0 });
          }
          receipts.set(key, { readAt: row.readAt });
          return Promise.resolve({ count: 1 });
        },
      ),
      findUniqueOrThrow: vi.fn(
        (input: {
          where: {
            notificationId_userId: { notificationId: string; userId: string };
          };
        }) => {
          const key = `${input.where.notificationId_userId.notificationId}/${input.where.notificationId_userId.userId}`;
          return Promise.resolve(receipts.get(key));
        },
      ),
    },
  } as unknown as PrismaService;
  return {
    receipts,
    service: new RefundNotificationService(
      new RefundNotificationRepository(prisma),
    ),
  };
}

describe('환불 알림 수신 범위', () => {
  it('U258 같은 사람이 다시 읽으면 최초 읽음 시각을 보존한다', async () => {
    const store = receiptStore();
    const actor = { userId: 'owner', role: 'OWNER' };
    await store.service.read(actor, 'notification', notificationAt);
    const repeated = await store.service.read(
      actor,
      'notification',
      new Date(notificationAt.getTime() + 60000),
    );
    expect(repeated).toMatchObject({ isRead: true, readAt: notificationAt });
    expect(store.receipts.size).toBe(1);
  });
  it('U257 공동 점주가 읽어도 각 사람의 읽음은 별도 기록된다', async () => {
    const store = receiptStore();
    const otherAt = new Date(notificationAt.getTime() + 1000);
    const first = await store.service.read(
      { userId: 'owner', role: 'OWNER' },
      'notification',
      notificationAt,
    );
    const second = await store.service.read(
      { userId: 'co-owner', role: 'OWNER' },
      'notification',
      otherAt,
    );
    expect({ first, second }).toMatchObject({
      first: { isRead: true, readAt: notificationAt },
      second: { isRead: true, readAt: otherAt },
    });
    expect([...store.receipts.entries()]).toEqual([
      ['notification/owner', { readAt: notificationAt }],
      ['notification/co-owner', { readAt: otherAt }],
    ]);
  });
  it('U260 수신할 수 없는 알림은 읽음 전 조회 단계에서 찾을 수 없음으로 거절한다', async () => {
    const findVisible = vi.fn().mockResolvedValue(null);
    const service = new RefundNotificationService({
      findVisible,
    } as unknown as RefundNotificationRepository);
    await expect(
      service.getForRead(
        { userId: 'owner', role: 'OWNER' },
        'other-notification',
      ),
    ).rejects.toBeInstanceOf(RefundNotificationNotFoundError);
    expect(findVisible).toHaveBeenCalledWith(
      { userId: 'owner', role: 'OWNER' },
      'other-notification',
    );
  });
  it('U396 알림은 공개 사건 필드와 본인의 읽음만 응답하고 내부 사건 키를 노출하지 않는다', async () => {
    const repository = {
      list: vi.fn().mockResolvedValue({
        items: [
          notificationRow(),
          notificationRow({
            id: 'read',
            receipts: [{ readAt: notificationAt }],
          }),
        ],
        total: 2,
      }),
    } as unknown as RefundNotificationRepository;
    const result = await new RefundNotificationService(repository).list({
      userId: 'owner',
      role: 'OWNER',
    });
    const publicBase = {
      refundId: 'refund',
      paymentCancelId: 'attempt',
      manualRefundPayoutId: null,
      kind: 'PG_REJECTED',
      audience: 'SHOP',
      shopId: 'shop',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      message: expect.any(String),
      createdAt: notificationAt,
    };
    expect(result).toMatchObject({
      items: [
        {
          ...publicBase,
          notificationId: 'notification',
          isRead: false,
          readAt: null,
        },
        {
          ...publicBase,
          notificationId: 'read',
          isRead: true,
          readAt: notificationAt,
        },
      ],
      meta: { page: 1, limit: 20, total: 2 },
    });
    expect(JSON.stringify(result)).not.toContain('내부 사건 키');
  });
  it('U395 계산 위치가 안전한 정수 범위를 넘으면 목록 쿼리 전에 거절한다', async () => {
    const list = vi.fn();
    const repository = { list } as unknown as RefundNotificationRepository;
    await expect(
      new RefundNotificationService(repository).list(
        { userId: 'owner', role: 'OWNER' },
        Object.assign(new GetRefundNotificationQueryDto(), {
          page: Number.MAX_SAFE_INTEGER,
          limit: 100,
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });
  it('U394 audience를 지정해도 현재 역할·매장 범위를 확장하지 않는다', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      refundNotification: { findMany, count: vi.fn().mockResolvedValue(0) },
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    } as unknown as PrismaService;
    const actor = { userId: 'owner', role: 'OWNER' };
    await new RefundNotificationRepository(prisma).list(
      actor,
      Object.assign(new GetRefundNotificationQueryDto(), {
        audience: 'OPERATOR',
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [notificationScope(actor), { audience: 'OPERATOR' }] },
      }),
    );
  });
  it('U259 미읽음 필터는 요청자에게 읽음 기록이 없는 알림만 조회한다', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      refundNotification: { findMany, count: vi.fn().mockResolvedValue(0) },
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    } as unknown as PrismaService;
    const actor = { userId: 'owner', role: 'OWNER' };
    await new RefundNotificationRepository(prisma).list(
      actor,
      Object.assign(new GetRefundNotificationQueryDto(), { unreadOnly: true }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            notificationScope(actor),
            { receipts: { none: { userId: 'owner' } } },
          ],
        },
      }),
    );
  });
  it('U393 목록은 수신 범위·정렬·페이지와 본인 읽음만 DB에서 조회한다', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      refundNotification: { findMany, count: vi.fn().mockResolvedValue(0) },
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    } as unknown as PrismaService;
    const actor = { userId: 'owner', role: 'OWNER' };
    await new RefundNotificationRepository(prisma).list(
      actor,
      Object.assign(new GetRefundNotificationQueryDto(), { page: 2 }),
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { AND: [notificationScope(actor)] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 20,
      take: 20,
      include: {
        receipts: { where: { userId: 'owner' }, select: { readAt: true } },
      },
    });
  });
  it('U391 운영자는 운영자 범위 발송 또는 자기 지정 수신 알림만 조회한다', () => {
    expect(notificationScope({ userId: 'manager', role: 'MANAGER' })).toEqual({
      audience: 'OPERATOR',
      OR: [{ recipientUserId: null }, { recipientUserId: 'manager' }],
    });
  });
  it('U390 고객은 본인 주문에 대해 본인을 수신자로 지정한 알림만 조회한다', () => {
    expect(notificationScope({ userId: 'customer', role: 'USER' })).toEqual({
      audience: 'CUSTOMER',
      recipientUserId: 'customer',
      refund: { payment: { order: { userId: 'customer' } } },
    });
  });
  it('U389 점주는 현재 소유 매장의 SHOP 범위 또는 자기 지정 수신 알림만 조회한다', () => {
    expect(notificationScope({ userId: 'owner', role: 'OWNER' })).toEqual({
      audience: 'SHOP',
      shop: { owners: { some: { userId: 'owner' } } },
      OR: [{ recipientUserId: null }, { recipientUserId: 'owner' }],
    });
  });
});
