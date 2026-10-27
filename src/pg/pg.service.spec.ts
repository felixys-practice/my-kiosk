import { ConfigService } from '@nestjs/config';
import { TransactionLoggerService } from '../logger/transaction-logger.service';
import { PgService } from './pg.service';
import { PgCancelInquiryResult } from './pg.types';
import { PgCancelClient, PgRawResponse } from './pg-cancel.client';

/**
 * 원래 응답을 미리 정해 두는 PG 전송 계층 대역
 */
class FakePgCancelClient implements PgCancelClient {
  configured = true;
  sendResponse: () => Promise<PgRawResponse> = () =>
    Promise.resolve({ httpStatus: 202, body: { status: 'ACCEPTED' } });
  inquireResponse: () => Promise<PgRawResponse> = () =>
    Promise.resolve({ httpStatus: 200, body: { status: 'IN_PROGRESS' } });

  send(): Promise<PgRawResponse> {
    return this.sendResponse();
  }

  inquire(): Promise<PgRawResponse> {
    return this.inquireResponse();
  }
}

describe('PgService', () => {
  /** PG 전송·조회 응답 제한(초) — 설정 기본값 */
  const pgTimeoutSeconds = 10;
  const cancelRequest = { paymentCancelId: 'payment-cancel-1' };

  let client: FakePgCancelClient;
  let service: PgService;

  beforeEach(() => {
    client = new FakePgCancelClient();
    const configService = {
      get: (path: string) =>
        path === 'refund.pgTimeoutSeconds' ? pgTimeoutSeconds : undefined,
    } as unknown as ConfigService;
    const transactionLogger = {
      logTransaction: jest.fn(),
      logPaymentRequest: jest.fn(),
      logRefundRequest: jest.fn(),
    } as unknown as TransactionLoggerService;
    service = new PgService(transactionLogger, client, configService);
  });

  describe('현재 동작 기록(특성화)', () => {
    it('PG 거래조회는 지금 어떤 입력이든 NOT_FOUND를 반환한다', async () => {
      const inquiry = await service.inquiryPaymentCancel(
        'order-1',
        'order-item-1',
        'user-1',
        'payment-cancel-1',
      );

      expect(inquiry).toEqual({ result: PgCancelInquiryResult.NOT_FOUND });
    });
  });

  describe('PG 취소 조회 결과 분류 (API 계약 §8)', () => {
    it('authoritative=true인 미접수 응답만 NOT_FOUND로 분류된다', async () => {
      client.inquireResponse = () =>
        Promise.resolve({
          httpStatus: 200,
          body: { status: 'NOT_FOUND', authoritative: true },
        });

      await expect(service.inquireCancel(cancelRequest)).resolves.toEqual({
        result: 'NOT_FOUND',
        authoritative: true,
      });
    });

    it('일반 HTTP 404 응답은 NOT_FOUND가 아니라 QUERY_ERROR로 분류된다', async () => {
      client.inquireResponse = () => Promise.resolve({ httpStatus: 404 });

      await expect(service.inquireCancel(cancelRequest)).resolves.toMatchObject(
        {
          result: 'QUERY_ERROR',
        },
      );
    });

    it('성공 응답에 거래 ID와 실제 취소액이 있으면 SUCCEEDED로 분류된다', async () => {
      client.inquireResponse = () =>
        Promise.resolve({
          httpStatus: 200,
          body: {
            status: 'SUCCEEDED',
            pgTransactionId: 'pg-cancel-tx-1',
            cancelledAmount: 9000,
          },
        });

      await expect(service.inquireCancel(cancelRequest)).resolves.toEqual({
        result: 'SUCCEEDED',
        pgTransactionId: 'pg-cancel-tx-1',
        cancelledAmount: 9000,
      });
    });

    it('성공 응답에 실제 취소 금액이 없으면 QUERY_ERROR로 분류된다', async () => {
      client.inquireResponse = () =>
        Promise.resolve({
          httpStatus: 200,
          body: { status: 'SUCCEEDED', pgTransactionId: 'pg-cancel-tx-1' },
        });

      await expect(service.inquireCancel(cancelRequest)).resolves.toMatchObject(
        {
          result: 'QUERY_ERROR',
        },
      );
    });

    it('실패 확정 응답은 FAILED와 사유로 분류된다', async () => {
      client.inquireResponse = () =>
        Promise.resolve({
          httpStatus: 200,
          body: { status: 'FAILED', reason: '이미 정산된 거래' },
        });

      await expect(service.inquireCancel(cancelRequest)).resolves.toEqual({
        result: 'FAILED',
        reason: '이미 정산된 거래',
      });
    });

    it('처리 중 응답은 IN_PROGRESS로 분류된다', async () => {
      client.inquireResponse = () =>
        Promise.resolve({ httpStatus: 200, body: { status: 'IN_PROGRESS' } });

      await expect(service.inquireCancel(cancelRequest)).resolves.toEqual({
        result: 'IN_PROGRESS',
      });
    });
  });
});
