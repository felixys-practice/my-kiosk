import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

const refundQueryInclude = {
  payment: { include: { order: true } },
  orderItem: { include: { ticket: { select: { id: true } } } },
  paymentCancels: {
    orderBy: [
      { attemptNumber: 'desc' },
      { id: 'desc' },
    ],
  },
  manualPayouts: { orderBy: [{ reservedAt: 'desc' }, { id: 'desc' }] },
} satisfies Prisma.RefundInclude;

export type RefundQueryRow = Prisma.RefundGetPayload<{
  include: typeof refundQueryInclude;
}>;

/** 환불 확정 기록을 기준으로 조회한다. 과거 PG 취소 요청 기준 조회와 구분한다. */
@Injectable()
export class RefundQueryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(refundId: string): Promise<RefundQueryRow | null> {
    return this.prisma.refund.findUnique({
      where: { id: refundId },
      include: refundQueryInclude,
    });
  }

  findUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
  }

  findShop(shopId: string, ownerId?: string) {
    return this.prisma.shop.findFirst({
      where: {
        id: shopId,
        ...(ownerId ? { owners: { some: { userId: ownerId } } } : {}),
      },
      select: { id: true },
    });
  }

  async findMany(where: Prisma.RefundWhereInput, page: number, limit: number) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.refund.findMany({
        where,
        include: refundQueryInclude,
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.refund.count({ where }),
    ]);
    return { items, total };
  }
}
