import { Injectable } from '@nestjs/common';
import { PaymentStatus, PaymentType, Prisma, VanType } from '@prisma/client';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';
import {
  DuplicatePaymentRequestError,
  PaymentRequesterMismatchError,
} from './errors';
import { PeriodPaymentData, TimePaymentData } from './payment.types';
import { PaymentUpdateError } from './errors/payment-update.error';

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPayment(
    orderId: string,
    requesterId: string,
    van: VanType,
    now: Date,
  ) {
    return this.prisma.executeTransaction(async (tx) => {
      // 주문 정보 가져오기
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { totalAmount: true, userId: true },
      });

      // 주문자와 요청자 아이디가 같은지 확인
      if (order.userId !== requesterId) {
        throw new PaymentRequesterMismatchError(orderId);
      }

      // 이중 결재 요청 제한
      const payment = await tx.payment.findMany({
        where: {
          orderId,
          status: {
            in: [
              PaymentStatus.PENDING,
              PaymentStatus.REQUESTED,
              PaymentStatus.SUCCESS,
            ],
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (payment.length > 0) {
        throw new DuplicatePaymentRequestError(orderId);
      }

      return await tx.payment.create({
        data: {
          type: PaymentType.CARD,
          status: PaymentStatus.PENDING,
          amount: order.totalAmount,
          orderId,
          van,
          requestedAt: now,
        },
      });
    });
  }

  async requestedPayment(paymentId: string, pgTransactionId: string) {
    return await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.REQUESTED,
        pgTransactionId,
      },
    });
  }

  /**
   * 결제를 실패(FAILED) 상태로 바꾼다
   * @param paymentId 결제 ID
   * @param reason 실패 사유
   * @param tx 트랜잭션 클라이언트(없으면 기본 클라이언트)
   * @returns 갱신한 결제
   */
  async failedPayment(
    paymentId: string,
    reason: string,
    tx?: TransactionClient,
  ) {
    return await (tx ?? this.prisma).payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.FAILED, reason },
    });
  }

  /**
   * 승인 요청 중(REQUESTED)인 결제를 승인(SUCCESS) 상태로 바꾼다
   * @param paymentId 결제 ID
   * @param now 승인 시각
   * @param tx 트랜잭션 클라이언트
   * @returns 없음
   * @throws PaymentUpdateError 승인 요청 중인 결제가 아닐 때
   */
  async approvePayment(
    paymentId: string,
    now: Date,
    tx: TransactionClient,
  ): Promise<void> {
    try {
      await tx.payment.update({
        where: { id: paymentId, status: PaymentStatus.REQUESTED },
        data: { status: PaymentStatus.SUCCESS, approvedAt: now },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new PaymentUpdateError(paymentId);
      }
      throw error;
    }
  }

  /**
   * 결제된 주문 항목마다 이용권을 만든다
   * @param paymentId 결제 ID(오류 보고용)
   * @param ticketsData 이용권 생성 데이터
   * @param tx 트랜잭션 클라이언트
   * @returns 없음
   * @throws PaymentUpdateError 일부 이용권이 만들어지지 않았을 때
   */
  async createTickets(
    paymentId: string,
    ticketsData: (TimePaymentData | PeriodPaymentData)[],
    tx: TransactionClient,
  ): Promise<void> {
    const createTickets = await tx.ticket.createMany({
      data: ticketsData,
    });
    if (createTickets.count !== ticketsData.length) {
      throw new PaymentUpdateError(paymentId);
    }
  }

  async updatePayment(
    pgTransactionId: string,
    data: {
      status: PaymentStatus;
      approvedAt?: Date;
      cancelledAt?: Date;
      reason?: string;
    },
  ) {
    await this.prisma.payment.update({
      where: {
        pgTransactionId,
      },
      data,
    });
  }

  async getPaymentById(paymentId: string) {
    return await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
  }

  async getPaymentByPgTransactionId(pgTransactionId: string) {
    return await this.prisma.payment.findUnique({
      where: { pgTransactionId },
      select: {
        id: true,
        amount: true,
        status: true,
        order: {
          select: {
            id: true,
            userId: true,
          },
        },
      },
    });
  }
}
