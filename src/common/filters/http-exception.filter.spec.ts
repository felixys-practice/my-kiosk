import { vi, type Mock } from 'vitest';
import { ArgumentsHost } from '@nestjs/common';
import {
  DomainBadRequestError,
  DomainConflictError,
  DomainForbiddenError,
  DomainNotFoundError,
  DomainServiceUnavailableError,
  DomainUnauthorizedError,
} from '../errors';
import { HttpExceptionFilter } from './http-exception.filter';

/** 도메인 오류 기본 클래스 5종 */
const domainErrorBases = [
  DomainBadRequestError,
  DomainUnauthorizedError,
  DomainForbiddenError,
  DomainNotFoundError,
  DomainConflictError,
];

/**
 * 계약 코드를 가진 도메인 오류를 만든다
 * @param errorBase 도메인 오류 기본 클래스
 * @param code 계약 코드
 * @returns 오류 인스턴스
 */
function codedError(
  errorBase: (typeof domainErrorBases)[number],
  code: string,
): Error {
  const error = new errorBase('계약 코드가 있는 오류') as Error & {
    code: string;
  };
  error.code = code;
  return error;
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let status: Mock;
  let json: Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'POST', path: '/refund' }),
      }),
    } as unknown as ArgumentsHost;
  });

  /**
   * 필터가 응답으로 보낸 본문을 꺼낸다
   * @returns 응답 본문
   */
  function sentBody(): {
    statusCode: number;
    error: { code: string; details?: unknown };
  } {
    const [[body]] = json.mock.calls as unknown[][];
    return body as {
      statusCode: number;
      error: { code: string; details?: unknown };
    };
  }

  it.each(domainErrorBases)(
    '도메인 오류(%p)에 지정한 code가 응답 error.code로 그대로 나간다',
    (errorBase) => {
      filter.catch(codedError(errorBase, 'REFUND_CONTRACT_CODE'), host);

      expect(sentBody().error.code).toBe('REFUND_CONTRACT_CODE');
    },
  );

  it('code가 없는 도메인 오류는 오류 클래스 이름이 error.code로 나간다', () => {
    filter.catch(new DomainConflictError('코드 없는 충돌'), host);

    expect(sentBody().error.code).toBe('DomainConflictError');
  });

  it('도메인 오류에 details가 있으면 응답 error.details로 그대로 나간다', () => {
    const error = codedError(DomainConflictError, 'USED_TICKET') as Error & {
      details: unknown;
    };
    error.details = {
      violations: ['USED_TICKET', 'EXPIRED_TICKET'],
      action: 'CONTACT_SHOP',
    };

    filter.catch(error, host);

    expect(sentBody().error.details).toEqual({
      violations: ['USED_TICKET', 'EXPIRED_TICKET'],
      action: 'CONTACT_SHOP',
    });
  });

  it('일시적 처리 불가 도메인 오류는 503과 지정한 code로 나간다', () => {
    const error = new DomainServiceUnavailableError('저장 실패') as Error & {
      code: string;
    };
    error.code = 'REFUND_STORAGE_UNAVAILABLE';

    filter.catch(error, host);

    const [[sentStatus]] = status.mock.calls as number[][];
    expect({
      status: sentStatus,
      code: sentBody().error.code,
    }).toEqual({ status: 503, code: 'REFUND_STORAGE_UNAVAILABLE' });
  });
});
