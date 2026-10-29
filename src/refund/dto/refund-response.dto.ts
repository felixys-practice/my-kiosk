import type { RefundQueryRow } from '../refund-query.repository';

/** DB 행 전체를 직렬화하지 않고 환불 조회 계약의 필드를 명시한다. */
export class RefundResponseDto {
  static detail(row: RefundQueryRow) {
    return {
      ...this.from(row),
      attempts: row.paymentCancels.map((attempt) => ({
        paymentCancelId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        amount: attempt.amount,
        actualAmount: attempt.actualAmount,
        status: attempt.status,
        failureCode: attempt.failureCode,
        requestedAt: attempt.requestedAt,
        cancelledAt: attempt.cancelledAt,
        failedAt: attempt.failedAt,
      })),
      manualPayouts: row.manualPayouts.map((payout) => ({
        manualRefundPayoutId: payout.id,
        status: payout.status,
        amount: payout.amount,
        reservedAt: payout.reservedAt,
        confirmedAt: payout.confirmedAt,
        paidAt: payout.paidAt,
      })),
    };
  }

  static from(row: RefundQueryRow) {
    const latest = row.paymentCancels[0];
    return {
      refundId: row.id,
      decisionStatus: row.decisionStatus,
      policyVersion: row.policyVersion,
      paymentId: row.paymentId,
      targetKind: row.targetKind,
      orderItemId: row.orderItemId,
      ticketId: row.orderItem?.ticket?.id ?? null,
      shopId: row.payment.order.shopId,
      source: row.source,
      amount: row.amount,
      paidAmount: row.paidAmount,
      outstandingAmount: Math.max(row.amount - row.paidAmount, 0),
      overpaidAmount: Math.max(row.paidAmount - row.amount, 0),
      requestedAt: row.requestedAt,
      acceptedAt: row.acceptedAt,
      terminatedAt: row.terminatedAt,
      payoutStatus: row.payoutStatus,
      payoutMethod: row.payoutMethod,
      reviewRequired: row.reviewRequired,
      paymentCancelId: latest?.id ?? null,
      attemptStatus: latest?.status ?? null,
      actionCode: row.actionCode,
      actionReason: null,
      paidAt: row.paidAt,
    };
  }
}
