import { randomUUID } from 'node:crypto';
import type {
  PgClient,
  PgClientConfigurationResult,
  PgPaymentCancelInquiry,
  PgPaymentCancelRequest,
} from './pg.client';
import type { PgCancelQueryResult, PgCancelSendResult } from './pg.types';

export class SimulatedPgClient implements PgClient {
  private readonly cancelResults = new Map<
    string,
    Extract<PgCancelSendResult, { result: 'SUCCEEDED' }>
  >();

  validateConfiguration(): PgClientConfigurationResult {
    return { ready: true };
  }

  requestPaymentCancel(
    request: PgPaymentCancelRequest,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 현재는 대기 중인 통신 작업이 없다.
    _signal: AbortSignal,
  ): Promise<PgCancelSendResult> {
    if (!Number.isSafeInteger(request.amount) || request.amount < 0) {
      return Promise.resolve({
        result: 'NOT_SENT',
        reason: '취소 요청 금액은 0 이상 안전 정수여야 합니다',
      });
    }
    const previous = this.cancelResults.get(request.paymentCancelId);
    if (previous && previous.cancelledAmount === request.amount) {
      return Promise.resolve({ ...previous });
    }
    if (previous) {
      return Promise.resolve({
        result: 'UNKNOWN',
        reason: '같은 취소 요청 ID에 다른 금액이 지정되었습니다',
      });
    }
    const result = {
      result: 'SUCCEEDED' as const,
      paymentCancelId: request.paymentCancelId,
      pgTransactionId: `simulated-${randomUUID()}`,
      cancelledAmount: request.amount,
    };
    this.cancelResults.set(request.paymentCancelId, result);
    return Promise.resolve({ ...result });
  }

  inquirePaymentCancel(
    request: PgPaymentCancelInquiry,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 현재는 대기 중인 통신 작업이 없다.
    _signal: AbortSignal,
  ): Promise<PgCancelQueryResult> {
    const result = this.cancelResults.get(request.paymentCancelId);
    if (result) return Promise.resolve({ ...result });
    return Promise.resolve({
      result: 'QUERY_ERROR',
      reason: '해당 취소 요청의 모의 처리 기록이 없습니다',
    });
  }
}
