import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ErrorDetail } from '../dto/error-response.dto';
import { Prisma } from '@prisma/client';
import { SeatAlreadyOccupiedError } from 'src/usage-session/errors/seat-already-occupied.error';
import { DomainConflictError } from '../errors/domain-conflict.error';
import { DomainNotFoundError } from '../errors/domain-not-found.error';
import { DomainBadRequestError } from '../errors/domain-bad-request.error';
import { DomainForbiddenError } from '../errors/domain-forbidden.error';
import { DomainUnauthorizedError } from '../errors';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // 기본 에러 응답 구조
    const errorDetail: ErrorDetail = {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    };
    let status = HttpStatus.INTERNAL_SERVER_ERROR;

    // 1. HttpException 처리
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      errorDetail.code = exception.name;
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        errorDetail.message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as any;
        errorDetail.message = responseObj.message || exception.message;
        errorDetail.details = responseObj.errors || responseObj.error;
      }
    } else if (exception instanceof DomainConflictError) {
      status = HttpStatus.CONFLICT;
      errorDetail.code = this.codeOf(exception);
      errorDetail.details = this.detailsOf(exception);
      errorDetail.message = exception.message;
    } else if (exception instanceof DomainNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      errorDetail.code = this.codeOf(exception);
      errorDetail.details = this.detailsOf(exception);
      errorDetail.message = exception.message;
    } else if (exception instanceof DomainBadRequestError) {
      status = HttpStatus.BAD_REQUEST;
      errorDetail.code = this.codeOf(exception);
      errorDetail.details = this.detailsOf(exception);
      errorDetail.message = exception.message;
    } else if (exception instanceof DomainForbiddenError) {
      status = HttpStatus.FORBIDDEN;
      errorDetail.code = this.codeOf(exception);
      errorDetail.details = this.detailsOf(exception);
      errorDetail.message = exception.message;
    } else if (exception instanceof DomainUnauthorizedError) {
      status = HttpStatus.UNAUTHORIZED;
      errorDetail.code = this.codeOf(exception);
      errorDetail.details = this.detailsOf(exception);
      errorDetail.message = exception.message;
    }
    // 2. Prisma 에러 처리
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaError = this.handlePrismaError(exception);
      status = prismaError.status;
      errorDetail.message = prismaError.message;
      errorDetail.code = exception.code;
    }
    // 3. Prisma Validation 에러 처리
    else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      errorDetail.message = '데이터 유효성 검사 실패';
      errorDetail.code = 'PRISMA_VALIDATION_ERROR';
    }
    // 4. 기타 에러 처리 (예상하지 못한 에러 → 내부 정보 비노출, 항상 500)
    else if (exception instanceof Error) {
      errorDetail.message = '서버 내부 오류가 발생했습니다';
      errorDetail.code = 'INTERNAL_SERVER_ERROR';
    }

    const logMessage = `${request.method} ${request.path} ${status}`;
    if (status >= 500) {
      this.logger.error(
        logMessage,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(logMessage, errorDetail.message);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      error: errorDetail,
      timestamp: new Date().toISOString(),
      method: request.method,
      path: request.path,
    });
  }

  /**
   * 도메인 오류의 응답 코드를 정한다
   * - 계약 코드(code)를 지정한 오류는 그 코드를, 없으면 오류 클래스 이름을 쓴다
   * @param exception 도메인 오류
   * @returns 응답 error.code
   */
  private codeOf(exception: Error): string {
    const { code } = exception as Error & { code?: unknown };
    return typeof code === 'string' ? code : exception.name;
  }

  /**
   * 도메인 오류의 응답 상세(details)를 꺼낸다
   * - 오류에 details를 지정한 경우(예: USED_TICKET의 violations·action 안내)만 응답에 담는다
   * @param exception 도메인 오류
   * @returns 상세, 없으면 undefined
   */
  private detailsOf(exception: Error): unknown {
    return (exception as Error & { details?: unknown }).details;
  }

  /**
   * Prisma 에러를 HTTP 에러로 변환
   */
  private handlePrismaError(error: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
  } {
    switch (error.code) {
      // 고유 제약 조건 위반
      case 'P2002': {
        // Prisma 7(driver adapter 파이프라인)부터 meta.target이 항상
        // string[]로 채워지지 않는다 — named constraint인 경우 index
        // 이름 문자열로 오거나, 파싱 실패 시 아예 비어있을 수 있다.
        const target = error.meta?.target;
        const field = Array.isArray(target)
          ? target.join(', ')
          : typeof target === 'string'
            ? target
            : '해당';
        return {
          status: HttpStatus.CONFLICT,
          message: `${field} 필드가 이미 존재합니다`,
        };
      }

      // 레코드를 찾을 수 없음
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: '요청한 리소스를 찾을 수 없습니다',
        };

      // 외래 키 제약 조건 위반
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: '참조된 리소스가 존재하지 않습니다',
        };

      // 필수 필드 누락
      case 'P2011':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: '필수 필드가 누락되었습니다',
        };

      // 데이터 형식 오류
      case 'P2006':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: '잘못된 데이터 형식입니다',
        };

      // 연결 실패
      case 'P1001':
      case 'P1002':
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          message: '데이터베이스 연결에 실패했습니다',
        };

      // 기본 에러
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: '데이터베이스 오류가 발생했습니다',
        };
    }
  }
}
