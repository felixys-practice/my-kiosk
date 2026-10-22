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
import { TicketStatus } from '@prisma/client';

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
  ) {}

  // 조회
  async getPayment(id: string) {
    return await this.paymentRepository.getPaymentById(id);
  }

  // 결재 요청
  async requestPayment(orderId: string, requesterId: string) {
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

    // 결재 실패 수신 처리
    if (!payload.success) {
      await this.paymentRepository.failedPayment(
        payment.id,
        payload.reason ?? '알수없는 실패 응답',
      );
      return;
    }

    // 결재 금액 다름 - 취소 요청
    if (payload.amount !== payment.amount) {
      await this.paymentRepository.failedPayment(
        payment.id,
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
            userId,
            type: orderItem.ticketType,
            status: TicketStatus.UNUSED,
            orderItemId: orderItem.id,
            purchasedMinutes: orderItem.purchasedMinutes!, // 구매 시간
            remainingMinutes: orderItem.purchasedMinutes!, //
            minuteExpireDeadline: addDays(now, orderItem.usableDays),
          };
        } else {
          return {
            userId,
            type: orderItem.ticketType,
            status: TicketStatus.UNUSED,
            orderItemId: orderItem.id,
            purchasedDurationDays: orderItem.purchasedDurationDays!,
            activationDeadline: addDays(now, orderItem.usableDays),
          };
        }
      });

    await this.paymentRepository.successPayment(paymentId, newTicketsData, now);
  }
}
