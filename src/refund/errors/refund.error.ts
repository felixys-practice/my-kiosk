import { DomainConflictError } from 'src/common/errors';

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
