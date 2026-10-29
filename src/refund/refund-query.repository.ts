import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

const refundQueryInclude = {
  payment: { include: { order: true } },
  orderItem: { include: { ticket: { select: { id: true } } } },
  paymentCancels: {
    orderBy: [
      { attemptNumber: { sort: 'desc', nulls: 'last' } },
      { id: 'desc' },
    ],
  },
} satisfies Prisma.RefundInclude;

export type RefundQueryRow = Prisma.RefundGetPayload<{
  include: typeof refundQueryInclude;
}>;

/** 환불 확정 기록을 기준으로 조회한다. 과거 PG 취소 요청 기준 조회와 구분한다. */
@Injectable()
export class RefundQueryRepository {
  constructor(private readonly prisma: PrismaService) {}

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
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.refund.count({ where }),
    ]);
    return { items, total };
  }
}
