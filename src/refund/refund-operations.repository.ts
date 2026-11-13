import { Injectable } from '@nestjs/common';
import {
  ManualRefundPayoutStatus,
  RefundPayoutMethod,
  RefundPayoutStatus,
} from '@prisma/client';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';

/**
 * 별도 환불금 지급 저장소 (data-model §5)
 * - 모든 쓰기는 호출자가 Refund를 잠근 트랜잭션 안에서 한다
 */
@Injectable()
export class RefundOperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

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
        payoutStatus: true,
        reviewRequired: true,
        actionCode: true,
        payment: { select: { order: { select: { id: true, shopId: true } } } },
      },
    });
    return {
      amount: refund.amount,
      paidAmount: refund.paidAmount,
      payoutStatus: refund.payoutStatus,
      reviewRequired: refund.reviewRequired,
      actionCode: refund.actionCode,
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
   * - 부족액 지급으로 미지급액이 0이 되면 부족 지급 검토도 함께 완료한다(검토자·시각·증빙)
   * @param tx Refund 잠금 트랜잭션
   * @param refundId 환불
   * @param input 새 지급 합계·지급 완료 여부·시각·검토 완료 정보
   */
  async applyManualPaid(
    tx: TransactionClient,
    refundId: string,
    input: {
      paidAmount: number;
      settled: boolean;
      now: Date;
      review?: { reviewedById: string; evidenceReference: string };
    },
  ): Promise<void> {
    await tx.refund.update({
      where: { id: refundId },
      data: input.settled
        ? {
            paidAmount: input.paidAmount,
            payoutStatus: RefundPayoutStatus.PAID,
            paidAt: input.now,
            actionCode: null,
            ...(input.review && {
              reviewRequired: false,
              reviewedById: input.review.reviewedById,
              reviewedAt: input.now,
              reviewEvidenceReference: input.review.evidenceReference,
            }),
          }
        : { paidAmount: input.paidAmount },
    });
  }

  /**
   * 실제 지급 거래 식별자를 다른 별도 지급이 이미 쓰는지 확인한다(전역 고유)
   * @param tx 트랜잭션
   * @param externalTransactionId 거래 식별자
   * @param payoutId 지금 확정하는 예약(제외)
   * @returns 다른 지급이 쓰고 있으면 true
   */
  async isExternalTransactionUsedByOther(
    tx: TransactionClient,
    externalTransactionId: string,
    payoutId: string,
  ): Promise<boolean> {
    const used = await tx.manualRefundPayout.findFirst({
      where: { externalTransactionId, id: { not: payoutId } },
      select: { id: true },
    });
    return used !== null;
  }

  /**
   * 실제로 지급하지 않았음이 확인된 예약을 실패로 종료한다(환불·지급액·원장은 바꾸지 않는다)
   * @param tx Refund 잠금 트랜잭션
   * @param payoutId 예약
   * @param input 확인자·시각·사유·미지급 근거
   */
  async markPayoutNotPaid(
    tx: TransactionClient,
    payoutId: string,
    input: {
      confirmedById: string;
      now: Date;
      reason: string;
      evidenceReference: string;
    },
  ): Promise<void> {
    await tx.manualRefundPayout.update({
      where: { id: payoutId },
      data: {
        status: ManualRefundPayoutStatus.FAILED,
        confirmedById: input.confirmedById,
        confirmedAt: input.now,
        failureReason: input.reason,
        notPaidEvidence: input.evidenceReference,
      },
    });
  }

  /**
   * 초과 취소 검토를 마치고 지급 완료로 바꾼다(확정 금액·지급액·원장은 그대로)
   * @param tx Refund 잠금 트랜잭션
   * @param refundId 환불
   * @param input 검토자·시각·사유·근거
   */
  async completeAmountReview(
    tx: TransactionClient,
    refundId: string,
    input: {
      reviewedById: string;
      now: Date;
      reason: string;
      evidenceReference: string;
    },
  ): Promise<void> {
    await tx.refund.update({
      where: { id: refundId },
      data: {
        reviewRequired: false,
        reviewedById: input.reviewedById,
        reviewedAt: input.now,
        reviewReason: input.reason,
        reviewEvidenceReference: input.evidenceReference,
        payoutStatus: RefundPayoutStatus.PAID,
        paidAt: input.now,
        actionCode: null,
      },
    });
  }

  /**
   * 예약 뒤 기준 시각까지 결과가 없고 아직 미확인 알림을 남기지 않은 별도 지급을 찾는다
   * @param reservedBefore 이 시각 이전에 예약된 것만
   * @param limit 한 번에 처리할 최대 건수
   * @param alertKind 미확인 알림 종류
   * @returns 예약·환불·매장
   */
  async findUnalertedReservations(
    reservedBefore: Date,
    limit: number,
    alertKind: string,
  ): Promise<
    {
      payoutId: string;
      refundId: string;
      shopId: string;
      customerId: string;
      orderId: string;
      reservedAt: Date;
    }[]
  > {
    const payouts = await this.prisma.manualRefundPayout.findMany({
      where: {
        status: ManualRefundPayoutStatus.RESERVED,
        reservedAt: { lte: reservedBefore },
        notifications: { none: { kind: alertKind } },
      },
      orderBy: { reservedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        refundId: true,
        reservedAt: true,
        refund: {
          select: {
            payment: {
              select: {
                order: { select: { id: true, shopId: true, userId: true } },
              },
            },
          },
        },
      },
    });
    return payouts.map((payout) => ({
      payoutId: payout.id,
      refundId: payout.refundId,
      shopId: payout.refund.payment.order.shopId,
      customerId: payout.refund.payment.order.userId,
      orderId: payout.refund.payment.order.id,
      reservedAt: payout.reservedAt,
    }));
  }

  /**
   * 예약의 현재 상태를 읽는다(호출자가 잠근 뒤)
   * @param tx 트랜잭션
   * @param payoutId 예약
   * @returns 상태, 없으면 null
   */
  async findPayoutStatus(
    tx: TransactionClient,
    payoutId: string,
  ): Promise<ManualRefundPayoutStatus | null> {
    const payout = await tx.manualRefundPayout.findUnique({
      where: { id: payoutId },
      select: { status: true },
    });
    return payout?.status ?? null;
  }
}
