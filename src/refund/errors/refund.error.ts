import {
  DomainBadRequestError,
  DomainConflictError,
  DomainForbiddenError,
  DomainNotFoundError,
  DomainServiceUnavailableError,
} from 'src/common/errors';

/**
 * 환불 도메인 오류 (API 계약 §10)
 * - code는 응답 error.code로 나가는 계약 코드다
 */

/** 같은 Idempotency-Key로 다른 내용의 요청을 보냄 (409) */
export class IdempotencyKeyReusedError extends DomainConflictError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';

  constructor() {
    super('같은 Idempotency-Key로 다른 내용의 요청을 보낼 수 없습니다');
    this.name = 'IdempotencyKeyReusedError';
  }
}

/** 같은 Idempotency-Key의 최초 요청이 아직 처리 중 (409) */
export class IdempotencyRequestInProgressError extends DomainConflictError {
  readonly code = 'IDEMPOTENCY_REQUEST_IN_PROGRESS';

  constructor() {
    super('같은 Idempotency-Key의 최초 요청이 아직 처리 중입니다');
    this.name = 'IdempotencyRequestInProgressError';
  }
}

/** 역할·운영 권한 부족 (403) */
export class RefundForbiddenError extends DomainForbiddenError {
  readonly code = 'REFUND_FORBIDDEN';

  constructor() {
    super('이 환불 기능을 사용할 권한이 없습니다');
    this.name = 'RefundForbiddenError';
  }
}

/** 요청자의 조회 범위 밖이거나 없는 매장 (404) */
export class ShopNotFoundError extends DomainNotFoundError {
  readonly code = 'SHOP_NOT_FOUND';

  constructor(shopId: string) {
    super(`매장을 찾을 수 없습니다: ${shopId}`);
    this.name = 'ShopNotFoundError';
  }
}

/** 조회할 사용자가 없음 (404) */
export class RefundUserNotFoundError extends DomainNotFoundError {
  readonly code = 'USER_NOT_FOUND';

  constructor() {
    super('사용자를 찾을 수 없습니다');
    this.name = 'RefundUserNotFoundError';
  }
}

/** 이용 종료와 환불 금액에 대한 동의 누락 (400) */
export class RefundTerminationConsentRequiredError extends DomainBadRequestError {
  readonly code = 'REFUND_TERMINATION_CONSENT_REQUIRED';

  constructor() {
    super('이용 종료와 환불 금액에 대한 동의가 필요합니다');
    this.name = 'RefundTerminationConsentRequiredError';
  }
}

/** 본인·매장 범위에 없는 이용권 (404). 범위 밖 이용권의 존재를 드러내지 않는다 */
export class TicketNotFoundError extends DomainNotFoundError {
  readonly code = 'TICKET_NOT_FOUND';

  constructor() {
    super('이용권을 찾을 수 없습니다');
    this.name = 'TicketNotFoundError';
  }
}

/** 환불 대상이 아닌 상태 (409): PAYMENT_NOT_COMPLETED·ALREADY_REFUNDED·REFUND_IN_PROGRESS·USED_TICKET·EXPIRED_TICKET */
export class RefundNotEligibleError extends DomainConflictError {
  constructor(
    readonly code: string,
    readonly details?: { violations?: string[]; action?: string },
  ) {
    super(`환불할 수 없는 이용권입니다: ${code}`);
    this.name = 'RefundNotEligibleError';
  }
}

/** PG 콜백의 PG 취소 요청이 없음 (404) */
export class PgCallbackTargetNotFoundError extends DomainNotFoundError {
  readonly code = 'PG_CALLBACK_TARGET_NOT_FOUND';

  constructor() {
    super('콜백의 PG 취소 요청을 찾을 수 없습니다');
    this.name = 'PgCallbackTargetNotFoundError';
  }
}

/** PG 콜백의 PG 취소 요청이 콜백이 가리키는 환불 대상과 다름 (409) */
export class PgCallbackTargetMismatchError extends DomainConflictError {
  readonly code = 'PG_CALLBACK_TARGET_MISMATCH';

  constructor() {
    super('콜백의 PG 취소 요청이 콜백 대상과 일치하지 않습니다');
    this.name = 'PgCallbackTargetMismatchError';
  }
}

/** 환불 결과 저장 실패(커밋 실패 등). PG가 같은 결과를 다시 보내도록 503으로 응답한다 */
export class RefundStorageUnavailableError extends DomainServiceUnavailableError {
  readonly code = 'REFUND_STORAGE_UNAVAILABLE';

  /**
   * @param cause 저장을 실패하게 한 원래 오류(서버 로그 추적용, 응답에는 노출하지 않음)
   */
  constructor(readonly cause?: unknown) {
    super('환불 결과를 저장하지 못했습니다. 잠시 후 다시 보내 주세요');
    this.name = 'RefundStorageUnavailableError';
  }
}

/** 매장 환불 입력 규칙 위반 (400): REFUND_AMOUNT_EXCEEDED·UNUSED_TICKET_FULL_REFUND_REQUIRED·REFUND_REASON_REQUIRED */
export class RefundInputRejectedError extends DomainBadRequestError {
  constructor(readonly code: string) {
    super(`매장 환불 입력이 규칙에 맞지 않습니다: ${code}`);
    this.name = 'RefundInputRejectedError';
  }
}

/** 이용 중인 이용권을 퇴실 동의 없이 매장 환불함 (409) */
export class TicketInUseError extends DomainConflictError {
  readonly code = 'TICKET_IN_USE';

  constructor() {
    super('이용 중인 이용권입니다. 퇴실에 동의해야 환불할 수 있습니다');
    this.name = 'TicketInUseError';
  }
}

/** 요청자의 범위 밖이거나 없는 환불 (404) */
export class RefundNotFoundError extends DomainNotFoundError {
  readonly code = 'REFUND_NOT_FOUND';

  constructor() {
    super('환불을 찾을 수 없습니다');
    this.name = 'RefundNotFoundError';
  }
}

/** 운영 변경 요청에 Idempotency-Key가 없음 (400) */
export class IdempotencyKeyRequiredError extends DomainBadRequestError {
  readonly code = 'IDEMPOTENCY_KEY_REQUIRED';

  constructor() {
    super('이 요청에는 Idempotency-Key가 필요합니다');
    this.name = 'IdempotencyKeyRequiredError';
  }
}

/** PG 결과 미확정·활성 별도 지급 예약·유효한 조회 담당·PG 결과 모순 (409) */
export class RefundPayoutUnresolvedError extends DomainConflictError {
  readonly code = 'REFUND_PAYOUT_UNRESOLVED';

  constructor() {
    super('확인되지 않은 환불금 지급이 있어 새로 요청할 수 없습니다');
    this.name = 'RefundPayoutUnresolvedError';
  }
}

/** 지급 완료 등 운영 재처리 불가 상태 (409) */
export class RefundPayoutNotActionableError extends DomainConflictError {
  readonly code = 'REFUND_PAYOUT_NOT_ACTIONABLE';

  constructor() {
    super('다시 처리할 수 없는 환불금 지급 상태입니다');
    this.name = 'RefundPayoutNotActionableError';
  }
}

/** 일부 지급 뒤 PG 전액 재시도 (409) */
export class RefundPartialPayoutRequiresManualError extends DomainConflictError {
  readonly code = 'REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL';

  constructor() {
    super('일부 지급된 환불은 미지급액을 별도로 지급해야 합니다');
    this.name = 'RefundPartialPayoutRequiresManualError';
  }
}

/** 별도 지급 예약 금액이 미지급액과 다름 (400) */
export class RefundOutstandingAmountMismatchError extends DomainBadRequestError {
  readonly code = 'REFUND_OUTSTANDING_AMOUNT_MISMATCH';

  constructor() {
    super('예약 금액은 현재 미지급액과 같아야 합니다');
    this.name = 'RefundOutstandingAmountMismatchError';
  }
}

/** 실제 지급·확실한 미지급의 증빙 누락 (400) */
export class ManualPayoutEvidenceRequiredError extends DomainBadRequestError {
  readonly code = 'MANUAL_PAYOUT_EVIDENCE_REQUIRED';

  constructor() {
    super('지급 결과를 확인할 수 있는 증빙이 필요합니다');
    this.name = 'ManualPayoutEvidenceRequiredError';
  }
}

/** 없거나 다른 환불에 속한 별도 환불금 지급 예약 (404) */
export class ManualPayoutNotFoundError extends DomainNotFoundError {
  readonly code = 'MANUAL_PAYOUT_NOT_FOUND';

  constructor() {
    super('별도 환불금 지급 예약을 찾을 수 없습니다');
    this.name = 'ManualPayoutNotFoundError';
  }
}

/** 이미 실패·완료된 예약의 상충 변경 (409) */
export class ManualPayoutStateConflictError extends DomainConflictError {
  readonly code = 'MANUAL_PAYOUT_STATE_CONFLICT';

  constructor() {
    super('이미 종료된 별도 환불금 지급 예약은 바꿀 수 없습니다');
    this.name = 'ManualPayoutStateConflictError';
  }
}

/** 다른 환불금 지급에서 이미 쓴 실제 지급 거래 식별자 (409) */
export class ManualPayoutReferenceReusedError extends DomainConflictError {
  readonly code = 'MANUAL_PAYOUT_REFERENCE_REUSED';

  constructor() {
    super('다른 환불금 지급에서 이미 사용한 거래 식별자입니다');
    this.name = 'ManualPayoutReferenceReusedError';
  }
}

/** 부족액이 남았거나 초과 취소 검토 조건을 만족하지 않음 (409) */
export class RefundAmountReviewIncompleteError extends DomainConflictError {
  readonly code = 'REFUND_AMOUNT_REVIEW_INCOMPLETE';

  constructor() {
    super('초과 취소 검토를 마칠 수 있는 상태가 아닙니다');
    this.name = 'RefundAmountReviewIncompleteError';
  }
}
