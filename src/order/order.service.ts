import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { addMinutes } from 'date-fns';
import {
  Order,
  PaymentStatus,
  SeatReleaseReason,
  SeatType,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductNotFoundError } from 'src/product/errors/product-not-found.error';
import { SeatSelectionRequiredError } from 'src/seat-assignment/errors/seat-selection-required.error';
import { SeatShopMismatchError } from 'src/seat-assignment/errors/seat-shop-mismatch.error';
import { SeatTypeMismatchError } from 'src/seat-assignment/errors/seat-type-mismatch.error';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { DuplicateSeatInOrderError } from './errors/duplicate-seat-in-order.error';
import { OrderAlreadyPaidError } from './errors/order-already-paid.error';
import { OrderNotFoundError } from './errors/order-not-found.error';
import { FixedSeatQuantityError } from './errors/fixed-seat-quantity.error';
import { SeatNotAllowedError } from './errors/seat-not-allowed.error';
import { OrderRepository } from './order.repository';
import { TicketService } from 'src/ticket/ticket.service';
import { CreateOrderItemData, OrderOutData } from './order.types';

type OrderRow = Awaited<ReturnType<OrderRepository['getOrder']>>[number];

@Injectable()
export class OrderService {
  constructor(
    private readonly repository: OrderRepository,
    private readonly ticketService: TicketService,
    private readonly prisma: PrismaService,
    private readonly seatAssignmentService: SeatAssignmentService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 주문과 주문 항목을 만든다
   * @param shopId 매장 ID
   * @param userId 주문자 ID
   * @param products 주문 상품·수량·고정석 좌석
   * @returns 저장한 주문
   * @throws ProductNotFoundError 판매 중이 아닌 상품이 있을 때
   * @throws SeatSelectionRequiredError 고정석 상품 주문 항목에 좌석이 없을 때
   * @throws FixedSeatQuantityError 고정석 상품 주문 항목의 수량이 1이 아닐 때
   * @throws SeatShopMismatchError 고정석 상품 주문 항목의 좌석이 다른 매장 좌석이거나 없을 때
   * @throws SeatTypeMismatchError 고정석 상품 주문 항목의 좌석이 자유석일 때
   * @throws SeatNotAllowedError 자유석 상품 주문 항목에 좌석이 있을 때
   * @throws DuplicateSeatInOrderError 한 주문에서 같은 좌석을 중복 선택했을 때
   */
  async createOrder(
    shopId: string,
    userId: string,
    products: { productId: string; quantity: number; seatId?: string }[],
  ): Promise<Order> {
    return await this.prisma.executeTransaction(async (tx) => {
      // 상품들 상세 정보 조회
      const queriedProducts = await this.repository.findActiveProducts(
        products.map((item) => item.productId),
        tx,
      );

      // 고정석 주문 항목에 지정된 좌석 조회
      const seatIds = products
        .map((item) => item.seatId)
        .filter((seatId): seatId is string => seatId !== undefined);
      const seats =
        seatIds.length > 0 ? await this.repository.findSeats(seatIds, tx) : [];

      // 한 주문에서 같은 좌석을 두 번 고를 수 없다
      if (new Set(seatIds).size !== seatIds.length) {
        throw new DuplicateSeatInOrderError();
      }

      // 고정석 주문 항목의 선점 대상(주문 항목 ID ↔ 좌석)
      const holds: { orderItemId: string; seatId: string }[] = [];

      // orderItems 데이터 생성
      const createOrderItems = products.reduce<CreateOrderItemData[]>(
        (acc, product) => {
          const foundProduct = queriedProducts.find(
            (p) => p.id === product.productId,
          );
          if (!foundProduct) {
            throw new ProductNotFoundError(
              `상품을 찾을 수 없습니다: ${product.productId}`,
            );
          }

          // 고정석 상품은 좌석 선택이 필수다(FR-007)
          if (foundProduct.seatType === SeatType.FIXED && !product.seatId) {
            throw new SeatSelectionRequiredError();
          }

          // 고정석 상품은 좌석 하나에 한 개씩 주문한다
          if (
            foundProduct.seatType === SeatType.FIXED &&
            product.quantity !== 1
          ) {
            throw new FixedSeatQuantityError();
          }

          // 고정석 상품의 좌석은 이 매장 좌석이어야 한다(조회되지 않는 좌석 포함)
          const seat = seats.find((item) => item.id === product.seatId);
          if (
            foundProduct.seatType === SeatType.FIXED &&
            (!seat || seat.shopId !== shopId)
          ) {
            throw new SeatShopMismatchError();
          }

          // 고정석 상품은 고정석 타입 좌석만 고를 수 있다
          if (
            foundProduct.seatType === SeatType.FIXED &&
            seat?.type === SeatType.FREE
          ) {
            throw new SeatTypeMismatchError(
              '고정석 상품은 고정석 좌석을 선택해야 합니다',
            );
          }

          // 자유석 상품에는 좌석을 지정하지 않는다
          if (foundProduct.seatType === SeatType.FREE && product.seatId) {
            throw new SeatNotAllowedError();
          }

          // TODO: 나중에 할인 데이터 받아와서 추가
          const discountAmount = 0;

          for (let i = 0; i < product.quantity; i++) {
            const orderItemId = randomUUID();
            if (foundProduct.seatType === SeatType.FIXED && product.seatId) {
              holds.push({ orderItemId, seatId: product.seatId });
            }
            acc.push({
              id: orderItemId,
              ticketType: foundProduct.ticketType,
              seatType: foundProduct.seatType,
              originalAmount: foundProduct.amount,
              discountAmount: discountAmount,
              amount: foundProduct.amount - discountAmount,
              purchasedMinutes: foundProduct.purchasedMinutes,
              purchasedDurationDays: foundProduct.purchasedDurationDays,
              productId: foundProduct.id,
              usableDays: foundProduct.usableDays,
            });
          }
          return acc;
        },
        [],
      );

      // 주문 금액 계산
      const { originalAmount, discountAmount, totalAmount } =
        createOrderItems.reduce(
          (acc, orderItem) => {
            return {
              originalAmount: acc.originalAmount + orderItem.amount,
              discountAmount: acc.discountAmount + orderItem.discountAmount,
              totalAmount:
                acc.totalAmount + orderItem.amount - orderItem.discountAmount,
            };
          },
          { originalAmount: 0, discountAmount: 0, totalAmount: 0 },
        );

      // order + orderItem 데이터 생성
      const order = await this.repository.createOrderWithItems(
        {
          shopId,
          userId,
          originalAmount,
          discountAmount,
          totalAmount,
          orderItems: createOrderItems,
        },
        tx,
      );

      // 같은 트랜잭션에서 고정석 주문 항목마다 좌석을 선점한다(research R2·R4)
      const now = new Date();
      const holdMinutes = this.configService.get<number>('seat.holdMinutes')!;
      for (const hold of holds) {
        await this.seatAssignmentService.hold(
          {
            seatId: hold.seatId,
            shopId,
            orderItemId: hold.orderItemId,
            heldUntil: addMinutes(now, holdMinutes),
          },
          now,
          tx,
        );
      }

      return order;
    });
  }

  /**
   * 주문을 취소하고 고정석 선점을 즉시 해제한다(research R2)
   * @param orderId 주문 ID
   * @returns 없음
   * @throws OrderNotFoundError 주문이 없을 때
   * @throws OrderAlreadyPaidError 결제가 이미 성공한 주문일 때
   */
  async cancelOrder(orderId: string): Promise<void> {
    await this.prisma.executeTransaction(async (tx) => {
      // 주문 항목 조회
      const order = await this.repository.findOrderWithPayments(orderId, tx);

      // 주문이 없으면 404
      if (!order) throw new OrderNotFoundError();

      // 결제가 끝난 주문은 취소 대신 환불 API를 쓴다
      if (order.payments.some((p) => p.status === PaymentStatus.SUCCESS)) {
        throw new OrderAlreadyPaidError();
      }

      // 주문 항목의 선점을 해제한다(이미 해제됐으면 그대로 성공, 멱등)
      await this.seatAssignmentService.releaseByOrderItems(
        order.orderItems.map((item) => item.id),
        SeatReleaseReason.ORDER_CANCELLED,
        new Date(),
        tx,
      );
    });
  }

  async getOrder(id?: string, shopId?: string, userId?: string) {
    const orders = await this.repository.getOrder(id, shopId, userId);
    return orders.map((order) => this.toOrderOutData(order));
  }

  private toOrderOutData(order: OrderRow): OrderOutData {
    return {
      id: order.id,
      shopId: order.shopId,
      userId: order.userId,
      originalAmount: order.originalAmount,
      discountAmount: order.discountAmount,
      totalAmount: order.totalAmount,
      orderItems: order.orderItems.map((item) => ({
        productId: item.productId,
        originalAmount: item.originalAmount,
        discountAmount: item.discountAmount,
        amount: item.amount,
        purchasedMinutes: item.purchasedMinutes,
        purchasedDurationDays: item.purchasedDurationDays,
        ticket: item.ticket
          ? this.ticketService.toTicketSummaryOutData(item.ticket)
          : null,
      })),
      payments: order.payments.map((payment) => ({
        type: payment.type,
        status: payment.status,
        amount: payment.amount,
        approvedAt: payment.approvedAt,
      })),
    };
  }
}
