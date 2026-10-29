/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { PaymentCancelStatus, RefundPayoutStatus } from '@prisma/client';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';
import { signedCallback, signPgCallback } from './helpers/pg-callback';
import { PaymentStatus } from '@prisma/client';
import { PaymentRepository } from '../src/payment/payment.repository';
import { RefundResultService } from '../src/refund/refund-result.service';
import { TransactionLoggerService } from '../src/logger/transaction-logger.service';

/**
 * 사용자 스토리 7: PG 콜백은 PG만 보낼 수 있다 (E2E)
 * - 테스트 이름 끝의 (QS-n-m)은 specs/002-refund-completion/spec.md 사용자 스토리 n의 인수 시나리오 m
 */
describe('PG 콜백 서명 인증 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;

  /**
   * 고객 환불을 접수해 지급 처리 중(PG가 접수만 한 상태)으로 둔다
   * @returns 환불·PG 취소 요청·주문 항목·금액
   */
  async function pendingRefund() {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'ACCEPTED' });
    const res = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    const refundId = res.body.data.refundId as string;
    const attempt = await ctx.prisma.paymentCancel.findFirstOrThrow({
      where: { refundId },
    });
    return {
      refundId,
      paymentCancelId: attempt.id,
      orderItemId: issued.orderItemId,
      amount: attempt.amount,
    };
  }

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'callback-auth',
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

  it('지급 처리 중인 환불에 로그인한 사용자가 서명 없이 환불 결과 콜백을 보내면 거부되고 지급 상태는 바뀌지 않는다 (QS-7-3)', async () => {
    const pending = await pendingRefund();

    const res = await request(ctx.server)
      .post('/refund/callback')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({
        success: true,
        paymentCancelId: pending.paymentCancelId,
        pgTransactionId: `pg-cancel-${pending.paymentCancelId}`,
        orderItemId: pending.orderItemId,
        amount: pending.amount,
      });

    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { paymentCancels: true },
    });
    expect({
      status: res.status,
      code: res.body.error?.code,
      payoutStatus: refund.payoutStatus,
      attempt: refund.paymentCancels[0].status,
    }).toEqual({
      status: 401,
      code: 'PG_CALLBACK_UNAUTHORIZED',
      payoutStatus: RefundPayoutStatus.PENDING,
      attempt: PaymentCancelStatus.REQUESTED,
    });
  });

  /**
   * 지급 처리 중인 환불의 PG 취소 성공 콜백 본문을 만든다
   * @param pending 지급 처리 중인 환불
   * @returns 콜백 본문
   */
  function successBody(pending: Awaited<ReturnType<typeof pendingRefund>>) {
    return {
      success: true,
      paymentCancelId: pending.paymentCancelId,
      pgTransactionId: `pg-cancel-${pending.paymentCancelId}`,
      orderItemId: pending.orderItemId,
      amount: pending.amount,
    };
  }

  /**
   * 환불의 지급 상태와 PG 취소 요청 상태를 읽는다
   * @param refundId 환불
   * @returns 지급 상태·요청 상태·지급액·원장 수
   */
  async function payoutOf(refundId: string) {
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { paymentCancels: true, ledgers: true },
    });
    return {
      payoutStatus: refund.payoutStatus,
      attempt: refund.paymentCancels[0].status,
      paidAmount: refund.paidAmount,
      ledgers: refund.ledgers.length,
    };
  }

  it('지급 처리 중인 환불에 올바른 서명을 담은 환불 결과 콜백이 로그인 없이 오면 결과가 반영된다 (QS-7-1)', async () => {
    const pending = await pendingRefund();

    const res = await signedCallback(
      ctx.server,
      '/refund/callback',
      successBody(pending),
    );

    expect({
      status: res.status,
      payout: await payoutOf(pending.refundId),
    }).toEqual({
      status: 200,
      payout: {
        payoutStatus: RefundPayoutStatus.PAID,
        attempt: PaymentCancelStatus.SUCCEEDED,
        paidAmount: pending.amount,
        ledgers: 1,
      },
    });
  });

  it('지급 처리 중인 환불에 서명이 없거나 틀린 환불 결과 콜백이 오면 거부되고 지급 상태는 바뀌지 않는다 (QS-7-2)', async () => {
    const pending = await pendingRefund();

    const unsigned = await request(ctx.server)
      .post('/refund/callback')
      .send(successBody(pending));
    const wrong = await signedCallback(
      ctx.server,
      '/refund/callback',
      successBody(pending),
      { secret: 'another-secret-of-at-least-32-characters' },
    );

    expect({
      unsigned: [unsigned.status, unsigned.body.error?.code],
      wrong: [wrong.status, wrong.body.error?.code],
      payout: await payoutOf(pending.refundId),
    }).toEqual({
      unsigned: [401, 'PG_CALLBACK_UNAUTHORIZED'],
      wrong: [401, 'PG_CALLBACK_UNAUTHORIZED'],
      payout: {
        payoutStatus: RefundPayoutStatus.PENDING,
        attempt: PaymentCancelStatus.REQUESTED,
        paidAmount: 0,
        ledgers: 0,
      },
    });
  });

  it('결제 결과 콜백도 올바른 서명이면 로그인 없이 반영되고, 서명이 없거나 틀리거나 로그인만 한 요청은 거부되며 결제는 바뀌지 않는다 (QS-7-4)', async () => {
    const accepted = await ctx.orderPeriodAwaitingApproval();
    const rejected = await ctx.orderPeriodAwaitingApproval();
    const bodyOf = (awaiting: typeof accepted) => ({
      success: true,
      pgTransactionId: awaiting.pgTransactionId,
      amount: awaiting.amount,
      reason: null,
    });

    const unsigned = await request(ctx.server)
      .post('/payments/callback')
      .send(bodyOf(rejected));
    const wrong = await signedCallback(
      ctx.server,
      '/payments/callback',
      bodyOf(rejected),
      { secret: 'another-secret-of-at-least-32-characters' },
    );
    const jwtOnly = await request(ctx.server)
      .post('/payments/callback')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send(bodyOf(rejected));
    const signed = await signedCallback(
      ctx.server,
      '/payments/callback',
      bodyOf(accepted),
    );

    const payments = await ctx.prisma.payment.findMany({
      where: { id: { in: [accepted.paymentId, rejected.paymentId] } },
    });
    const statusOf = (id: string) => payments.find((p) => p.id === id)?.status;
    const tickets = await ctx.prisma.ticket.count({
      where: { orderItem: { orderId: accepted.orderId } },
    });
    expect({
      rejected: [unsigned, wrong, jwtOnly].map((res) => [
        res.status,
        res.body.error?.code as string,
      ]),
      signed: signed.status,
      payments: [statusOf(accepted.paymentId), statusOf(rejected.paymentId)],
      tickets,
    }).toEqual({
      rejected: [
        [401, 'PG_CALLBACK_UNAUTHORIZED'],
        [401, 'PG_CALLBACK_UNAUTHORIZED'],
        [401, 'PG_CALLBACK_UNAUTHORIZED'],
      ],
      signed: 200,
      payments: [PaymentStatus.SUCCESS, PaymentStatus.REQUESTED],
      tickets: 1,
    });
  });

  it('유효 시간이 지난 서명의 재통보는 거부되고, 같은 결과·같은 본문을 새 시각으로 다시 서명하면 반영된다', async () => {
    const pending = await pendingRefund();
    const body = successBody(pending);

    const expired = await signedCallback(ctx.server, '/refund/callback', body, {
      timestamp: Math.floor(Date.now() / 1000) - 301,
    });
    const before = await payoutOf(pending.refundId);
    const resigned = await signedCallback(ctx.server, '/refund/callback', body);

    expect({
      expired: [expired.status, expired.body.error?.code],
      before: before.payoutStatus,
      resigned: resigned.status,
      after: (await payoutOf(pending.refundId)).payoutStatus,
    }).toEqual({
      expired: [401, 'PG_CALLBACK_EXPIRED'],
      before: RefundPayoutStatus.PENDING,
      resigned: 200,
      after: RefundPayoutStatus.PAID,
    });
  });

  it('유효 시간 안에 같은 서명 콜백이 반복돼도 지급·원장은 한 번만 반영된다', async () => {
    const pending = await pendingRefund();
    const body = successBody(pending);

    const first = await signedCallback(ctx.server, '/refund/callback', body);
    const repeated = await signedCallback(ctx.server, '/refund/callback', body);

    expect({
      statuses: [first.status, repeated.status],
      payout: await payoutOf(pending.refundId),
    }).toEqual({
      statuses: [200, 200],
      payout: {
        payoutStatus: RefundPayoutStatus.PAID,
        attempt: PaymentCancelStatus.SUCCEEDED,
        paidAmount: pending.amount,
        ledgers: 1,
      },
    });
  });

  it('서명이 맞는 콜백의 저장이 실패하면 환불·결제 콜백 모두 503 REFUND_STORAGE_UNAVAILABLE로 응답해 PG가 다시 보내게 한다', async () => {
    const pending = await pendingRefund();
    const awaiting = await ctx.orderPeriodAwaitingApproval();
    const refundFailure = jest
      .spyOn(ctx.app.get(RefundResultService), 'applyPgResult')
      .mockRejectedValueOnce(new Error('DB 연결 끊김'));
    const paymentFailure = jest
      .spyOn(ctx.app.get(PaymentRepository), 'approvePayment')
      .mockRejectedValueOnce(new Error('DB 연결 끊김'));

    const refundRes = await signedCallback(
      ctx.server,
      '/refund/callback',
      successBody(pending),
    );
    const paymentRes = await signedCallback(ctx.server, '/payments/callback', {
      success: true,
      pgTransactionId: awaiting.pgTransactionId,
      amount: awaiting.amount,
      reason: null,
    });
    refundFailure.mockRestore();
    paymentFailure.mockRestore();

    const payment = await ctx.prisma.payment.findUniqueOrThrow({
      where: { id: awaiting.paymentId },
    });
    expect({
      refund: [refundRes.status, refundRes.body.error?.code],
      payment: [paymentRes.status, paymentRes.body.error?.code],
      paymentStatus: payment.status,
    }).toEqual({
      refund: [503, 'REFUND_STORAGE_UNAVAILABLE'],
      payment: [503, 'REFUND_STORAGE_UNAVAILABLE'],
      paymentStatus: PaymentStatus.REQUESTED,
    });
  });

  it('서명 비밀값과 서명 값은 거래 로그에 남지 않는다', async () => {
    const pending = await pendingRefund();
    const txLog = jest.spyOn(
      ctx.app.get(TransactionLoggerService),
      'logTransaction',
    );
    // 실패 알림 거래 로그가 생기도록 PG 거절 결과를 보낸다
    const raw = JSON.stringify({
      ...successBody(pending),
      success: false,
      reason: '카드사 거절',
    });
    const { timestamp, signature } = signPgCallback('/refund/callback', raw);

    const res = await request(ctx.server)
      .post('/refund/callback')
      .set('Content-Type', 'application/json')
      .set('X-PG-Timestamp', String(timestamp))
      .set('X-PG-Signature', signature)
      .send(raw);

    const logs = txLog.mock.calls.length;
    const logged = JSON.stringify(txLog.mock.calls);
    txLog.mockRestore();
    expect({
      status: res.status,
      logged: logs > 0,
      leaksSecret: logged.includes(process.env.PG_CALLBACK_SECRET!),
      leaksSignature: logged.includes(signature.slice(3)),
    }).toEqual({
      status: 200,
      logged: true,
      leaksSecret: false,
      leaksSignature: false,
    });
  });
});
