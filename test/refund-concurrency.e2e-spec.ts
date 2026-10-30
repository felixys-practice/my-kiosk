/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { randomUUID } from 'crypto';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';
import { RefundAcceptanceService } from '../src/refund/refund-acceptance.service';

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
    const acceptance = ctx.app.get<RefundAcceptanceService>(
      RefundAcceptanceService,
    );
    const original: RefundAcceptanceService['findLockedTarget'] =
      acceptance.findLockedTarget.bind(acceptance);
    let releaseCustomer!: () => void;
    const holdCustomer = new Promise<void>((resolve) => {
      releaseCustomer = resolve;
    });
    let customerLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      customerLocked = resolve;
    });
    let storeEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      storeEntered = resolve;
    });
    let calls = 0;
    const spy = jest
      .spyOn(acceptance, 'findLockedTarget')
      .mockImplementation(async (...args) => {
        calls += 1;
        if (calls === 2) storeEntered();
        const target = await original(...args);
        if (calls === 1) {
          customerLocked();
          await holdCustomer;
        }
        return target;
      });

    try {
      const customerPromise = request(ctx.server)
        .post('/refund')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .then((response) => response);
      await locked;
      const storePromise = request(ctx.server)
        .post(`/refund/shop/${ctx.shop.id}`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          ticketId: issued.ticketId,
          amount: issued.amount,
          reason: '고객 요청',
          consentToTerminateTicket: true,
        })
        .then((response) => response);
      await entered;
      let storeFinished = false;
      void storePromise.then(() => {
        storeFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(storeFinished).toBe(false);
      releaseCustomer();
      const [customer, store] = await Promise.all([
        customerPromise,
        storePromise,
      ]);
      expect(customer.status).toBe(202);
      expect(store.status).toBe(409);
      expect(store.body.error.code).toBe('REFUND_IN_PROGRESS');
    } finally {
      releaseCustomer();
      spy.mockRestore();
    }
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
