/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';

describe('환불 내역 조회 (E2E)', () => {
  let ctx: RefundTestContext;
  const pgStub = new RefundPgStub();

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'history',
      configure: (builder) =>
        builder.overrideProvider(REFUND_PG_GATEWAY).useValue(pgStub),
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('현재 점주는 자기 매장의 환불 내역을 환불 식별자로 조회한다 (QS-8-1)', async () => {
    const issued = await ctx.issuePeriodTicket();
    const accepted = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);

    const response = await request(ctx.server)
      .get(`/refund/shop/${ctx.shop.id}`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .expect(200);

    expect(response.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          refundId: accepted.body.data.refundId,
          amount: issued.amount,
          shopId: ctx.shop.id,
        }),
      ]),
    );
  });
});
