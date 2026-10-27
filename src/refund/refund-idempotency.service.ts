import { Injectable } from '@nestjs/common';
import { RefundIdempotencyRepository } from './refund-idempotency.repository';
import { IdempotencyKeyReusedError } from './errors';

/** 멱등 처리 대상 요청 */
export type IdempotentCommand = {
  requesterId: string; // 요청자
  operation: string; // 기능 구분(CUSTOMER_REFUND, STORE_REFUND 등)
  key?: string; // Idempotency-Key 헤더 값, 없으면 멱등 처리 없이 실행
  request: Record<string, unknown>; // 같은 요청인지 판단할 본문(대상·금액·사유·동의)
  authorize: () => Promise<void>; // 저장된 응답을 돌려주기 전에 현재 권한을 다시 확인
};

/** 멱등 처리 결과(최초 응답) */
export type IdempotentResult<T> = {
  status: number;
  body: T;
  refundId?: string;
};

/**
 * 환불 요청의 DB 기반 멱등 처리
 */
@Injectable()
export class RefundIdempotencyService {
  constructor(private readonly repository: RefundIdempotencyRepository) {}

  /**
   * 같은 요청은 최초 응답을 돌려주고, 처음 요청이면 처리한다
   * @param command 요청자·기능·키·본문·권한 재확인
   * @param handler 처음 요청일 때 실행할 처리
   * @returns 최초 응답
   * @throws IdempotencyKeyReusedError 같은 키로 다른 내용을 보냈을 때
   */
  async execute<T>(
    command: IdempotentCommand,
    handler: () => Promise<IdempotentResult<T>>,
  ): Promise<IdempotentResult<T>> {
    // 키가 없으면 멱등 처리 없이 실행한다(상품당 확정 환불 unique가 중복 환불을 막는다)
    if (command.key === undefined) return handler();

    // 처리 중 기록을 먼저 만든다. 이미 있으면 저장된 최초 응답을 돌려준다
    const scope = {
      requesterId: command.requesterId,
      operation: command.operation,
      key: command.key,
    };
    const fingerprint = JSON.stringify(command.request);
    const created = await this.repository.createInProgress(scope, fingerprint);
    if (!created) {
      const existing = await this.repository.find(scope);

      // 같은 키로 다른 내용을 보내면 거절한다
      if (existing!.requestFingerprint !== fingerprint) {
        throw new IdempotencyKeyReusedError();
      }
      return {
        status: existing!.responseStatus!,
        body: existing!.responseBody as T,
      };
    }

    // 처음 요청이면 처리하고 최초 응답을 저장한다
    const result = await handler();
    await this.repository.complete(created.id, result);
    return result;
  }
}
