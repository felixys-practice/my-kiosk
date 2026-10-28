import {
  DomainBadRequestError,
  DomainConflictError,
  DomainForbiddenError,
  DomainNotFoundError,
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
