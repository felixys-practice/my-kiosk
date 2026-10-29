/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { randomUUID } from 'crypto';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  RefundTestContext,
  IssueTicketOptions,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';
import { signedCallback } from './helpers/pg-callback';

describe('환불 상태와 수신자별 알림 (E2E)', () => {
  let ctx: RefundTestContext;
  const pg = new RefundPgStub();
  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'notifications',
      configure: (builder) =>
        builder.overrideProvider(REFUND_PG_GATEWAY).useValue(pg),
    });
  });
  beforeEach(() => pg.reset());
  afterAll(async () => {
    await ctx.close();
  });

  async function accept(
    source: 'CUSTOMER' | 'STORE' = 'CUSTOMER',
    options: IssueTicketOptions = {},
    key?: string,
  ) {
    const issued = await ctx.issuePeriodTicket(options);
    const actor =
      source === 'CUSTOMER'
        ? (options.buyer ?? ctx.customer)
        : (options.owner ?? ctx.owner);
    const path =
      source === 'CUSTOMER'
        ? '/refund'
        : `/refund/shop/${(options.shop ?? ctx.shop).id}`;
    const call = request(ctx.server)
      .post(path)
      .set('Authorization', `Bearer ${actor.token}`);
    if (key) call.set('Idempotency-Key', key);
    const res = await call
      .send({
        ticketId: issued.ticketId,
        consentToTerminateTicket: true,
        ...(source === 'STORE' ? { amount: issued.amount } : {}),
      })
      .expect(202);
    return {
      ...issued,
      refundId: res.body.data.refundId as string,
      paymentCancelId: res.body.data.paymentCancelId as string,
      response: res.body.data,
    };
  }
  async function reject(accepted: Awaited<ReturnType<typeof accept>>) {
    await signedCallback(ctx.server, '/refund/callback', {
      success: false,
      paymentCancelId: accepted.paymentCancelId,
      orderItemId: accepted.orderItemId,
      pgTransactionId: randomUUID(),
      amount: accepted.amount,
      reason: '공개하지 않는 PG 원문',
    }).expect(200);
  }
  function list(token: string, query: object = {}) {
    return request(ctx.server)
      .get('/refund/notifications')
      .set('Authorization', `Bearer ${token}`)
      .query(query);
  }

  it('고객·매장 접수는 이용 종료와 지급 상태를 구분하고 같은 키는 최초 응답을 유지한다 (QS-9-1)', async () => {
    for (const source of ['CUSTOMER', 'STORE'] as const) {
      for (const send of [
        { result: 'ACCEPTED' },
        { result: 'NOT_SENT', reason: '전송 전 실패' },
        { result: 'REJECTED', reason: 'PG 거절' },
      ] as const) {
        pg.respondToSend(send);
        const key = randomUUID();
        const accepted = await accept(source, {}, key);
        expect(accepted.response).toMatchObject({
          decisionStatus: 'ACCEPTED',
          amount: accepted.amount,
          terminatedAt: expect.any(String),
          payoutStatus:
            send.result === 'ACCEPTED' ? 'PENDING' : 'ACTION_REQUIRED',
        });
        if (source === 'CUSTOMER' && send.result === 'NOT_SENT') {
          const reserved = await request(ctx.server)
            .post(`/refund/${accepted.refundId}/manual-payouts`)
            .set('Authorization', `Bearer ${ctx.manager.token}`)
            .set('Idempotency-Key', randomUUID())
            .send({ amount: accepted.amount, reason: '외부 지급' })
            .expect(201);
          await request(ctx.server)
            .post(
              `/refund/${accepted.refundId}/manual-payouts/${reserved.body.data.payoutId as string}/confirm`,
            )
            .set('Authorization', `Bearer ${ctx.manager.token}`)
            .set('Idempotency-Key', randomUUID())
            .send({
              amount: accepted.amount,
              paidAt: new Date(Date.now() - 1000).toISOString(),
              externalTransactionId: randomUUID(),
              evidenceReference: '지급 증빙',
            })
            .expect(200);
          const latest = await request(ctx.server)
            .get(`/refund/${accepted.refundId}`)
            .set('Authorization', `Bearer ${ctx.customer.token}`)
            .expect(200);
          expect(latest.body.data.payoutStatus).toBe('PAID');
          const sent = pg.sendCalls.length;
          const replay = await request(ctx.server)
            .post('/refund')
            .set('Authorization', `Bearer ${ctx.customer.token}`)
            .set('Idempotency-Key', key)
            .send({
              ticketId: accepted.ticketId,
              consentToTerminateTicket: true,
            })
            .expect(202);
          expect(replay.body.data).toEqual(accepted.response);
          expect(pg.sendCalls.length).toBe(sent);
        }
      }
    }
    const issued = await ctx.issuePeriodTicket();
    await ctx.prisma.ticket.update({
      where: { id: issued.ticketId },
      data: { activationDeadline: new Date(Date.now() - 1000) },
    });
    const sent = pg.sendCalls.length;
    const zero = await request(ctx.server)
      .post(`/refund/shop/${ctx.shop.id}`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({
        ticketId: issued.ticketId,
        amount: 0,
        reason: '기한 초과 후 이용 종료',
        consentToTerminateTicket: true,
      })
      .expect(200);
    expect(zero.body.data).toMatchObject({
      decisionStatus: 'ACCEPTED',
      payoutStatus: 'PAID',
      amount: 0,
      paymentCancelId: null,
      terminatedAt: expect.any(String),
    });
    expect(pg.sendCalls.length).toBe(sent);
  });

  it('점주와 고객은 이용 종료와 실제 지급액·미지급액·조치 사유를 함께 확인한다 (QS-9-2)', async () => {
    const accepted = await accept();
    await signedCallback(ctx.server, '/refund/callback', {
      success: true,
      paymentCancelId: accepted.paymentCancelId,
      orderItemId: accepted.orderItemId,
      pgTransactionId: randomUUID(),
      amount: accepted.amount - 1000,
    }).expect(200);
    for (const actor of [ctx.customer, ctx.owner]) {
      const res = await request(ctx.server)
        .get(`/refund/${accepted.refundId}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .expect(200);
      expect(res.body.data).toMatchObject({
        refundId: accepted.refundId,
        terminatedAt: accepted.response.terminatedAt,
        amount: accepted.amount,
        paidAmount: accepted.amount - 1000,
        outstandingAmount: 1000,
        payoutStatus: 'ACTION_REQUIRED',
        actionCode: 'AMOUNT_MISMATCH',
        actionReason:
          '확정 금액과 실제 환불금 지급액이 달라 확인이 필요합니다.',
      });
    }
  });

  it('고객 환불 거절은 고객·현재 점주·운영자에게 한 번씩 보인다 (QS-9-3)', async () => {
    const accepted = await accept();
    const payload = {
      success: false,
      paymentCancelId: accepted.paymentCancelId,
      orderItemId: accepted.orderItemId,
      pgTransactionId: randomUUID(),
      amount: accepted.amount,
      reason: '공개하지 않는 PG 원문',
    };
    await signedCallback(ctx.server, '/refund/callback', payload).expect(200);
    await signedCallback(ctx.server, '/refund/callback', payload).expect(200);
    for (const [actor, audience] of [
      [ctx.customer, 'CUSTOMER'],
      [ctx.owner, 'SHOP'],
      [ctx.coOwner, 'SHOP'],
      [ctx.manager, 'OPERATOR'],
    ] as const) {
      const res = await list(actor.token, { limit: 100 }).expect(200);
      const related = (res.body.data.items as { refundId: string }[]).filter(
        (item) => item.refundId === accepted.refundId,
      );
      expect(related).toEqual([
        expect.objectContaining({ audience, kind: 'PG_REJECTED' }),
      ]);
      expect(JSON.stringify(related)).not.toContain(payload.reason);
    }
  });

  it('고객은 자기 환불의 고객 수신 알림만 조회한다 (QS-9-4a)', async () => {
    const own = await accept();
    const other = await accept('CUSTOMER', { buyer: ctx.otherCustomer });
    await reject(own);
    await reject(other);
    const res = await list(ctx.customer.token).expect(200);
    expect(res.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          refundId: own.refundId,
          audience: 'CUSTOMER',
        }),
      ]),
    );
    expect(res.body.data.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ refundId: other.refundId }),
      ]),
    );
    const outsideAudience = await list(ctx.customer.token, {
      audience: 'OPERATOR',
    }).expect(200);
    expect(outsideAudience.body.data.items).toEqual([]);
    await list(ctx.customer.token, { userId: ctx.otherCustomer.id }).expect(
      400,
    );
  });

  it('읽은 알림은 본인의 미읽음에서만 빠지고 반복 읽음은 최초 시각을 보존하며 다른 수신자는 읽을 수 없다 (QS-9-4b)', async () => {
    const accepted = await accept();
    await reject(accepted);
    const initial = await list(ctx.owner.token).expect(200);
    const notification = (
      initial.body.data.items as { notificationId: string; refundId: string }[]
    ).find((item) => item.refundId === accepted.refundId);
    expect(notification).toBeDefined();
    const id = notification!.notificationId;
    const path = `/refund/notifications/${id}/read`;
    const first = await request(ctx.server)
      .patch(path)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({})
      .expect(200);
    expect(first.body.data).toMatchObject({
      notificationId: id,
      isRead: true,
      readAt: expect.any(String),
    });
    const repeated = await request(ctx.server)
      .patch(path)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .expect(200);
    expect(repeated.body.data.readAt).toBe(first.body.data.readAt);
    const unread = await list(ctx.owner.token, { unreadOnly: true }).expect(
      200,
    );
    expect(unread.body.data.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ notificationId: id })]),
    );
    const coOwner = await list(ctx.coOwner.token, { unreadOnly: true }).expect(
      200,
    );
    expect(coOwner.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          notificationId: id,
          isRead: false,
          readAt: null,
        }),
      ]),
    );
    const all = await list(ctx.owner.token).expect(200);
    expect(all.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          notificationId: id,
          isRead: true,
          readAt: first.body.data.readAt,
        }),
      ]),
    );
    for (const actor of [ctx.otherShopOwner, ctx.otherCustomer, ctx.manager]) {
      const forbidden = await request(ctx.server)
        .patch(path)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({})
        .expect(404);
      expect(forbidden.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    }
    await request(ctx.server)
      .patch(path)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({ userId: ctx.otherCustomer.id })
      .expect(400);
    const missing = await request(ctx.server)
      .patch(`/refund/notifications/${randomUUID()}/read`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({})
      .expect(404);
    expect(missing.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    await ctx.prisma.shopOwner.delete({
      where: { shopId_userId: { shopId: ctx.shop.id, userId: ctx.coOwner.id } },
    });
    try {
      const removed = await request(ctx.server)
        .patch(path)
        .set('Authorization', `Bearer ${ctx.coOwner.token}`)
        .send({})
        .expect(404);
      expect(removed.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    } finally {
      await ctx.prisma.shopOwner.create({
        data: { shopId: ctx.shop.id, userId: ctx.coOwner.id },
      });
    }
  });

  it('점주는 현재 자기 매장의 알림만 조회한다 (QS-9-4)', async () => {
    const own = await accept();
    const other = await accept('CUSTOMER', {
      shop: ctx.otherShop,
      owner: ctx.otherShopOwner,
    });
    await reject(own);
    await reject(other);
    const res = await list(ctx.owner.token).expect(200);
    expect(res.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          refundId: own.refundId,
          audience: 'SHOP',
          kind: 'PG_REJECTED',
          isRead: false,
          readAt: null,
          message: expect.any(String),
        }),
      ]),
    );
    expect(res.body.data.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ refundId: other.refundId }),
      ]),
    );
    expect(res.body.data.meta).toMatchObject({ page: 1, limit: 20 });
  });
});
