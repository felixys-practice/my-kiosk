import type { RefundQueryRow } from '../refund-query.repository';

const publicActionReasons: Record<string, string> = {
  SEND_FAILED: 'PG 취소 요청을 보내지 못해 담당자 확인이 필요합니다.',
  PG_REJECTED: 'PG 취소 요청이 거절되어 담당자 확인이 필요합니다.',
  RETRY_EXHAUSTED: 'PG 취소 요청의 자동 재전송 한도에 도달했습니다.',
  AMOUNT_MISMATCH: '확정 금액과 실제 환불금 지급액이 달라 확인이 필요합니다.',
  PG_RESULT_CONFLICT: 'PG 취소 결과가 기존 기록과 달라 확인이 필요합니다.',
  MANUAL_CONFIRMATION_REQUIRED: '별도 환불금 지급 여부를 확인 중입니다.',
  QUERY_FAILED: 'PG 취소 결과를 확인하고 있습니다.',
};

/** DB 행 전체를 직렬화하지 않고 환불 조회 계약의 필드를 명시한다. */
export class RefundResponseDto {
  static detail(row: RefundQueryRow, operator = false) {
    return {
      ...this.from(row, operator),
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
        ...(operator
          ? {
              pgTransactionId: attempt.pgTransactionId,
              pgErrorCode: attempt.pgErrorCode,
              failureReason: attempt.failureReason,
              lastInquiryError: attempt.lastInquiryError,
              resendCount: attempt.resendCount,
              manualResendCount: attempt.manualResendCount,
              inquiryCount: attempt.inquiryCount,
              inquiryFailureCount: attempt.inquiryFailureCount,
              lastInquiryAt: attempt.lastInquiryAt,
              nextInquiryAt: attempt.nextInquiryAt,
              queryFailedAt: attempt.queryFailedAt,
              lastSendAttemptAt: attempt.lastSendAttemptAt,
              sendAttemptCount: attempt.sendAttemptCount,
              requestedById: attempt.requestedById,
              retryReason: attempt.retryReason,
            }
          : {}),
      })),
      manualPayouts: row.manualPayouts.map((payout) => ({
        manualRefundPayoutId: payout.id,
        status: payout.status,
        amount: payout.amount,
        reservedAt: payout.reservedAt,
        confirmedAt: payout.confirmedAt,
        paidAt: payout.paidAt,
        ...(operator
          ? {
              externalTransactionId: payout.externalTransactionId,
              evidenceReference: payout.evidenceReference,
              notPaidEvidence: payout.notPaidEvidence,
              failureReason: payout.failureReason,
              reason: payout.reason,
              reservedById: payout.reservedById,
              confirmedById: payout.confirmedById,
            }
          : {}),
      })),
    };
  }

  static from(row: RefundQueryRow, operator = false) {
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
      outstandingAmount:
        row.payoutStatus === 'NOT_APPLICABLE'
          ? 0
          : Math.max(row.amount - row.paidAmount, 0),
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
      actionReason: operator
        ? row.actionReason
        : row.actionCode
          ? (publicActionReasons[row.actionCode] ??
            '환불금 지급 상태에 대한 담당자 확인이 필요합니다.')
          : null,
      paidAt: row.paidAt,
      ...(operator
        ? {
            reviewedById: row.reviewedById,
            reviewedAt: row.reviewedAt,
            reviewReason: row.reviewReason,
            reviewEvidenceReference: row.reviewEvidenceReference,
          }
        : {}),
    };
  }
}
