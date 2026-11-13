import { DomainBadRequestError } from './domain-bad-request.error';
import { DomainConflictError } from './domain-conflict.error';
import { DomainForbiddenError } from './domain-forbidden.error';
import { DomainNotFoundError } from './domain-not-found.error';
import { DomainServiceUnavailableError } from './domain-service-unavailable.error';
import { DomainUnauthorizedError } from './domain-unauthorized.error';

/**
 * 응답 코드가 정해진 도메인 오류인지 확인한다
 * - 콜백 처리에서 도메인 오류는 그대로, 그 밖의 저장 실패는 503으로 바꿀 때 쓴다
 * @param error 잡은 오류
 * @returns 도메인 오류 기본 클래스의 인스턴스면 true
 */
export function isDomainError(error: unknown): boolean {
  return [
    DomainBadRequestError,
    DomainUnauthorizedError,
    DomainForbiddenError,
    DomainNotFoundError,
    DomainConflictError,
    DomainServiceUnavailableError,
  ].some((domainError) => error instanceof domainError);
}
