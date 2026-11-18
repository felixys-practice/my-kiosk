import { vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { TransactionLoggerService } from '../logger/transaction-logger.service';
import { PgService } from './pg.service';
import type {
  PgClient,
  PgPaymentCancelRequest,
  PgPaymentCancelInquiry,
  PgClientConfigurationResult,
} from './pg.client';
import type { PgCancelSendResult, PgCancelQueryResult } from './pg.types';

describe('PgService', () => {
  let client: {
    validateConfiguration: () => PgClientConfigurationResult;
    requestPaymentCancel: (
      request: PgPaymentCancelRequest,
      signal: AbortSignal,
    ) => Promise<PgCancelSendResult>;
    inquirePaymentCancel: (
      request: PgPaymentCancelInquiry,
      signal: AbortSignal,
    ) => Promise<PgCancelQueryResult>;
  };
  let service: PgService;
  const request = { paymentCancelId: 'cancel-service', amount: 10000 };
  beforeEach(() => {
    client = {
      validateConfiguration: () => ({ ready: true }),
      requestPaymentCancel: vi.fn().mockResolvedValue({ result: 'ACCEPTED' }),
      inquirePaymentCancel: vi
        .fn()
        .mockResolvedValue({ result: 'IN_PROGRESS' }),
    };
    service = new PgService({} as TransactionLoggerService, client, {
      get: () => 10,
    } as unknown as ConfigService);
  });
  afterEach(() => vi.useRealTimers());

  it.each<PgCancelSendResult>([
    { result: 'NOT_SENT', reason: '전송 전 설정 오류' },
    { result: 'ACCEPTED' },
    { result: 'UNKNOWN', reason: 'HTTP 401·판단 불가' },
    {
      result: 'SUCCEEDED',
      paymentCancelId: 'cancel-service',
      pgTransactionId: 'pg-success',
      cancelledAmount: 9000,
    },
    { result: 'REJECTED', reason: '취소 가능 기간 경과' },
  ])(
    '취소 요청의 클라이언트 결과 $result와 실제액·사유를 보존한다',
    async (result) => {
      vi.mocked(client.requestPaymentCancel).mockResolvedValue(result);
      expect(await service.requestPaymentCancel(request)).toEqual(result);
      expect(client.requestPaymentCancel).toHaveBeenCalledWith(
        request,
        expect.any(AbortSignal),
      );
    },
  );
  it.each<PgCancelQueryResult>([
    {
      result: 'SUCCEEDED',
      paymentCancelId: 'cancel-service',
      pgTransactionId: 'pg-success',
      cancelledAmount: 9000,
    },
    { result: 'FAILED', reason: '이미 정산된 거래' },
    { result: 'IN_PROGRESS' },
    { result: 'NOT_FOUND', authoritative: true },
    { result: 'QUERY_ERROR', reason: 'HTTP 404' },
    { result: 'QUERY_ERROR', reason: '상태 없는 오류 문자열' },
    { result: 'QUERY_ERROR', reason: 'PG 인증 오류' },
    { result: 'QUERY_ERROR', reason: '클라이언트가 조회 불가를 확인함' },
  ])(
    '취소 조회의 클라이언트 결과 $result와 실제액·사유를 보존한다',
    async (result) => {
      vi.mocked(client.inquirePaymentCancel).mockResolvedValue(result);
      expect(await service.inquirePaymentCancel(request)).toEqual(result);
      expect(client.inquirePaymentCancel).toHaveBeenCalledWith(
        request,
        expect.any(AbortSignal),
      );
    },
  );
  for (const operation of [
    'requestPaymentCancel',
    'inquirePaymentCancel',
  ] as const) {
    for (const kind of ['동기 예외', '비동기 거부'] as const) {
      it(`${operation}의 ${kind}는 미전송·실패 확정으로 추정하지 않는다`, async () => {
        vi.mocked(client[operation]).mockImplementation(() => {
          if (kind === '동기 예외') throw new Error('socket reset');
          return Promise.reject(new Error('socket reset'));
        });
        expect(await service[operation](request)).toMatchObject({
          result:
            operation === 'requestPaymentCancel' ? 'UNKNOWN' : 'QUERY_ERROR',
        });
      });
    }
    for (const abortReject of [false, true]) {
      it(`${operation} 제한 시간 초과는 중단 신호를 전달하고 타이머를 정리한다 (중단 거부=${abortReject})`, async () => {
        vi.useFakeTimers();
        let received: AbortSignal | undefined;
        vi.mocked(client[operation]).mockImplementation(
          (_request: unknown, signal: AbortSignal) =>
            new Promise<never>((_resolve, reject) => {
              received = signal;
              if (abortReject)
                signal.addEventListener('abort', () =>
                  reject(new Error('aborted')),
                );
            }),
        );
        const pending = service[operation](request);
        await vi.advanceTimersByTimeAsync(10000);
        expect(await pending).toEqual({
          result:
            operation === 'requestPaymentCancel' ? 'UNKNOWN' : 'QUERY_ERROR',
          reason:
            operation === 'requestPaymentCancel'
              ? 'PG 송신 응답 시간 초과'
              : 'PG 조회 응답 시간 초과',
        });
        expect(received?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      });
    }
  }
  it('정상 응답 후 응답 제한 타이머를 정리한다', async () => {
    vi.useFakeTimers();
    await service.requestPaymentCancel(request);
    await service.inquirePaymentCancel(request);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('PgService 성공 결과 검증', () => {
  it('거래 ID가 비어 있는 취소 성공은 UNKNOWN이다', async () => {
    const client = {
      requestPaymentCancel: () =>
        Promise.resolve({
          result: 'SUCCEEDED',
          paymentCancelId: 'invalid',
          pgTransactionId: '',
          cancelledAmount: 100,
        }),
    } as unknown as PgClient;
    const service = new PgService({} as TransactionLoggerService, client, {
      get: () => 10,
    } as unknown as ConfigService);
    expect(
      await service.requestPaymentCancel({
        paymentCancelId: 'invalid',
        amount: 100,
      }),
    ).toMatchObject({ result: 'UNKNOWN' });
  });
});
describe('PgService 조회 거래 ID 검증', () => {
  it('조회 성공의 빈 거래 ID는 QUERY_ERROR다', async () => {
    const client = {
      inquirePaymentCancel: () =>
        Promise.resolve({
          result: 'SUCCEEDED',
          paymentCancelId: 'invalid',
          pgTransactionId: '',
          cancelledAmount: 100,
        }),
    } as unknown as PgClient;
    const service = new PgService({} as TransactionLoggerService, client, {
      get: () => 10,
    } as unknown as ConfigService);
    expect(
      await service.inquirePaymentCancel({ paymentCancelId: 'invalid' }),
    ).toMatchObject({ result: 'QUERY_ERROR' });
  });
});
describe('PgService 실제 취소액 검증', () => {
  it('요청 성공의 음수 실제액은 UNKNOWN이다', async () => {
    const client = {
      requestPaymentCancel: () =>
        Promise.resolve({
          result: 'SUCCEEDED',
          paymentCancelId: 'invalid',
          pgTransactionId: 'tx',
          cancelledAmount: -1,
        }),
    } as unknown as PgClient;
    const service = new PgService({} as TransactionLoggerService, client, {
      get: () => 10,
    } as unknown as ConfigService);
    expect(
      await service.requestPaymentCancel({
        paymentCancelId: 'invalid',
        amount: 100,
      }),
    ).toMatchObject({ result: 'UNKNOWN' });
  });
});
describe('PgService 조회 실제액 검증', () => {
  it('조회 성공의 음수 실제액은 QUERY_ERROR다', async () => {
    const client = {
      inquirePaymentCancel: () =>
        Promise.resolve({
          result: 'SUCCEEDED',
          paymentCancelId: 'invalid',
          pgTransactionId: 'tx',
          cancelledAmount: -1,
        }),
    } as unknown as PgClient;
    const service = new PgService({} as TransactionLoggerService, client, {
      get: () => 10,
    } as unknown as ConfigService);
    expect(
      await service.inquirePaymentCancel({ paymentCancelId: 'invalid' }),
    ).toMatchObject({ result: 'QUERY_ERROR' });
  });
});

describe('PgService 성공 정보 경계', () => {
  for (const operation of [
    'requestPaymentCancel',
    'inquirePaymentCancel',
  ] as const) {
    it.each([
      { pgTransactionId: undefined, cancelledAmount: 100 },
      { pgTransactionId: '   ', cancelledAmount: 100 },
      ...[undefined, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(
        (cancelledAmount) => ({ pgTransactionId: 'tx', cancelledAmount }),
      ),
    ])(
      `${operation}의 잘못된 성공 정보 %j를 지급 근거로 전달하지 않는다`,
      async (fields) => {
        const client = {
          [operation]: () =>
            Promise.resolve({
              result: 'SUCCEEDED',
              paymentCancelId: 'invalid',
              ...fields,
            }),
        } as unknown as PgClient;
        const service = new PgService({} as TransactionLoggerService, client, {
          get: () => 10,
        } as unknown as ConfigService);
        expect(
          await service[operation]({ paymentCancelId: 'invalid', amount: 100 }),
        ).toMatchObject({
          result:
            operation === 'requestPaymentCancel' ? 'UNKNOWN' : 'QUERY_ERROR',
        });
      },
    );
    it.each([0, Number.MAX_SAFE_INTEGER])(
      `${operation}의 유효한 실제액 %s를 그대로 전달한다`,
      async (cancelledAmount) => {
        const result = {
          result: 'SUCCEEDED',
          paymentCancelId: 'valid',
          pgTransactionId: 'tx',
          cancelledAmount,
        };
        const client = {
          [operation]: () => Promise.resolve(result),
        } as unknown as PgClient;
        const service = new PgService({} as TransactionLoggerService, client, {
          get: () => 10,
        } as unknown as ConfigService);
        expect(
          await service[operation]({ paymentCancelId: 'valid', amount: 100 }),
        ).toEqual(result);
      },
    );
  }
});

describe('PG 성공 응답의 요청 식별자 대조', () => {
  for (const operation of [
    'requestPaymentCancel',
    'inquirePaymentCancel',
  ] as const) {
    it.each([undefined, '', 'another-cancel', 'requested-cancel'])(
      `${operation}: 응답 paymentCancelId=%s를 요청 ID와 대조한다`,
      async (paymentCancelId) => {
        const response = {
          result: 'SUCCEEDED',
          paymentCancelId,
          pgTransactionId: 'pg-cancel',
          cancelledAmount: 100,
        };
        const client = {
          [operation]: () => Promise.resolve(response),
        } as unknown as PgClient;
        const service = new PgService({} as TransactionLoggerService, client, {
          get: () => 10,
        } as unknown as ConfigService);
        const result = await service[operation]({
          paymentCancelId: 'requested-cancel',
          amount: 100,
        });
        if (paymentCancelId === 'requested-cancel')
          expect(result).toEqual(response);
        else
          expect(result).toMatchObject({
            result:
              operation === 'requestPaymentCancel' ? 'UNKNOWN' : 'QUERY_ERROR',
          });
      },
    );
  }
});
