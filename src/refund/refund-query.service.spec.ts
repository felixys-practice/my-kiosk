import { PrismaService } from 'src/prisma/prisma.service';
import { RefundQueryRepository } from './refund-query.repository';
import type { RefundQueryRow } from './refund-query.repository';
import { RefundQueryService } from './refund-query.service';

const at = new Date('2026-10-29T00:00:00.000Z');
/** 조회 응답에 쓰이는 필드만 가진 저장소 경계 대역이다. 실제 DB 형식은 HTTP 테스트로 확인한다. */
function refundRow(overrides: Partial<RefundQueryRow> = {}): RefundQueryRow {
  return {
    id: 'refund',
    paymentId: 'payment',
    orderItemId: 'item',
    targetKind: 'ORDER_ITEM',
    source: 'CUSTOMER',
    decisionStatus: 'ACCEPTED',
    policyVersion: 'v0.4',
    amount: 1000,
    paidAmount: 0,
    payoutStatus: 'PENDING',
    payoutMethod: 'PG',
    reviewRequired: false,
    actionCode: null,
    actionReason: null,
    requestedAt: at,
    acceptedAt: at,
    terminatedAt: at,
    paidAt: null,
    payment: { order: { shopId: 'shop', userId: 'customer' } },
    orderItem: { ticket: { id: 'ticket' } },
    paymentCancels: [],
    manualPayouts: [],
    ...overrides,
  } as RefundQueryRow;
}

describe('환불 조회', () => {
  it('U246 지급 합계로 미지급액과 초과액을 계산하고 음수를 표시하지 않는다', async () => {
    const items = [0, 700, 1300].map((paidAmount) => refundRow({ paidAmount }));
    const repository = {
      findMany: jest.fn().mockResolvedValue({ items, total: items.length }),
    } as unknown as jest.Mocked<RefundQueryRepository>;
    const result = await new RefundQueryService(repository).byMe({
      userId: 'customer',
      role: 'USER',
    });
    expect(
      result.items.map(({ outstandingAmount, overpaidAmount }) => ({
        outstandingAmount,
        overpaidAmount,
      })),
    ).toEqual([
      { outstandingAmount: 1000, overpaidAmount: 0 },
      { outstandingAmount: 300, overpaidAmount: 0 },
      { outstandingAmount: 0, overpaidAmount: 300 },
    ]);
  });
  it('U244 권한 있는 매장에 환불이 없으면 빈 목록과 페이지 메타를 반환한다', async () => {
    const repository = {
      findShop: jest.fn().mockResolvedValue({ id: 'shop' }),
      findMany: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    } as unknown as jest.Mocked<RefundQueryRepository>;
    await expect(
      new RefundQueryService(repository).byShop(
        { userId: 'owner', role: 'OWNER' },
        'shop',
      ),
    ).resolves.toMatchObject({
      items: [],
      meta: { page: 1, limit: 20, total: 0 },
    });
  });
  it('U239 페이지를 자르기 전에 신청 시각과 환불 ID 내림차순을 DB에 지정한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      refund: { findMany, count: jest.fn().mockResolvedValue(0) },
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    } as unknown as PrismaService;
    await new RefundQueryRepository(prisma).findMany({}, 2, 20);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        skip: 20,
        take: 20,
      }),
    );
  });
});
