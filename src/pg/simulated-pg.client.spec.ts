/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest의 비대칭 matcher를 기대값으로 사용한다. */
import { SimulatedPgClient } from './simulated-pg.client';

describe('SimulatedPgClient', () => {
  it.each([0, Number.MAX_SAFE_INTEGER])(
    '유효한 경계 금액 %s를 그대로 취소한다',
    async (amount) => {
      const client = new SimulatedPgClient();
      expect(
        await client.requestPaymentCancel(
          { paymentCancelId: 'cancel-boundary', amount },
          new AbortController().signal,
        ),
      ).toEqual({
        result: 'SUCCEEDED',
        paymentCancelId: 'cancel-boundary',
        pgTransactionId: expect.stringMatching(/^simulated-.+/),
        cancelledAmount: amount,
      });
    },
  );
  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    '유효하지 않은 금액 %s는 요청 전에 거부하고 결과를 저장하지 않는다',
    async (amount) => {
      const client = new SimulatedPgClient();
      const signal = new AbortController().signal;
      expect(
        await client.requestPaymentCancel(
          { paymentCancelId: 'cancel-invalid', amount },
          signal,
        ),
      ).toEqual({ result: 'NOT_SENT', reason: expect.any(String) });
      expect(
        await client.inquirePaymentCancel(
          { paymentCancelId: 'cancel-invalid' },
          signal,
        ),
      ).toEqual({ result: 'QUERY_ERROR', reason: expect.any(String) });
    },
  );
  it.each([
    ['기록 없는 ID', false],
    ['다른 인스턴스의 ID', true],
    ['기존 인스턴스를 대체한 새 인스턴스의 ID', true],
  ])(
    '%s 조회는 확정 미접수가 아닌 QUERY_ERROR를 반환한다',
    async (_label, stored) => {
      const signal = new AbortController().signal;
      if (stored) {
        await new SimulatedPgClient().requestPaymentCancel(
          { paymentCancelId: 'cancel-absent', amount: 12000 },
          signal,
        );
      }
      const result = await new SimulatedPgClient().inquirePaymentCancel(
        { paymentCancelId: 'cancel-absent' },
        signal,
      );
      expect(result).toEqual({
        result: 'QUERY_ERROR',
        reason: expect.any(String),
      });
    },
  );
  it('같은 ID로 다른 금액을 요청하면 UNKNOWN을 반환하고 최초 조회 결과를 유지한다', async () => {
    const client = new SimulatedPgClient();
    const signal = new AbortController().signal;
    const first = await client.requestPaymentCancel(
      { paymentCancelId: 'cancel-conflict', amount: 12000 },
      signal,
    );
    expect(
      await client.requestPaymentCancel(
        { paymentCancelId: 'cancel-conflict', amount: 7000 },
        signal,
      ),
    ).toEqual({ result: 'UNKNOWN', reason: expect.any(String) });
    expect(
      await client.inquirePaymentCancel(
        { paymentCancelId: 'cancel-conflict' },
        signal,
      ),
    ).toEqual(first);
  });
  it('같은 ID와 금액으로 재요청하면 최초 거래 결과를 반환하고 조회 결과도 유지한다', async () => {
    const client = new SimulatedPgClient();
    const request = { paymentCancelId: 'cancel-repeat', amount: 12000 };
    const signal = new AbortController().signal;
    const first = await client.requestPaymentCancel(request, signal);

    expect(await client.requestPaymentCancel(request, signal)).toEqual(first);
    expect(await client.inquirePaymentCancel(request, signal)).toEqual(first);
  });
  it('취소 요청 ID로 조회하면 저장된 취소 거래 ID와 실제 취소액을 반환한다', async () => {
    const client = new SimulatedPgClient();
    const signal = new AbortController().signal;
    const first = await client.requestPaymentCancel(
      { paymentCancelId: 'cancel-stored', amount: 12000 },
      signal,
    );
    const second = await client.requestPaymentCancel(
      { paymentCancelId: 'cancel-other', amount: 7000 },
      signal,
    );

    expect(
      await client.inquirePaymentCancel(
        { paymentCancelId: 'cancel-stored' },
        signal,
      ),
    ).toEqual(first);
    expect(
      await client.inquirePaymentCancel(
        { paymentCancelId: 'cancel-other' },
        signal,
      ),
    ).toEqual(second);
  });
  it('최초 취소 요청에 요청액 전액과 모의 거래 ID를 포함한 성공 결과를 반환한다', async () => {
    const client = new SimulatedPgClient();

    const result = await client.requestPaymentCancel(
      { paymentCancelId: 'cancel-first', amount: 12000 },
      new AbortController().signal,
    );

    expect(result).toEqual({
      result: 'SUCCEEDED',
      paymentCancelId: 'cancel-first',
      pgTransactionId: expect.stringMatching(/^simulated-.+/),
      cancelledAmount: 12000,
    });
  });
});
