import { Injectable } from '@nestjs/common';
import { PaymentRepository } from './payment.repository';
import { PgPayload, PeriodPaymentData, TimePaymentData } from './payment.types';
import {
  PaymentAmountMismatchError,
  PaymentNotFoundError,
  PaymentAlreadyClosedError,
} from './errors';
import { OrderItemRepository } from 'src/order-item/order-item.repository';
import { addDays } from 'date-fns';
import { SeatReleaseReason, SeatType, TicketStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { SeatHoldExpiredError } from 'src/seat-assignment/errors/seat-hold-expired.error';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { RefundService } from 'src/refund/refund.service';
import { TransactionLoggerService } from 'src/logger/transaction-logger.service';
import { PrismaService } from 'src/prisma/prisma.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const requestVan = async (paymentId: string) => {
  if (Math.random() < 0.3) {
    await sleep(100);
  }
  return { pgTransactionId: paymentId };
};

@Injectable()
export class PaymentService {
  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly orderItemRepository: OrderItemRepository,
    private readonly prisma: PrismaService,
    private readonly seatAssignmentService: SeatAssignmentService,
    private readonly refundService: RefundService,
    private readonly transactionLogger: TransactionLoggerService,
  ) {}

  // 조회
  async getPayment(id: string) {
    return await this.paymentRepository.getPaymentById(id);
  }

  // 결재 요청
  async requestPayment(orderId: string, requesterId: string) {
    // step 0. 고정석 선점이 유효한지 확인한다(research R12-C)
    await this.assertSeatHoldsValid(orderId);

    // step 1. payment 생성
    const payment = await this.paymentRepository.createPayment(
      orderId,
      requesterId,
      'KCP',
      new Date(),
    );

    try {
      // step 2. van사에 승인 요청
      const { pgTransactionId } = await requestVan(payment.id);

      // step 3. payment 요청 성공 상태 업데이트
      await this.paymentRepository.requestedPayment(
        payment.id,
        pgTransactionId,
      );
      return { paymentId: payment.id };
    } catch (error) {
      let errorMessage = 'van사 결재 승인 요청 중 에러 발생';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      // step 3. payment 요청 싪패 상태 업데이트
      await this.paymentRepository.failedPayment(payment.id, errorMessage);
      throw Error;
    }
  }

  async callbackPayment(payload: PgPayload): Promise<void> {
    const payment = await this.paymentRepository.getPaymentByPgTransactionId(
      payload.pgTransactionId,
    );

    if (!payment) {
      throw new PaymentNotFoundError(payload.pgTransactionId);
    }

    // 이미 완결된 결재인지 확인
    if (payment.status === 'SUCCESS') {
      return;
    } else if (payment.status === 'CANCELLED' || payment.status === 'FAILED') {
      if (payload.success) {
        throw new PaymentAlreadyClosedError(payment.id, payment.status);
      }
      // 종결 상태인 결제의 재처리 방지(updatedAt이나 실패 이유 변경 방지)
      return;
    }

    // 결재 실패 수신 처리 - 결제 실패와 좌석 선점 해제를 한 트랜잭션으로 처리한다
    if (!payload.success) {
      await this.failPaymentAndReleaseHolds(
        payment.id,
        payment.order.id,
        payload.reason ?? '알수없는 실패 응답',
      );
      return;
    }

    // 결재 금액 다름 - 결제 실패 처리와 좌석 선점 해제 후 예외(기존 예외는 유지)
    if (payload.amount !== payment.amount) {
      await this.failPaymentAndReleaseHolds(
        payment.id,
        payment.order.id,
        `결재 금액이 일치하지 않습니다: (승인금액:${payload.amount})`,
      );
      throw new PaymentAmountMismatchError(payment.id);
    }

    /** 승인 처리 */
    // payment 승인 상태 업데이트 + 티켓 생성
    await this.successPayment(
      payment.id,
      payment.order.id,
      payment.order.userId,
    );
  }

  /**
   * 결제 요청 전에 주문의 고정석 선점이 모두 유효한지 확인한다
   * - 만료된 선점은 HOLD_EXPIRED로 해제하고, 해제가 롤백되지 않도록 커밋한 뒤 예외를 던진다
   * @param orderId 주문 ID
   * @returns 없음
   * @throws SeatHoldExpiredError 만료·해제된 선점이 있을 때
   */
  private async assertSeatHoldsValid(orderId: string): Promise<void> {
    // 고정석 주문 항목만 확인 대상
    const orderItems = await this.orderItemRepository.getOrderItem(orderId);
    const fixedItemIds = orderItems
      .filter((item) => item.seatType === SeatType.FIXED)
      .map((item) => item.id);
    if (fixedItemIds.length === 0) return;

    // 만료된 선점 해제(커밋)
    const invalidItemIds = await this.prisma.executeTransaction((tx) =>
      this.seatAssignmentService.releaseInvalidHolds(
        fixedItemIds,
        new Date(),
        tx,
      ),
    );

    // 커밋 후 거부
    if (invalidItemIds.length > 0) throw new SeatHoldExpiredError();
  }

  /**
   * 결제를 실패로 바꾸고 주문 항목의 좌석 선점을 해제한다
   * @param paymentId 결제 ID
   * @param orderId 주문 ID
   * @param reason 실패 사유
   * @returns 없음
   */
  private async failPaymentAndReleaseHolds(
    paymentId: string,
    orderId: string,
    reason: string,
  ): Promise<void> {
    // 주문 항목 조회
    const orderItems = await this.orderItemRepository.getOrderItem(orderId);

    await this.prisma.executeTransaction(async (tx) => {
      // 결제 실패 기록
      await this.paymentRepository.failedPayment(paymentId, reason, tx);

      // 선점 해제(이미 해제됐으면 그대로 성공, 멱등)
      await this.seatAssignmentService.releaseByOrderItems(
        orderItems.map((item) => item.id),
        SeatReleaseReason.PAYMENT_FAILED,
        new Date(),
        tx,
      );
    });
  }

  // 결재 승인 처리
  private async successPayment(
    paymentId: string,
    orderId: string,
    userId: string,
  ) {
    const orderItems = await this.orderItemRepository.getOrderItem(orderId);

    if (orderItems.length === 0) {
      throw new Error('');
    }

    const now = new Date();
    const newTicketsData: (TimePaymentData | PeriodPaymentData)[] =
      orderItems.map((orderItem) => {
        if (orderItem.ticketType === 'TIME') {
          return {
            id: randomUUID(),
            userId,
            type: orderItem.ticketType,
            status: TicketStatus.UNUSED,
            orderItemId: orderItem.id,
            seatType: orderItem.seatType,
            purchasedMinutes: orderItem.purchasedMinutes!, // 구매 시간
            remainingMinutes: orderItem.purchasedMinutes!, //
            minuteExpireDeadline: addDays(now, orderItem.usableDays),
          };
        } else {
          return {
            id: randomUUID(),
            userId,
            type: orderItem.ticketType,
            status: TicketStatus.UNUSED,
            orderItemId: orderItem.id,
            seatType: orderItem.seatType,
            purchasedDurationDays: orderItem.purchasedDurationDays!,
            activationDeadline: addDays(now, orderItem.usableDays),
          };
        }
      });

    // 결제 승인·이용권 생성·고정석 배정 확정을 한 트랜잭션으로 처리한다
    const unassignedTicketIds = await this.prisma.executeTransaction(
      async (tx) => {
        await this.paymentRepository.approvePayment(paymentId, now, tx);
        await this.paymentRepository.createTickets(
          paymentId,
          newTicketsData,
          tx,
        );

        // 고정석 주문 항목의 선점을 발급한 이용권에 확정한다
        const failedTicketIds: string[] = [];
        for (const orderItem of orderItems) {
          if (orderItem.seatType !== SeatType.FIXED) continue;
          const ticket = newTicketsData.find(
            (data) => data.orderItemId === orderItem.id,
          )!;
          const activated =
            await this.seatAssignmentService.activateByOrderItem(
              orderItem.id,
              ticket.id,
              now,
              tx,
            );
          // 좌석이 다른 이용권에 넘어가 확정하지 못한 이용권
          if (!activated) failedTicketIds.push(ticket.id);
        }
        return failedTicketIds;
      },
    );

    // 커밋 후 좌석을 줄 수 없는 이용권을 자동 환불한다(research R12-A)
    // 자동 취소 요청이 실패해도 결제 승인은 이미 확정됐으므로 콜백은 성공으로 처리하고 거래 로그로 남긴다
    for (const ticketId of unassignedTicketIds) {
      try {
        await this.refundService.refundBySystem(
          ticketId,
          '좌석 선점 만료로 좌석 배정 불가 - 자동 결제 취소',
        );
      } catch (error) {
        this.transactionLogger.logTransaction({
          transactionId: paymentId,
          type: 'REFUND',
          userId,
          orderId,
          status: 'SYSTEM_REFUND_REQUEST_FAILED',
          metadata: {
            ticketId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }
}
