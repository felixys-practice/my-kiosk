import { Injectable } from '@nestjs/common';
import {
  Order,
  PaymentStatus,
  Product,
  SeatType,
  UsageSessionStatus,
} from '@prisma/client';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';
import { MissingOrderFilterError } from './errors/missing-order-filter.error';
import { CreateOrderWithItemsData } from './order.types';

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 판매 중인(활성·미삭제) 상품을 조회한다
   * @param productIds 상품 ID 목록
   * @param tx 트랜잭션 클라이언트
   * @returns 조회된 상품 목록
   */
  async findActiveProducts(
    productIds: string[],
    tx: TransactionClient,
  ): Promise<Product[]> {
    return tx.product.findMany({
      where: {
        id: { in: productIds },
        isActive: true,
        deletedAt: null,
      },
    });
  }

  /**
   * 주문 항목에 지정된 좌석을 조회한다
   * @param seatIds 좌석 ID 목록
   * @param tx 트랜잭션 클라이언트
   * @returns 좌석의 ID·매장·타입 목록
   */
  async findSeats(
    seatIds: string[],
    tx: TransactionClient,
  ): Promise<{ id: string; shopId: string; type: SeatType }[]> {
    return tx.seat.findMany({
      where: { id: { in: seatIds } },
      select: { id: true, shopId: true, type: true },
    });
  }

  /**
   * 취소할 주문을 주문 항목 ID·결제 상태와 함께 조회한다
   * @param orderId 주문 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 주문(주문 항목 ID, 결제 상태 포함), 없으면 null
   */
  async findOrderWithPayments(
    orderId: string,
    tx: TransactionClient,
  ): Promise<{
    id: string;
    orderItems: { id: string }[];
    payments: { status: PaymentStatus }[];
  } | null> {
    return tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderItems: { select: { id: true } },
        payments: { select: { status: true } },
      },
    });
  }

  /**
   * 주문과 주문 항목을 함께 저장한다
   * @param data 주문 데이터(주문 항목 포함)
   * @param tx 트랜잭션 클라이언트
   * @returns 저장한 주문
   */
  async createOrderWithItems(
    data: CreateOrderWithItemsData,
    tx: TransactionClient,
  ): Promise<Order> {
    return tx.order.create({
      data: {
        shopId: data.shopId,
        userId: data.userId,
        originalAmount: data.originalAmount,
        discountAmount: data.discountAmount,
        totalAmount: data.totalAmount,
        orderItems: { create: data.orderItems },
      },
    });
  }

  async getOrder(id?: string, shopId?: string, userId?: string) {
    if (!id && !shopId && !userId) {
      throw new MissingOrderFilterError();
    }
    return await this.prisma.order.findMany({
      where: {
        ...(id && { id }),
        ...(shopId && { shopId }),
        ...(userId && { userId }),
      },
      select: {
        id: true,
        shopId: true,
        userId: true,
        originalAmount: true,
        discountAmount: true,
        totalAmount: true,
        orderItems: {
          select: {
            productId: true,
            originalAmount: true,
            discountAmount: true,
            amount: true,
            purchasedMinutes: true,
            purchasedDurationDays: true,
            ticket: {
              select: {
                id: true,
                type: true,
                status: true,
                usageSessions: {
                  where: { status: UsageSessionStatus.ACTIVE },
                  select: {
                    status: true,
                    seat: { select: { number: true } },
                  },
                },
                ticketPauses: {
                  where: { resumedAt: null },
                  select: { pausedAt: true },
                },
              },
            },
          },
        },
        payments: {
          where: { status: PaymentStatus.SUCCESS },
          select: {
            type: true,
            status: true,
            amount: true,
            approvedAt: true,
          },
        },
      },
    });
  }
}
