import {
  notificationScope,
  RefundNotificationRepository,
} from './refund-notification.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetRefundNotificationQueryDto } from './dto/get-refund-notification-query.dto';

describe('환불 알림 수신 범위', () => {
  it('U259 미읽음 필터는 요청자에게 읽음 기록이 없는 알림만 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      refundNotification: { findMany, count: jest.fn().mockResolvedValue(0) },
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
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      refundNotification: { findMany, count: jest.fn().mockResolvedValue(0) },
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
