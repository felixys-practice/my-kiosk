import { PrismaService } from 'src/prisma/prisma.service';
import { RefundQueryRepository } from './refund-query.repository';
import { RefundQueryService } from './refund-query.service';

describe('환불 조회', () => {
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
