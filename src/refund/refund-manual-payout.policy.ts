import { RefundDecisionStatus, RefundPayoutStatus } from '@prisma/client';
import { hasUnresolvedPayout, PayoutRetryState } from './refund-retry.policy';

/** 별도 환불금 지급 예약 거절 코드 (API 계약 §5·§10) */
export type ManualReservationRejection =
  | 'REFUND_PAYOUT_NOT_ACTIONABLE'
  | 'REFUND_PAYOUT_UNRESOLVED'
  | 'REFUND_OUTSTANDING_AMOUNT_MISMATCH';

/** 별도 환불금 지급 예약 판정 결과 */
export type ManualReservationDecision =
  | { allowed: true; outstandingAmount: number }
  | { allowed: false; code: ManualReservationRejection };

/**
 * 별도 환불금 지급을 예약해도 되는지 판정한다 (API 계약 §5 manual-payouts, data-model §5)
 * @param state Refund 잠금 뒤 읽은 지급 상태
 * @param requestedAmount 운영자가 예약하려는 금액
 * @param now 판정 시각(조회 담당 기한 비교)
 * @returns 허용(미지급액) 또는 거절 코드
 */
export function evaluateManualReservation(
  state: PayoutRetryState,
  requestedAmount: number,
  now: Date,
): ManualReservationDecision {
  // 조치 필요인 확정 환불만 예약한다(지급 완료·비확정은 처리할 것이 없다)
  if (
    state.decisionStatus !== RefundDecisionStatus.ACCEPTED ||
    state.payoutStatus !== RefundPayoutStatus.ACTION_REQUIRED
  ) {
    return { allowed: false, code: 'REFUND_PAYOUT_NOT_ACTIONABLE' };
  }
  // 확인되지 않은 지급이 있으면 예약하지 않는다(교차 지급 차단)
  if (hasUnresolvedPayout(state, now)) {
    return { allowed: false, code: 'REFUND_PAYOUT_UNRESOLVED' };
  }
  // 예약 금액은 현재 미지급액(확정된 환불 금액 - 실제 지급액)과 같아야 한다
  const outstandingAmount = state.amount - state.paidAmount;
  // 미지급액이 없으면(초과 취소 포함) 별도 지급이 아니라 초과 취소 검토 대상이다
  if (outstandingAmount <= 0) {
    return { allowed: false, code: 'REFUND_PAYOUT_NOT_ACTIONABLE' };
  }
  if (requestedAmount !== outstandingAmount) {
    return { allowed: false, code: 'REFUND_OUTSTANDING_AMOUNT_MISMATCH' };
  }
  return { allowed: true, outstandingAmount };
}
