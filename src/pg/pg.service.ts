import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionLoggerService } from '../logger/transaction-logger.service';
import {
  PgCancelInquiry,
  PgCancelInquiryResult,
  PgCancelQueryResult,
} from './pg.types';
import { PG_CANCEL_CLIENT } from './pg-cancel.client';
import type { PgCancelClient } from './pg-cancel.client';

@Injectable()
export class PgService {
  constructor(
    private readonly transactionLoggerService: TransactionLoggerService,
    @Inject(PG_CANCEL_CLIENT) private readonly cancelClient: PgCancelClient,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 환불 PG 취소 결과를 조회한다 (API 계약 §8)
   * @param request 조회할 PG 취소 요청 식별자
   * @returns 계약 §8의 조회 결과
   */
  inquireCancel(request: {
    paymentCancelId: string;
  }): Promise<PgCancelQueryResult> {
    void request;
    return Promise.resolve({ result: 'NOT_FOUND', authoritative: true });
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
