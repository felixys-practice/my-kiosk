import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionLoggerService } from '../logger/transaction-logger.service';
import type { PgCancelQueryResult, PgCancelSendResult } from './pg.types';
import { PG_CLIENT } from './pg.client';
import type {
  PgClient,
  PgPaymentCancelRequest,
  PgPaymentCancelInquiry,
} from './pg.client';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
const timedOut = Symbol('PG 응답 시간 초과');

@Injectable()
export class PgService {
  constructor(
    private readonly transactionLoggerService: TransactionLoggerService,
    @Inject(PG_CLIENT) private readonly client: PgClient,
    private readonly configService: ConfigService,
  ) {}

  /** PG 취소 요청의 제한 시간·예외·성공 정보를 검사하고 결과를 업무 서비스에 전달한다. */
  async requestPaymentCancel(
    request: PgPaymentCancelRequest,
  ): Promise<PgCancelSendResult> {
    try {
      const result = await this.withinPgTimeout((signal) =>
        this.client.requestPaymentCancel(request, signal),
      );
      if (result === timedOut)
        return { result: 'UNKNOWN', reason: 'PG 송신 응답 시간 초과' };
      if (
        result.result === 'SUCCEEDED' &&
        (result.paymentCancelId !== request.paymentCancelId ||
          !this.hasValidTransactionId(result.pgTransactionId) ||
          !Number.isSafeInteger(result.cancelledAmount) ||
          result.cancelledAmount < 0)
      ) {
        return {
          result: 'UNKNOWN',
          reason:
            'PG 취소 성공 결과의 요청 ID가 일치하지 않거나 거래 ID·실제 취소액이 유효하지 않습니다',
        };
      }
      return result;
    } catch (error) {
      return {
        result: 'UNKNOWN',
        reason: `PG 송신 오류: ${errorMessage(error)}`,
      };
    }
  }

  /** PG 취소 조회의 제한 시간·예외·성공 정보를 검사한다. */
  async inquirePaymentCancel(
    request: PgPaymentCancelInquiry,
  ): Promise<PgCancelQueryResult> {
    try {
      const result = await this.withinPgTimeout((signal) =>
        this.client.inquirePaymentCancel(request, signal),
      );
      if (result === timedOut)
        return { result: 'QUERY_ERROR', reason: 'PG 조회 응답 시간 초과' };
      if (
        result.result === 'SUCCEEDED' &&
        (result.paymentCancelId !== request.paymentCancelId ||
          !this.hasValidTransactionId(result.pgTransactionId) ||
          !Number.isSafeInteger(result.cancelledAmount) ||
          result.cancelledAmount < 0)
      ) {
        return {
          result: 'QUERY_ERROR',
          reason:
            'PG 취소 성공 결과의 요청 ID가 일치하지 않거나 거래 ID·실제 취소액이 유효하지 않습니다',
        };
      }
      return result;
    } catch (error) {
      return {
        result: 'QUERY_ERROR',
        reason: `PG 조회 오류: ${errorMessage(error)}`,
      };
    }
  }

  private hasValidTransactionId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private async withinPgTimeout<T>(
    call: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | typeof timedOut> {
    const controller = new AbortController();
    const timeoutMs =
      this.configService.get<number>('refund.pgTimeoutSeconds')! * 1000;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => {
        // 시간 초과를 먼저 확정한 뒤 호출을 중단한다(중단에 반응해 거부하는 전송 계층이 먼저 끝나지 않게)
        resolve(timedOut);
        controller.abort();
      }, timeoutMs);
    });
    try {
      return await Promise.race([call(controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  // PG 결제 승인 요청
  async requestPaymentApproval(
    orderId: string,
    orderItemId: string,
    userId: string,
    amount: number,
  ) {
    // TODO: PG 결제 승인 요청
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 500);
    });

    this.transactionLoggerService.logPaymentRequest(
      orderId,
      userId,
      amount,
      'POST',
    );
  }
}
