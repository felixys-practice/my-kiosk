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
    const res = await request(ctx.server)
      .post(path)
      .set('Authorization', `Bearer ${actor.token}`)
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
