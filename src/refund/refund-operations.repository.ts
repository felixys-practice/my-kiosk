import { Injectable } from '@nestjs/common';
import {
  ManualRefundPayoutStatus,
  RefundPayoutMethod,
  RefundPayoutStatus,
} from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';

/**
 * 별도 환불금 지급 저장소 (data-model §5)
 * - 모든 쓰기는 호출자가 Refund를 잠근 트랜잭션 안에서 한다
 */
@Injectable()
export class RefundOperationsRepository {
  /**
   * 별도 환불금 지급 예약을 저장하고 환불 지급 방식을 MANUAL로 고정한다
   * - 환불은 조치 필요 그대로다(예약은 지급 완료가 아니다)
   * @param tx Refund 잠금 트랜잭션
   * @param input 환불·금액·예약자·사유·시각
   * @returns 예약 ID
   */
  async createReservation(
    tx: TransactionClient,
    input: {
      refundId: string;
      amount: number;
      reservedById: string;
      reason: string;
      now: Date;
    },
  ): Promise<string> {
    const payout = await tx.manualRefundPayout.create({
      data: {
        refundId: input.refundId,
        status: ManualRefundPayoutStatus.RESERVED,
        amount: input.amount,
        reservedById: input.reservedById,
        reservedAt: input.now,
        reason: input.reason,
      },
      select: { id: true },
    });
    await tx.refund.update({
      where: { id: input.refundId },
      data: { payoutMethod: RefundPayoutMethod.MANUAL },
    });
    return payout.id;
  }

  /**
   * 환불에 속한 별도 환불금 지급을 읽는다
   * @param tx Refund 잠금 트랜잭션
   * @param refundId 환불
   * @param payoutId 예약
   * @returns 지급 상태·금액·거래 식별자, 그 환불의 지급이 아니면 null
   */
  findPayout(tx: TransactionClient, refundId: string, payoutId: string) {
    return tx.manualRefundPayout.findFirst({
      where: { id: payoutId, refundId },
      select: {
        id: true,
        status: true,
        amount: true,
        externalTransactionId: true,
      },
    });
  }

  /**
   * 원장에 쓸 환불의 원래 주문·매장을 읽는다
   * @param tx 트랜잭션
   * @param refundId 환불
   * @returns 주문·매장 ID와 현재 지급 합계·검토 필요 여부
   */
  async findRefundForPayout(tx: TransactionClient, refundId: string) {
    const refund = await tx.refund.findUniqueOrThrow({
      where: { id: refundId },
      select: {
        amount: true,
        paidAmount: true,
        reviewRequired: true,
        payment: { select: { order: { select: { id: true, shopId: true } } } },
      },
    });
    return {
      amount: refund.amount,
      paidAmount: refund.paidAmount,
      reviewRequired: refund.reviewRequired,
      orderId: refund.payment.order.id,
      shopId: refund.payment.order.shopId,
    };
  }

  /**
   * 별도 환불금 지급을 성공으로 확정한다
   * @param tx Refund 잠금 트랜잭션
   * @param payoutId 예약
   * @param input 확정자·확정 시각·실제 지급 시각·거래 식별자·증빙
   */
  async markPayoutSucceeded(
    tx: TransactionClient,
    payoutId: string,
    input: {
      confirmedById: string;
      now: Date;
      paidAt: Date;
      externalTransactionId: string;
      evidenceReference: string;
    },
  ): Promise<void> {
    await tx.manualRefundPayout.update({
      where: { id: payoutId },
      data: {
        status: ManualRefundPayoutStatus.SUCCEEDED,
        confirmedById: input.confirmedById,
        confirmedAt: input.now,
        paidAt: input.paidAt,
        externalTransactionId: input.externalTransactionId,
        evidenceReference: input.evidenceReference,
      },
    });
  }

  /**
   * 별도 지급액을 환불 지급 합계에 더하고, 미지급액이 없으면 지급 완료로 바꾼다
   * @param tx Refund 잠금 트랜잭션
   * @param refundId 환불
   * @param input 새 지급 합계·지급 완료 여부·시각
   */
  async applyManualPaid(
    tx: TransactionClient,
    refundId: string,
    input: { paidAmount: number; settled: boolean; now: Date },
  ): Promise<void> {
    await tx.refund.update({
      where: { id: refundId },
      data: input.settled
        ? {
            paidAmount: input.paidAmount,
            payoutStatus: RefundPayoutStatus.PAID,
            paidAt: input.now,
            actionCode: null,
          }
        : { paidAmount: input.paidAmount },
    });
  }
}
