import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionLoggerService } from '../logger/transaction-logger.service';
import {
  PgCancelInquiry,
  PgCancelInquiryResult,
  PgCancelQueryResult,
  PgCancelSendResult,
} from './pg.types';
import { PG_CANCEL_CLIENT } from './pg-cancel.client';
import type {
  PgCancelClient,
  PgCancelRequest,
  PgRawResponse,
} from './pg-cancel.client';

/**
 * 오류 메시지를 꺼낸다
 * @param error 잡은 오류
 * @returns 메시지
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** PG 응답 제한 시간 초과 표시 */
const timedOut = Symbol('PG 응답 시간 초과');

@Injectable()
export class PgService {
  constructor(
    private readonly transactionLoggerService: TransactionLoggerService,
    @Inject(PG_CANCEL_CLIENT) private readonly cancelClient: PgCancelClient,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 환불 PG 취소를 보낸다 (API 계약 §8)
   * @param request PG 취소 요청 식별자(PG 멱등 키)와 금액
   * @returns 계약 §8의 송신 결과
   */
  async sendCancel(request: PgCancelRequest): Promise<PgCancelSendResult> {
    // 실제 PG가 연결되지 않았으면 보내기 전 실패가 확실하다
    if (!this.cancelClient.configured) {
      return { result: 'NOT_SENT', reason: 'PG 미연동' };
    }

    // PG 원래 응답을 응답 제한 시간 안에 받는다. 시간 초과는 PG 도달 여부를 모르므로 결과 불명이다
    let response: PgRawResponse | typeof timedOut;
    try {
      response = await this.withinPgTimeout((signal) =>
        this.cancelClient.send(request, signal),
      );
    } catch (error) {
      // 전송 중 예외는 PG 도달 여부를 모르므로 결과 불명이다(보내기 전 실패가 확인된 경우만 NOT_SENT)
      return {
        result: 'UNKNOWN',
        reason: `PG 송신 오류: ${errorMessage(error)}`,
      };
    }
    if (response === timedOut) {
      return { result: 'UNKNOWN', reason: 'PG 송신 응답 시간 초과' };
    }

    // PG가 접수만 함(최종 결과는 조회로 확인)
    const body = response.body;
    if (body?.status === 'ACCEPTED') return { result: 'ACCEPTED' };

    // PG가 즉시 취소함. 실제 취소액·거래 ID가 없으면 결과를 모르는 것으로 둔다
    if (
      body?.status === 'SUCCEEDED' &&
      typeof body.cancelledAmount === 'number' &&
      typeof body.pgTransactionId === 'string'
    ) {
      return {
        result: 'SUCCEEDED',
        pgTransactionId: body.pgTransactionId,
        cancelledAmount: body.cancelledAmount,
      };
    }

    // PG가 해당 요청을 거절함
    if (response.httpStatus === 200 && body?.status === 'REJECTED') {
      return { result: 'REJECTED', reason: body.reason ?? '' };
    }

    // 판단할 수 없는 응답은 보낸 뒤 결과를 모르는 것으로 보고 조회로 확인한다
    return {
      result: 'UNKNOWN',
      reason: `판단할 수 없는 PG 송신 응답(HTTP ${response.httpStatus})`,
    };
  }

  /**
   * 환불 PG 취소 결과를 조회한다 (API 계약 §8)
   * @param request 조회할 PG 취소 요청 식별자
   * @returns 계약 §8의 조회 결과
   */
  async inquireCancel(request: {
    paymentCancelId: string;
  }): Promise<PgCancelQueryResult> {
    // 실제 PG가 연결되지 않았으면 결과를 알 수 없으므로 조회 오류다
    if (!this.cancelClient.configured) {
      return { result: 'QUERY_ERROR', reason: 'PG 미연동' };
    }

    // PG 원래 응답을 응답 제한 시간 안에 받는다. 시간 초과는 결과를 알 수 없으므로 조회 오류다
    let response: PgRawResponse | typeof timedOut;
    try {
      response = await this.withinPgTimeout((signal) =>
        this.cancelClient.inquire(request, signal),
      );
    } catch (error) {
      // 조회 중 예외는 결과를 알 수 없으므로 조회 오류다
      return {
        result: 'QUERY_ERROR',
        reason: `PG 조회 오류: ${errorMessage(error)}`,
      };
    }
    if (response === timedOut) {
      return { result: 'QUERY_ERROR', reason: 'PG 조회 응답 시간 초과' };
    }

    // PG가 미접수를 확정한 응답만 NOT_FOUND다. 일반 HTTP 404는 미접수 근거가 아니다
    if (
      response.httpStatus === 200 &&
      response.body?.status === 'NOT_FOUND' &&
      response.body.authoritative === true
    ) {
      return { result: 'NOT_FOUND', authoritative: true };
    }

    // 취소 성공. 실제 취소액·거래 ID가 없으면 지급액을 알 수 없으므로 조회 오류로 둔다
    const body = response.body;
    if (
      response.httpStatus === 200 &&
      body?.status === 'SUCCEEDED' &&
      typeof body.cancelledAmount === 'number' &&
      typeof body.pgTransactionId === 'string'
    ) {
      return {
        result: 'SUCCEEDED',
        pgTransactionId: body.pgTransactionId,
        cancelledAmount: body.cancelledAmount,
      };
    }
    // PG가 처리 중
    if (response.httpStatus === 200 && body?.status === 'IN_PROGRESS') {
      return { result: 'IN_PROGRESS' };
    }

    // PG가 취소 실패를 확정함
    if (response.httpStatus === 200 && body?.status === 'FAILED') {
      return { result: 'FAILED', reason: body.reason ?? '' };
    }
    return {
      result: 'QUERY_ERROR',
      reason: `판단할 수 없는 PG 조회 응답(HTTP ${response.httpStatus})`,
    };
  }

  /**
   * PG 호출을 응답 제한 시간(refund.pgTimeoutSeconds) 안에 끝낸다
   * - 시간이 지나면 호출을 중단(abort)하고 timedOut을 돌려준다
   * @param call 중단 신호를 받아 PG를 호출하는 함수
   * @returns PG 원래 응답, 시간 초과면 timedOut
   */
  private async withinPgTimeout(
    call: (signal: AbortSignal) => Promise<PgRawResponse>,
  ): Promise<PgRawResponse | typeof timedOut> {
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

  // PG 결제 취소(환불) 요청
  async requestPaymentCancel(
    paymentCancelId: string,
    orderId: string,
    orderItemId: string,
    userId: string,
    amount: number,
  ) {
    // TODO: PG 결제 환불 요청
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 500);
    });

    this.transactionLoggerService.logRefundRequest(
      paymentCancelId,
      orderId,
      orderItemId,
      userId,
      amount,
    );
  }

  // PG 취소 거래조회 - 락 만료 후 재시도 시 이전 취소 요청의 실제 처리 상태를 확인하기 위해 사용
  async inquiryPaymentCancel(
    orderId: string,
    orderItemId: string,
    userId: string,
    paymentCancelId: string,
  ): Promise<PgCancelInquiry> {
    // TODO: 실제 PG 거래조회 API 연동
    // 실제 PG 연동 전이므로 가장 보수적인 가정(요청이 PG에 도달하지 않았다)으로 항상 NOT_FOUND 반환
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 500);
    });

    this.transactionLoggerService.logTransaction({
      transactionId: `REFUND-INQUIRY-${paymentCancelId}-${Date.now()}`,
      type: 'REFUND',
      userId,
      orderId,
      orderItemId,
      status: 'INQUIRY',
      metadata: { paymentCancelId, result: PgCancelInquiryResult.NOT_FOUND },
    });

    return { result: PgCancelInquiryResult.NOT_FOUND };
  }
}
