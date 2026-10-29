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

  it('점주는 다른 매장이나 소유 관계가 해제된 매장 내역을 조회할 수 없다 (QS-8-2)', async () => {
    const foreign = await request(ctx.server)
      .get(`/refund/shop/${ctx.otherShop.id}`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .expect(404);
    expect(foreign.body.error.code).toBe('SHOP_NOT_FOUND');

    await ctx.prisma.shopOwner.delete({
      where: { shopId_userId: { shopId: ctx.shop.id, userId: ctx.coOwner.id } },
    });
    try {
      const revoked = await request(ctx.server)
        .get(`/refund/shop/${ctx.shop.id}`)
        .set('Authorization', `Bearer ${ctx.coOwner.token}`)
        .expect(404);
      expect(revoked.body.error.code).toBe('SHOP_NOT_FOUND');
    } finally {
      await ctx.prisma.shopOwner.create({
        data: { shopId: ctx.shop.id, userId: ctx.coOwner.id },
      });
    }
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
