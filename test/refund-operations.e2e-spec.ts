/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  ManualRefundPayoutStatus,
  PaymentCancelFailureCode,
  PaymentCancelStatus,
  RefundPayoutStatus,
  TicketStatus,
} from '@prisma/client';
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
    return (await createFailedRefundOfTicket()).refundId;
  }

  /**
   * createFailedRefund와 같지만 이용권 ID도 돌려준다
   * @returns 환불·이용권 ID
   */
  async function createFailedRefundOfTicket(): Promise<{
    refundId: string;
    ticketId: string;
  }> {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'NOT_SENT', reason: 'PG 연결 설정 누락' });
    const res = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    return {
      refundId: res.body.data.refundId as string,
      ticketId: issued.ticketId,
    };
  }

  /**
   * 운영자가 PG 직접 재시도를 요청한다
   * @param refundId 환불
   * @param key 멱등 키
   * @param reason 사유
   * @param token 요청자 토큰(기본 운영자)
   * @returns 응답
   */
  function retry(
    refundId: string,
    key: string,
    reason = retryReason,
    token = ctx.manager.token,
  ) {
    return request(ctx.server)
      .post(`/refund/${refundId}/payout-retries`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ reason });
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

  it('PG 취소 요청의 실패가 확정됐고 실제 지급액이 0원일 때 운영자가 재시도를 요청하면 확정된 환불 금액의 취소 요청을 새 PG 취소 요청 식별자로 기록해 PG에 보내고 실행자·사유를 남기며 이용권은 복구하지 않는다 (QS-10-1)', async () => {
    const failed = await createFailedRefundOfTicket();
    pgStub.reset();
    pgStub.respondToSend({ result: 'ACCEPTED' });

    const res = await retry(failed.refundId, `retry-${randomUUID()}`).expect(
      202,
    );

    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: failed.refundId },
      include: { paymentCancels: { orderBy: { attemptNumber: 'asc' } } },
    });
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: failed.ticketId },
    });
    const [previous, created] = refund.paymentCancels;
    expect({
      body: res.body.data,
      previous: {
        status: previous.status,
        failureCode: previous.failureCode,
      },
      created: {
        amount: created?.amount,
        requestedById: created?.requestedById,
        retryReason: created?.retryReason,
      },
      sent: pgStub.sendCalls.map((call) => call.paymentCancelId),
      payoutStatus: refund.payoutStatus,
      ticket: ticket.status,
    }).toEqual({
      body: {
        refundId: failed.refundId,
        paymentCancelId: created?.id,
        payoutStatus: RefundPayoutStatus.PENDING,
      },
      previous: {
        status: PaymentCancelStatus.FAILED,
        failureCode: PaymentCancelFailureCode.SEND_FAILED,
      },
      created: {
        amount: refund.amount,
        requestedById: ctx.manager.id,
        retryReason,
      },
      sent: [created?.id],
      payoutStatus: RefundPayoutStatus.PENDING,
      ticket: TicketStatus.REVOKED,
    });
  });

  it('같은 키·같은 내용의 반복은 최초 응답(같은 PG 취소 요청 식별자)을, 내용이 바뀌면 IDEMPOTENCY_KEY_REUSED를, 다른 키의 동시 요청은 REFUND_PAYOUT_UNRESOLVED를 받고 취소 요청 기록과 PG 호출은 추가되지 않는다 (QS-10-1c)', async () => {
    const refundId = await createFailedRefund();
    pgStub.reset();
    pgStub.respondToSend({ result: 'ACCEPTED' });
    const k1 = `retry-${randomUUID()}`;
    const first = await retry(refundId, k1).expect(202);

    const repeated = await retry(refundId, k1);
    const changed = await retry(refundId, k1, '다른 사유');
    const [k2, k3] = await Promise.all([
      retry(refundId, `retry-${randomUUID()}`),
      retry(refundId, `retry-${randomUUID()}`),
    ]);

    const attempts = await ctx.prisma.paymentCancel.count({
      where: { refundId },
    });
    expect({
      repeated: { status: repeated.status, body: repeated.body.data },
      changed: changed.body.error?.code,
      others: [k2, k3].map((res) => [
        res.status,
        res.body.error?.code as string,
      ]),
      attempts,
      sends: pgStub.sendCalls.length,
    }).toEqual({
      repeated: { status: 202, body: first.body.data },
      changed: 'IDEMPOTENCY_KEY_REUSED',
      others: [
        [409, 'REFUND_PAYOUT_UNRESOLVED'],
        [409, 'REFUND_PAYOUT_UNRESOLVED'],
      ],
      attempts: 2,
      sends: 1,
    });
  });

  it('고객은 403 REFUND_FORBIDDEN, 운영자의 같은 키 반복은 지급 완료 뒤에도 최초 응답, 새 요청은 지급 완료 REFUND_PAYOUT_NOT_ACTIONABLE·활성 별도 지급 예약 REFUND_PAYOUT_UNRESOLVED·일부 지급 REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL로 거절되고 기록·PG 호출이 추가되지 않는다 (QS-10-1d)', async () => {
    // 고객 요청
    const forCustomer = await createFailedRefund();
    // 같은 키 반복: 최초 재시도 뒤 지급 완료로 바뀐 환불
    const paidLater = await createFailedRefund();
    // 활성 별도 지급 예약이 있는 환불
    const reserved = await createFailedRefund();
    // 일부만 지급된 환불
    const partial = await createFailedRefund();
    pgStub.reset();
    pgStub.respondToSend({ result: 'ACCEPTED' });
    const key = `retry-${randomUUID()}`;
    const first = await retry(paidLater, key).expect(202);
    await ctx.prisma.refund.update({
      where: { id: paidLater },
      data: { payoutStatus: RefundPayoutStatus.PAID },
    });
    await ctx.prisma.paymentCancel.updateMany({
      where: { refundId: paidLater, status: PaymentCancelStatus.REQUESTED },
      data: {
        status: PaymentCancelStatus.SUCCEEDED,
        claimToken: null,
        claimUntil: null,
      },
    });
    const reservedRefund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: reserved },
    });
    await ctx.prisma.manualRefundPayout.create({
      data: {
        refundId: reserved,
        status: ManualRefundPayoutStatus.RESERVED,
        amount: reservedRefund.amount,
        reservedById: ctx.manager.id,
        reservedAt: new Date(),
        reason: '계좌 이체로 지급 예정',
      },
    });
    await ctx.prisma.refund.update({
      where: { id: partial },
      data: { paidAmount: 1000 },
    });
    const before = await ctx.prisma.paymentCancel.count({
      where: { refundId: { in: [forCustomer, paidLater, reserved, partial] } },
    });
    const sendsBefore = pgStub.sendCalls.length;

    const customer = await retry(
      forCustomer,
      `retry-${randomUUID()}`,
      retryReason,
      ctx.customer.token,
    );
    const repeated = await retry(paidLater, key);
    const paidNew = await retry(paidLater, `retry-${randomUUID()}`);
    const reservedNew = await retry(reserved, `retry-${randomUUID()}`);
    const partialNew = await retry(partial, `retry-${randomUUID()}`);

    const after = await ctx.prisma.paymentCancel.count({
      where: { refundId: { in: [forCustomer, paidLater, reserved, partial] } },
    });
    expect({
      customer: [customer.status, customer.body.error?.code],
      repeated: { status: repeated.status, body: repeated.body.data },
      paidNew: [paidNew.status, paidNew.body.error?.code],
      reservedNew: [reservedNew.status, reservedNew.body.error?.code],
      partialNew: [partialNew.status, partialNew.body.error?.code],
      addedAttempts: after - before,
      addedSends: pgStub.sendCalls.length - sendsBefore,
    }).toEqual({
      customer: [403, 'REFUND_FORBIDDEN'],
      repeated: { status: 202, body: first.body.data },
      paidNew: [409, 'REFUND_PAYOUT_NOT_ACTIONABLE'],
      reservedNew: [409, 'REFUND_PAYOUT_UNRESOLVED'],
      partialNew: [409, 'REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL'],
      addedAttempts: 0,
      addedSends: 0,
    });
  });
});
