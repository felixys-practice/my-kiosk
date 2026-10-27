import { ArgumentsHost } from '@nestjs/common';
import {
  DomainBadRequestError,
  DomainConflictError,
  DomainForbiddenError,
  DomainNotFoundError,
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
  let status: jest.Mock;
  let json: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
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
  function sentBody(): { statusCode: number; error: { code: string } } {
    const [[body]] = json.mock.calls as unknown[][];
    return body as {
      statusCode: number;
      error: { code: string };
    };
  }

  it.each(domainErrorBases)(
    '도메인 오류(%p)에 지정한 code가 응답 error.code로 그대로 나간다',
    (errorBase) => {
      filter.catch(codedError(errorBase, 'REFUND_CONTRACT_CODE'), host);

      expect(sentBody().error.code).toBe('REFUND_CONTRACT_CODE');
    },
  );
});
