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

  it('고객은 자기 내역만 보며 쿼리나 사용자 경로로 다른 고객을 지정할 수 없다 (QS-8-4)', async () => {
    const refundIds: string[] = [];
    for (const buyer of [ctx.customer, ctx.otherCustomer]) {
      const issued = await ctx.issuePeriodTicket({ buyer });
      const accepted = await request(ctx.server)
        .post('/refund')
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .expect(202);
      refundIds.push(accepted.body.data.refundId as string);
    }
    const own = await request(ctx.server)
      .get('/refund/me')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .expect(200);
    const ids = own.body.data.items.map(
      (item: { refundId: string }) => item.refundId,
    ) as string[];
    expect(ids).toContain(refundIds[0]);
    expect(ids).not.toContain(refundIds[1]);
    await request(ctx.server)
      .get('/refund/me')
      .query({ userId: ctx.otherCustomer.id })
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .expect(400);
    const forbidden = await request(ctx.server)
      .get(`/refund/user/${ctx.otherCustomer.id}`)
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .expect(403);
    expect(forbidden.body.error.code).toBe('REFUND_FORBIDDEN');
  });

  it('고객은 본인 주문의 확정 금액과 지급 상태가 담긴 환불 내역을 조회한다 (QS-8-3)', async () => {
    const issued = await ctx.issuePeriodTicket();
    const accepted = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    const response = await request(ctx.server)
      .get('/refund/me')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .expect(200);
    expect(response.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          refundId: accepted.body.data.refundId,
          policyVersion: 'v0.4',
          decisionStatus: 'ACCEPTED',
          paymentId: issued.paymentId,
          targetKind: 'ORDER_ITEM',
          orderItemId: issued.orderItemId,
          ticketId: issued.ticketId,
          shopId: ctx.shop.id,
          source: 'CUSTOMER',
          amount: issued.amount,
          paidAmount: 0,
          outstandingAmount: issued.amount,
          overpaidAmount: 0,
          acceptedAt: expect.any(String),
          terminatedAt: expect.any(String),
          payoutStatus: 'PENDING',
          payoutMethod: 'PG',
          reviewRequired: false,
          paymentCancelId: accepted.body.data.paymentCancelId,
          attemptStatus: 'REQUESTED',
          actionCode: null,
          actionReason: null,
          paidAt: null,
        }),
      ]),
    );
    expect(response.body.data.meta).toMatchObject({ page: 1, limit: 20 });
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
