import request from 'supertest';
import { randomUUID } from 'crypto';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';

/** 환불 경로 사이의 동시 실행에서 실제 DB 제약과 PG 호출 수를 확인한다. */
describe('환불 동시성 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'concurrency',
      configure: (builder) =>
        builder.overrideProvider(REFUND_PG_GATEWAY).useValue(pgStub),
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => pgStub.reset());

  it('U403 고객과 점주가 같은 이용권을 동시에 환불해도 확정 환불·활성 PG 요청·PG 전송은 각각 한 건이다', async () => {
    const issued = await ctx.issuePeriodTicket();
    const [customer, store] = await Promise.all([
      request(ctx.server)
        .post('/refund')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true }),
      request(ctx.server)
        .post(`/refund/shop/${ctx.shop.id}`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          ticketId: issued.ticketId,
          amount: issued.amount,
          reason: '고객 요청',
          consentToTerminateTicket: true,
        }),
    ]);
    expect([customer.status, store.status].sort()).toEqual([202, 409]);
    expect(
      await ctx.prisma.refund.count({
        where: { orderItemId: issued.orderItemId },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.paymentCancel.count({
        where: { orderItemId: issued.orderItemId },
      }),
    ).toBe(1);
    expect(pgStub.sendCalls).toHaveLength(1);
  });
});
