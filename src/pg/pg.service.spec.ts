import { ConfigService } from '@nestjs/config';
import { TransactionLoggerService } from '../logger/transaction-logger.service';
import { PgService } from './pg.service';
import { PgCancelInquiryResult } from './pg.types';
import {
  PgCancelClient,
  PgRawResponse,
  UnconfiguredPgCancelClient,
} from './pg-cancel.client';

/**
 * 원래 응답을 미리 정해 두는 PG 전송 계층 대역
 */
/**
 * 중단 신호를 받으면 AbortError로 거부하고, 그 전에는 응답하지 않는 전송 계층 응답
 * @param signal 중단 신호
 * @returns 응답하지 않는 Promise
 */
function rejectOnAbort(signal: AbortSignal): Promise<PgRawResponse> {
  return new Promise<PgRawResponse>((_resolve, reject) => {
    signal.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    );
  });
}

class FakePgCancelClient implements PgCancelClient {
  configured = true;
  sendResponse: (signal: AbortSignal) => Promise<PgRawResponse> = () =>
    Promise.resolve({ httpStatus: 202, body: { status: 'ACCEPTED' } });
  inquireResponse: (signal: AbortSignal) => Promise<PgRawResponse> = () =>
    Promise.resolve({ httpStatus: 200, body: { status: 'IN_PROGRESS' } });

  send(_request: unknown, signal: AbortSignal): Promise<PgRawResponse> {
    return this.sendResponse(signal);
  }

  inquire(_request: unknown, signal: AbortSignal): Promise<PgRawResponse> {
    return this.inquireResponse(signal);
  }
}

describe('PgService', () => {
  /** PG 전송·조회 응답 제한(초) — 설정 기본값 */
  const pgTimeoutSeconds = 10;
  const cancelRequest = { paymentCancelId: 'payment-cancel-1' };

  let client: FakePgCancelClient;
  let service: PgService;

  afterEach(() => {
    jest.useRealTimers();
  });

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

    it('PG 인증 오류 응답은 실패 확정이 아니라 QUERY_ERROR로 분류된다', async () => {
      client.inquireResponse = () =>
        Promise.resolve({
          httpStatus: 401,
          body: { status: 'FAILED', reason: '가맹점 인증 실패' },
        });

      await expect(service.inquireCancel(cancelRequest)).resolves.toMatchObject(
        {
          result: 'QUERY_ERROR',
        },
      );
    });

    it('조회 응답이 제한 시간(REFUND_PG_TIMEOUT_SECONDS)을 넘으면 QUERY_ERROR로 분류된다', async () => {
      jest.useFakeTimers();
      client.inquireResponse = () => new Promise<PgRawResponse>(() => {});

      const pending = service.inquireCancel(cancelRequest);
      await jest.advanceTimersByTimeAsync(pgTimeoutSeconds * 1000);

      await expect(pending).resolves.toMatchObject({ result: 'QUERY_ERROR' });
    });

    it('PG 미연동 상태의 조회 결과는 QUERY_ERROR다', async () => {
      const unconfigured = new PgService(
        {} as TransactionLoggerService,
        new UnconfiguredPgCancelClient(),
        { get: () => pgTimeoutSeconds } as unknown as ConfigService,
      );

      await expect(
        unconfigured.inquireCancel(cancelRequest),
      ).resolves.toMatchObject({ result: 'QUERY_ERROR' });
    });

    it.each([
      [
        '비동기 거부',
        (): Promise<PgRawResponse> => Promise.reject(new Error('socket reset')),
      ],
      [
        '동기 throw',
        (): Promise<PgRawResponse> => {
          throw new Error('socket reset');
        },
      ],
    ])(
      '조회 중 전송 계층이 예외(%s)를 내면 QUERY_ERROR다',
      async (_kind, failure) => {
        client.inquireResponse = failure;

        await expect(
          service.inquireCancel(cancelRequest),
        ).resolves.toMatchObject({ result: 'QUERY_ERROR' });
      },
    );
  });

  describe('PG 취소 송신 결과 분류 (API 계약 §8)', () => {
    const sendRequest = { paymentCancelId: 'payment-cancel-1', amount: 10000 };

    it('PG 미연동 상태의 취소 전송 결과는 NOT_SENT다', async () => {
      const unconfigured = new PgService(
        {} as TransactionLoggerService,
        new UnconfiguredPgCancelClient(),
        { get: () => pgTimeoutSeconds } as unknown as ConfigService,
      );

      await expect(unconfigured.sendCancel(sendRequest)).resolves.toMatchObject(
        { result: 'NOT_SENT' },
      );
    });

    it('PG가 접수만 한 응답은 ACCEPTED로 분류된다', async () => {
      client.sendResponse = () =>
        Promise.resolve({ httpStatus: 202, body: { status: 'ACCEPTED' } });

      await expect(service.sendCancel(sendRequest)).resolves.toEqual({
        result: 'ACCEPTED',
      });
    });

    it('PG가 즉시 취소한 응답은 거래 ID·실제 취소액과 함께 SUCCEEDED로 분류된다', async () => {
      client.sendResponse = () =>
        Promise.resolve({
          httpStatus: 200,
          body: {
            status: 'SUCCEEDED',
            pgTransactionId: 'pg-cancel-tx-1',
            cancelledAmount: 10000,
          },
        });

      await expect(service.sendCancel(sendRequest)).resolves.toEqual({
        result: 'SUCCEEDED',
        pgTransactionId: 'pg-cancel-tx-1',
        cancelledAmount: 10000,
      });
    });

    it('PG가 거절한 응답은 사유와 함께 REJECTED로 분류된다', async () => {
      client.sendResponse = () =>
        Promise.resolve({
          httpStatus: 200,
          body: { status: 'REJECTED', reason: '취소 가능 기간 경과' },
        });

      await expect(service.sendCancel(sendRequest)).resolves.toEqual({
        result: 'REJECTED',
        reason: '취소 가능 기간 경과',
      });
    });

    it('취소 전송 응답이 제한 시간을 넘으면 결과 불명(UNKNOWN)이다', async () => {
      jest.useFakeTimers();
      client.sendResponse = () => new Promise<PgRawResponse>(() => {});

      const pending = service.sendCancel(sendRequest);
      await jest.advanceTimersByTimeAsync(pgTimeoutSeconds * 1000);

      await expect(pending).resolves.toMatchObject({ result: 'UNKNOWN' });
    });

    it.each([
      [
        '비동기 거부',
        (): Promise<PgRawResponse> => Promise.reject(new Error('socket reset')),
      ],
      [
        '동기 throw',
        (): Promise<PgRawResponse> => {
          throw new Error('socket reset');
        },
      ],
    ])(
      '송신 중 전송 계층이 예외(%s)를 내면 보내졌는지 모르므로 UNKNOWN이다',
      async (_kind, failure) => {
        client.sendResponse = failure;

        await expect(service.sendCancel(sendRequest)).resolves.toMatchObject({
          result: 'UNKNOWN',
        });
      },
    );

    it('중단 신호에 반응해 거부하는 전송 계층이라도 송신 시간 초과는 시간 초과 사유의 UNKNOWN이다', async () => {
      jest.useFakeTimers();
      client.sendResponse = rejectOnAbort;

      const pending = service.sendCancel(sendRequest);
      await jest.advanceTimersByTimeAsync(pgTimeoutSeconds * 1000);

      await expect(pending).resolves.toEqual({
        result: 'UNKNOWN',
        reason: 'PG 송신 응답 시간 초과',
      });
    });
  });
});
