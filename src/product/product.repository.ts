import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreatePeriodProductData,
  CreateTimeProductData,
  ProductForUpdate,
  ProductHistoryRow,
  UpdatableProductFields,
} from './product.type';
import { TicketType } from '@prisma/client';
import { GetProductOutDto } from './dto';
import { PaginationUtil } from 'src/common/pagination/pagination.util';
import {
  PaginationOptions,
  PaginationResult,
} from 'src/common/pagination/pagination.types';

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createProduct(
    shopId: string,
    data: CreatePeriodProductData | CreateTimeProductData,
  ): Promise<string> {
    const product = await this.prisma.product.create({
      data: {
        shop: { connect: { id: shopId } },
        name: data.name,
        ticketType: data.ticketType,
        amount: data.amount,
        usableDays: data.usableDays,
        isActive: data.isActive,
        seatType: data.seatType,
        purchasedMinutes:
          data.ticketType === 'TIME' ? data.purchasedMinutes : undefined,
        purchasedDurationDays:
          data.ticketType === 'PERIOD' ? data.purchasedDurationDays : undefined,
      },
    });
    return product.id;
  }

  /**
   * 수정할 상품을 조회한다(삭제되지 않은 해당 매장 상품만)
   * @param shopId 매장 ID
   * @param productId 상품 ID
   * @returns 상품의 현재 값, 없으면 null
   */
  async findProductForUpdate(
    shopId: string,
    productId: string,
  ): Promise<ProductForUpdate | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, shopId, deletedAt: null },
      select: {
        id: true,
        name: true,
        ticketType: true,
        amount: true,
        usableDays: true,
        isActive: true,
        purchasedMinutes: true,
        purchasedDurationDays: true,
        seatType: true,
      },
    });
  }

  /**
   * 상품을 수정하고 변경 이력을 같은 트랜잭션에서 저장한다
   * @param productId 상품 ID
   * @param data 바꿀 필드
   * @param histories 저장할 변경 이력 행
   * @returns 없음
   */
  async updateProductWithHistories(
    productId: string,
    data: UpdatableProductFields,
    histories: ProductHistoryRow[],
  ): Promise<void> {
    await this.prisma.executeTransaction(async (tx) => {
      // 상품 갱신
      await tx.product.update({ where: { id: productId }, data });

      // 바뀐 필드마다 이력 1행
      await tx.productHistory.createMany({
        data: histories.map((history) => ({ ...history, productId })),
      });
    });
  }

  async getProduct(
    shopId: string,
    options: {
      ticketType?: TicketType;
      paginationOptions: Required<PaginationOptions>;
    },
  ): Promise<PaginationResult<GetProductOutDto>> {
    const { page, limit, sortBy, sortOrder } = options.paginationOptions;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where: { shopId, ticketType: options.ticketType },
        select: {
          id: true,
          name: true,
          ticketType: true,
          amount: true,
          purchasedMinutes: true,
          purchasedDurationDays: true,
          usableDays: true,
          isActive: true,
          seatType: true,
          createdAt: true,
        },
        orderBy: [{ [sortBy]: sortOrder }],
        skip,
        take: limit,
      }),
      this.prisma.product.count(),
    ]);
    const meta = PaginationUtil.createMeta(page, limit, total);

    return { items, meta };
  }
}
