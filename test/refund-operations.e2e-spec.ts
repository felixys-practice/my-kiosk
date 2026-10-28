/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { randomUUID } from 'crypto';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';

/**
 * 사용자 스토리 10: 점주·운영자의 미지급 환불금 재처리 (E2E)
 * - 테스트 이름 끝의 (QS-n-m)은 specs/002-refund-completion/spec.md 사용자 스토리 n의 인수 시나리오 m
 */
describe('미지급 환불금 재처리 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;
  const retryReason = 'PG 연결 설정을 복구해 다시 요청';

  /**
   * 고객 환불의 최초 PG 취소 요청이 보내기 전에 실패해 조치 필요가 된 환불을 만든다
   * @returns 환불 ID
   */
  async function createFailedRefund(): Promise<string> {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'NOT_SENT', reason: 'PG 연결 설정 누락' });
    const res = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    return res.body.data.refundId as string;
  }

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'operations',
      configure: (builder) =>
        builder.overrideProvider(REFUND_PG_GATEWAY).useValue(pgStub),
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    pgStub.reset();
  });

  it('점주의 PG 직접 재시도는 403 REFUND_FORBIDDEN으로 거절되고 PG 취소 요청이 추가되지 않는다', async () => {
    const refundId = await createFailedRefund();
    pgStub.reset();

    const res = await request(ctx.server)
      .post(`/refund/${refundId}/payout-retries`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('Idempotency-Key', `retry-${randomUUID()}`)
      .send({ reason: retryReason });

    const attempts = await ctx.prisma.paymentCancel.count({
      where: { refundId },
    });
    expect({
      status: res.status,
      code: res.body.error?.code,
      attempts,
      sends: pgStub.sendCalls.length,
    }).toEqual({
      status: 403,
      code: 'REFUND_FORBIDDEN',
      attempts: 1,
      sends: 0,
    });
  });

  it('운영자의 PG 직접 재시도에 Idempotency-Key가 없으면 400 IDEMPOTENCY_KEY_REQUIRED로 거절되고 PG 취소 요청이 추가되지 않는다', async () => {
    const refundId = await createFailedRefund();
    pgStub.reset();

    const res = await request(ctx.server)
      .post(`/refund/${refundId}/payout-retries`)
      .set('Authorization', `Bearer ${ctx.manager.token}`)
      .send({ reason: retryReason });

    const attempts = await ctx.prisma.paymentCancel.count({
      where: { refundId },
    });
    expect({
      status: res.status,
      code: res.body.error?.code,
      attempts,
      sends: pgStub.sendCalls.length,
    }).toEqual({
      status: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      attempts: 1,
      sends: 0,
    });
  });
});
