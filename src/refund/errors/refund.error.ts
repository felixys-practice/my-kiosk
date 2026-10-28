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
