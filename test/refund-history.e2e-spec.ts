/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { randomUUID } from 'crypto';
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

  it('U388 큰 페이지·계산 위치는 입력 오류로 거절하고 표현 가능한 경계는 허용한다 (QS-8-3)', async () => {
    for (const query of [
      { page: '1e308' },
      { page: String(Number.MAX_SAFE_INTEGER), limit: '100' },
    ]) {
      const response = await request(ctx.server)
        .get('/refund/me')
        .query(query)
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .expect(400);
      expect(response.body.error.code).toBe('BadRequestException');
    }
    const boundary = await request(ctx.server)
      .get('/refund/me')
      .query({ page: String(Number.MAX_SAFE_INTEGER), limit: '1' })
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .expect(200);
    expect(boundary.body.data.items).toEqual([]);
  });

  it('U386 역할 부족과 없는 조회 대상을 구분하고 권한 안 빈 목록은 허용한다 (QS-8-5)', async () => {
    for (const [path, actor, status, code] of [
      [`/refund/shop/${ctx.shop.id}`, ctx.customer, 403, 'REFUND_FORBIDDEN'],
      [`/refund/user/${ctx.customer.id}`, ctx.owner, 403, 'REFUND_FORBIDDEN'],
      [`/refund/shop/${randomUUID()}`, ctx.manager, 404, 'SHOP_NOT_FOUND'],
      [`/refund/user/${randomUUID()}`, ctx.manager, 404, 'USER_NOT_FOUND'],
    ] as const) {
      const response = await request(ctx.server)
        .get(path)
        .set('Authorization', `Bearer ${actor.token}`)
        .expect(status);
      expect(response.body.error.code).toBe(code);
    }
    const empty = await request(ctx.server)
      .get(`/refund/user/${ctx.owner.id}`)
      .set('Authorization', `Bearer ${ctx.manager.token}`)
      .expect(200);
    expect(empty.body.data.items).toEqual([]);
    expect(empty.body.data.meta.total).toBe(0);
  });

  it('U385 실제 PG 오류와 외부 지급 증빙은 운영자의 HTTP 응답에만 담긴다 (QS-8-3)', async () => {
    const privateValue = '비공개 PG 오류와 지급 증빙';
    let refundId: string;
    try {
      pgStub.respondToSend({ result: 'NOT_SENT', reason: privateValue });
      const issued = await ctx.issuePeriodTicket();
      const accepted = await request(ctx.server)
        .post('/refund')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .expect(202);
      refundId = accepted.body.data.refundId as string;
      const reserved = await request(ctx.server)
        .post(`/refund/${refundId}/manual-payouts`)
        .set('Authorization', `Bearer ${ctx.manager.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: issued.amount, reason: privateValue })
        .expect(201);
      await request(ctx.server)
        .post(
          `/refund/${refundId}/manual-payouts/${reserved.body.data.payoutId as string}/confirm`,
        )
        .set('Authorization', `Bearer ${ctx.manager.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          amount: issued.amount,
          paidAt: new Date(Date.now() - 1000).toISOString(),
          externalTransactionId: randomUUID(),
          evidenceReference: privateValue,
        })
        .expect(200);
    } finally {
      pgStub.reset();
    }
    for (const actor of [ctx.customer, ctx.owner, ctx.coOwner]) {
      const detail = await request(ctx.server)
        .get(`/refund/${refundId}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .expect(200);
      const listPath =
        actor === ctx.customer ? '/refund/me' : `/refund/shop/${ctx.shop.id}`;
      const list = await request(ctx.server)
        .get(listPath)
        .set('Authorization', `Bearer ${actor.token}`)
        .expect(200);
      expect(
        JSON.stringify({ detail: detail.body.data, list: list.body.data }),
      ).not.toContain(privateValue);
      expect(detail.body.data.manualPayouts).toEqual([
        expect.objectContaining({ status: 'SUCCEEDED', amount: 10000 }),
      ]);
    }
    const manager = await request(ctx.server)
      .get(`/refund/${refundId}`)
      .set('Authorization', `Bearer ${ctx.manager.token}`)
      .expect(200);
    expect(manager.body.data.attempts).toEqual([
      expect.objectContaining({ failureReason: privateValue }),
    ]);
    expect(manager.body.data.manualPayouts).toEqual([
      expect.objectContaining({ evidenceReference: privateValue }),
    ]);
  });

  it('U384 운영자 목록은 실패·예약을 유지하고 상태 필터 뒤 안정된 순서로 페이지를 제공한다 (QS-8-5)', async () => {
    const ids: string[] = [];
    try {
      for (let index = 0; index < 4; index++) {
        if (index < 3) {
          pgStub.respondToSend({
            result: 'NOT_SENT',
            reason: '목록 검증용 전송 전 실패',
          });
        }
        const issued = await ctx.issuePeriodTicket({
          shop: ctx.otherShop,
          owner: ctx.otherShopOwner,
          buyer: ctx.otherCustomer,
        });
        const accepted = await request(ctx.server)
          .post('/refund')
          .set('Authorization', `Bearer ${ctx.otherCustomer.token}`)
          .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
          .expect(202);
        const id = accepted.body.data.refundId as string;
        ids.push(id);
        await ctx.prisma.refund.update({
          where: { id },
          data: {
            requestedAt: new Date(
              `${index === 2 ? 2031 : index === 3 ? 2029 : 2030}-01-01T00:00:00.000Z`,
            ),
          },
        });
      }
      await request(ctx.server)
        .post(`/refund/${ids[0]}/manual-payouts`)
        .set('Authorization', `Bearer ${ctx.manager.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 10000, reason: '조회 검증용 지급 예약' })
        .expect(201);
      const ordered = [ids[2], ...ids.slice(0, 2).sort().reverse()];
      const path = `/refund/shop/${ctx.otherShop.id}`;
      for (let page = 1; page <= 3; page++) {
        const response = await request(ctx.server)
          .get(path)
          .set('Authorization', `Bearer ${ctx.manager.token}`)
          .query({
            page,
            limit: 1,
            actionRequiredOnly: 'true',
            payoutStatus: 'ACTION_REQUIRED',
            decisionStatus: 'ACCEPTED',
          })
          .expect(200);
        expect(response.body.data.items).toEqual([
          expect.objectContaining({
            refundId: ordered[page - 1],
            attemptStatus: 'FAILED',
          }),
        ]);
        expect(response.body.data.meta).toMatchObject({
          page,
          limit: 1,
          total: 3,
          totalPages: 3,
        });
      }
      const all = await request(ctx.server)
        .get(path)
        .set('Authorization', `Bearer ${ctx.manager.token}`)
        .query({ actionRequiredOnly: 'false' })
        .expect(200);
      expect(all.body.data.items).toHaveLength(4);
      expect(all.body.data.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            refundId: ids[3],
            payoutStatus: 'PENDING',
          }),
        ]),
      );
      for (const query of [
        { payoutStatus: 'PAID' },
        { decisionStatus: 'LEGACY_REJECTED' },
      ]) {
        const empty = await request(ctx.server)
          .get(path)
          .set('Authorization', `Bearer ${ctx.manager.token}`)
          .query(query)
          .expect(200);
        expect(empty.body.data.items).toEqual([]);
      }
      for (const [url, actor] of [
        [path, ctx.otherShopOwner],
        ['/refund/me', ctx.otherCustomer],
      ] as const) {
        const forbidden = await request(ctx.server)
          .get(url)
          .set('Authorization', `Bearer ${actor.token}`)
          .query({ actionRequiredOnly: 'false' })
          .expect(403);
        expect(forbidden.body.error.code).toBe('REFUND_FORBIDDEN');
      }
      await request(ctx.server)
        .get(path)
        .set('Authorization', `Bearer ${ctx.manager.token}`)
        .query({ page: 0 })
        .expect(400);
    } finally {
      pgStub.reset();
    }
  });

  it('U382 환불 상세는 본인·현재 공동 점주·운영자에게만 지급 이력을 제공한다 (QS-8-3)', async () => {
    const issued = await ctx.issuePeriodTicket();
    const accepted = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    const path = `/refund/${accepted.body.data.refundId as string}`;
    for (const actor of [ctx.customer, ctx.owner, ctx.coOwner, ctx.manager]) {
      const response = await request(ctx.server)
        .get(path)
        .set('Authorization', `Bearer ${actor.token}`)
        .expect(200);
      expect(response.body.data).toMatchObject({
        refundId: accepted.body.data.refundId,
        attempts: [
          expect.objectContaining({
            paymentCancelId: accepted.body.data.paymentCancelId,
            amount: issued.amount,
            actualAmount: null,
            status: 'REQUESTED',
          }),
        ],
        manualPayouts: [],
      });
    }
    for (const actor of [ctx.otherCustomer, ctx.otherShopOwner]) {
      const response = await request(ctx.server)
        .get(path)
        .set('Authorization', `Bearer ${actor.token}`)
        .expect(404);
      expect(response.body.error.code).toBe('REFUND_NOT_FOUND');
    }
    await ctx.prisma.shopOwner.delete({
      where: { shopId_userId: { shopId: ctx.shop.id, userId: ctx.coOwner.id } },
    });
    try {
      const response = await request(ctx.server)
        .get(path)
        .set('Authorization', `Bearer ${ctx.coOwner.token}`)
        .expect(404);
      expect(response.body.error.code).toBe('REFUND_NOT_FOUND');
    } finally {
      await ctx.prisma.shopOwner.create({
        data: { shopId: ctx.shop.id, userId: ctx.coOwner.id },
      });
    }
    const missing = await request(ctx.server)
      .get(`/refund/${randomUUID()}`)
      .set('Authorization', `Bearer ${ctx.manager.token}`)
      .expect(404);
    expect(missing.body.error.code).toBe('REFUND_NOT_FOUND');
  });

  it('운영자는 소유 관계 없이 어느 매장과 사용자의 환불 내역이든 조회한다 (QS-8-5)', async () => {
    for (const options of [
      { shop: ctx.shop, owner: ctx.owner, buyer: ctx.customer },
      {
        shop: ctx.otherShop,
        owner: ctx.otherShopOwner,
        buyer: ctx.otherCustomer,
      },
    ]) {
      const issued = await ctx.issuePeriodTicket(options);
      const accepted = await request(ctx.server)
        .post('/refund')
        .set('Authorization', `Bearer ${options.buyer.token}`)
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .expect(202);
      for (const path of [
        `/refund/shop/${options.shop.id}`,
        `/refund/user/${options.buyer.id}`,
      ]) {
        const response = await request(ctx.server)
          .get(path)
          .set('Authorization', `Bearer ${ctx.manager.token}`)
          .expect(200);
        expect(response.body.data.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ refundId: accepted.body.data.refundId }),
          ]),
        );
      }
    }
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
    const ids = (own.body.data.items as { refundId: string }[]).map(
      (item: { refundId: string }) => item.refundId,
    );
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
