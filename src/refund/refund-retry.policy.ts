import {
  PaymentCancelStatus,
  RefundDecisionStatus,
  RefundPayoutStatus,
} from '@prisma/client';

/** PG 재시도 판정에 쓰는 환불의 현재 지급 상태(Refund 잠금 뒤 읽은 값) */
export type PayoutRetryState = {
  decisionStatus: RefundDecisionStatus;
  payoutStatus: RefundPayoutStatus;
  amount: number; // 확정된 환불 금액
  paidAmount: number; // 실제 환불금 지급액 합계
  actionCode: string | null; // 조치 사유 코드(PG_RESULT_CONFLICT 등)
  attempts: { status: PaymentCancelStatus; claimUntil: Date | null }[]; // 이 환불의 PG 취소 요청들
  activeManualPayout: boolean; // 활성(RESERVED) 별도 환불금 지급 예약 여부
};

/** PG 재시도 거절 코드 (API 계약 §5·§10) */
export type PayoutRetryRejection =
  | 'REFUND_PAYOUT_NOT_ACTIONABLE'
  | 'REFUND_PAYOUT_UNRESOLVED'
  | 'REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL';

/** 결과가 확정된 PG 취소 요청 상태(그 밖의 상태는 모두 미확정으로 본다) */
const finalStatuses: readonly PaymentCancelStatus[] = [
  PaymentCancelStatus.SUCCEEDED,
  PaymentCancelStatus.FAILED,
];

/** PG 재시도 판정 결과 */
export type PayoutRetryDecision =
  { allowed: true } | { allowed: false; code: PayoutRetryRejection };

/**
 * 확인되지 않은 환불금 지급이 있는지 판단한다(PG 재시도·별도 지급 예약 공통, API 계약 §5)
 * - 결과가 확정되지 않은 PG 취소 요청, 활성 별도 지급 예약, 실패한 요청의 유효한 개별 조회 담당, PG 결과 모순
 * @param state Refund 잠금 뒤 읽은 지급 상태
 * @param now 판정 시각(조회 담당 기한 비교)
 * @returns 하나라도 있으면 true
 */
export function hasUnresolvedPayout(
  state: PayoutRetryState,
  now: Date,
): boolean {
  return (
    state.activeManualPayout ||
    state.actionCode === 'PG_RESULT_CONFLICT' ||
    state.attempts.some(
      (attempt) =>
        !finalStatuses.includes(attempt.status) ||
        (attempt.claimUntil !== null && attempt.claimUntil > now),
    )
  );
}

/**
 * 확정된 환불에 새 PG 취소 요청을 만들어도 되는지 판정한다 (API 계약 §5 처리 순서 3·4)
 * @param state Refund 잠금 뒤 읽은 지급 상태
 * @param now 판정 시각(조회 담당 기한 비교)
 * @returns 허용 또는 거절 코드
 */
export function evaluatePayoutRetry(
  state: PayoutRetryState,
  now: Date,
): PayoutRetryDecision {
  // 확정되지 않았거나 지급이 끝난 환불은 다시 처리할 것이 없다
  if (
    state.decisionStatus !== RefundDecisionStatus.ACCEPTED ||
    state.payoutStatus === RefundPayoutStatus.PAID
  ) {
    return { allowed: false, code: 'REFUND_PAYOUT_NOT_ACTIONABLE' };
  }
  // 확인되지 않은 지급이 있으면 새 요청을 만들지 않는다
  if (hasUnresolvedPayout(state, now)) {
    return { allowed: false, code: 'REFUND_PAYOUT_UNRESOLVED' };
  }
  // 일부만 지급됐으면 PG 전액 재시도 대신 미지급액의 별도 지급으로 처리한다
  if (state.paidAmount > 0 && state.paidAmount < state.amount) {
    return { allowed: false, code: 'REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL' };
  }
  // 확정 금액 이상 지급된 건은 초과 취소 검토 대상이고, 조치 필요가 아닌 환불은 재처리할 것이 없다
  if (
    state.paidAmount >= state.amount ||
    state.payoutStatus !== RefundPayoutStatus.ACTION_REQUIRED
  ) {
    return { allowed: false, code: 'REFUND_PAYOUT_NOT_ACTIONABLE' };
  }
  return { allowed: true };
}
