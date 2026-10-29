import { DomainUnauthorizedError } from 'src/common/errors';

/**
 * PG 콜백 서명 오류 (환불 명세 API 계약 §7·§10)
 * - code는 응답 error.code로 나가는 계약 코드다
 */

/** 서명이 없거나 형식이 틀렸거나 일치하지 않음 (401) */
export class PgCallbackUnauthorizedError extends DomainUnauthorizedError {
  readonly code = 'PG_CALLBACK_UNAUTHORIZED';

  constructor() {
    super('PG 콜백 서명을 확인할 수 없습니다');
    this.name = 'PgCallbackUnauthorizedError';
  }
}
