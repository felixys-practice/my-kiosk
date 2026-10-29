/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  ManualRefundPayoutStatus,
  RefundNotificationAudience,
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
import { RefundRecoveryService } from '../src/refund/refund-recovery.service';

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

  /**
   * 점주·운영자가 환불의 PG 결과를 개별 확인한다
   * @param refundId 환불
   * @param token 요청자 토큰(기본 점주)
   * @returns 응답
   */
  function pgCheck(refundId: string, token = ctx.owner.token) {
    return request(ctx.server)
      .post(`/refund/${refundId}/pg-check`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  /**
   * 정해진 사유로 최초 PG 취소 요청이 실패한 고객 환불을 만든다
   * - 전송 전 실패·PG 거절은 실제 전송 결과로, 한도 소진은 전송 전 실패 뒤 사유만 바꿔 만든다
   * @param failureCode 실패 사유
   * @returns 환불·이용권 ID
   */
  async function createRefundFailedWith(
    failureCode: PaymentCancelFailureCode,
  ): Promise<{ refundId: string; ticketId: string }> {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend(
      failureCode === PaymentCancelFailureCode.PG_REJECTED
        ? { result: 'REJECTED', reason: '카드사 거절' }
        : { result: 'NOT_SENT', reason: 'PG 연결 설정 누락' },
    );
    const res = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    const refundId = res.body.data.refundId as string;
    if (failureCode === PaymentCancelFailureCode.RETRY_EXHAUSTED) {
      await ctx.prisma.paymentCancel.updateMany({
        where: { refundId },
        data: { failureCode, resendCount: 3 },
      });
      await ctx.prisma.refund.update({
        where: { id: refundId },
        data: { actionCode: failureCode },
      });
    }
    return { refundId, ticketId: issued.ticketId };
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

  it('최근 PG 취소 요청이 한도 소진·전송 전 실패·PG 거절로 이미 실패한 자기 매장 환불을 점주가 개별 확인해 미접수 또는 거절 확정이면 별도 버튼·사유 없이 새 PG 취소 요청 식별자로 즉시 보내고 이전 실패·이용 종료를 유지하며, 조회 오류면 보내지 않고 처리 중이면 운영자에게 알리고 추가 지급을 막는다 (QS-10-1a)', async () => {
    const reasons = [
      PaymentCancelFailureCode.RETRY_EXHAUSTED,
      PaymentCancelFailureCode.SEND_FAILED,
      PaymentCancelFailureCode.PG_REJECTED,
    ];
    const retried: { refundId: string; ticketId: string }[] = [];
    for (const reason of reasons) {
      retried.push(await createRefundFailedWith(reason));
    }
    const queryError = await createRefundFailedWith(
      PaymentCancelFailureCode.SEND_FAILED,
    );
    const inProgress = await createRefundFailedWith(
      PaymentCancelFailureCode.SEND_FAILED,
    );
    pgStub.reset();

    const checks: unknown[] = [];
    for (const [index, target] of retried.entries()) {
      pgStub
        .respondToInquiry(
          reasons[index] === PaymentCancelFailureCode.PG_REJECTED
            ? { result: 'FAILED', reason: '카드사 거절' }
            : { result: 'NOT_FOUND', authoritative: true },
        )
        .respondToSend({ result: 'ACCEPTED' });
      const res = await pgCheck(target.refundId).expect(200);
      checks.push([res.body.data.checkStatus, res.body.data.resendResult]);
    }
    pgStub.respondToInquiry({ result: 'QUERY_ERROR', reason: '조회 지연' });
    const queryErrorRes = await pgCheck(queryError.refundId).expect(200);
    pgStub.respondToInquiry({ result: 'IN_PROGRESS' });
    await pgCheck(inProgress.refundId).expect(200);

    const refunds = await ctx.prisma.refund.findMany({
      where: {
        id: {
          in: [...retried, queryError, inProgress].map((t) => t.refundId),
        },
      },
      include: {
        paymentCancels: { orderBy: { attemptNumber: 'asc' } },
        notifications: true,
        orderItem: { include: { ticket: true } },
      },
    });
    const byId = (refundId: string) =>
      refunds.find((refund) => refund.id === refundId)!;
    expect({
      checks,
      retried: retried.map((target, index) => {
        const refund = byId(target.refundId);
        const [previous, created] = refund.paymentCancels;
        return {
          previous: [previous.status, previous.failureCode],
          created: [created?.status, created?.requestedById],
          sentNew: pgStub.sendCalls.some(
            (call) => call.paymentCancelId === created?.id,
          ),
          payoutStatus: refund.payoutStatus,
          ticket: refund.orderItem?.ticket?.status,
          reason: reasons[index],
        };
      }),
      queryError: {
        inquiryResult: queryErrorRes.body.data.inquiryResult,
        attempts: byId(queryError.refundId).paymentCancels.length,
        payoutStatus: byId(queryError.refundId).payoutStatus,
      },
      inProgress: {
        attempts: byId(inProgress.refundId).paymentCancels.length,
        actionCode: byId(inProgress.refundId).actionCode,
        operatorNotified: byId(inProgress.refundId).notifications.some(
          (n) =>
            n.audience === RefundNotificationAudience.OPERATOR &&
            n.kind === 'PG_RESULT_CONFLICT',
        ),
      },
      sends: pgStub.sendCalls.length,
    }).toEqual({
      checks: reasons.map(() => ['CHECKED', 'ACCEPTED']),
      retried: reasons.map((reason) => ({
        previous: [PaymentCancelStatus.FAILED, reason],
        created: [PaymentCancelStatus.REQUESTED, ctx.owner.id],
        sentNew: true,
        payoutStatus: RefundPayoutStatus.PENDING,
        ticket: TicketStatus.REVOKED,
        reason,
      })),
      queryError: {
        inquiryResult: 'QUERY_ERROR',
        attempts: 1,
        payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      },
      inProgress: {
        attempts: 1,
        actionCode: 'PG_RESULT_CONFLICT',
        operatorNotified: true,
      },
      sends: 3,
    });
  });

  it('개별 확인으로 새 PG 취소 요청 식별자로 보낸 요청의 응답이 없고 자동 조회에서 미접수가 확인되면 정해진 횟수까지만 다시 보내고, 소진 뒤 미접수면 자동 처리를 멈추며 이전 실패 요청은 바꾸지 않고 점주는 개별 확인을 다시 실행할 수 있다 (QS-10-1b)', async () => {
    const failed = await createRefundFailedWith(
      PaymentCancelFailureCode.SEND_FAILED,
    );
    pgStub.reset();
    pgStub
      .respondToInquiry({ result: 'NOT_FOUND', authoritative: true })
      .respondToSend({ result: 'UNKNOWN', reason: '응답 시간 초과' });
    await pgCheck(failed.refundId).expect(200);
    const created = await ctx.prisma.paymentCancel.findFirstOrThrow({
      where: { refundId: failed.refundId, attemptNumber: 2 },
    });
    // 자동 조회: 한도(3회)까지 미접수 → 재전송, 그 뒤 미접수 → 실패 확정
    const recovery = ctx.app.get(RefundRecoveryService);
    const resendLimit = 3;
    let at = Date.now() - 86_400_000;
    for (let round = 0; round <= resendLimit; round++) {
      pgStub.respondToInquiry({ result: 'NOT_FOUND', authoritative: true });
      if (round < resendLimit) {
        pgStub.respondToSend({ result: 'UNKNOWN', reason: '응답 시간 초과' });
      }
      at += 600_000;
      await recovery.inquireAttempt(created.id, new Date(at));
    }
    const autoAttempts = await ctx.prisma.paymentCancel.findMany({
      where: { refundId: failed.refundId },
      orderBy: { attemptNumber: 'asc' },
    });
    pgStub
      .respondToInquiry({ result: 'NOT_FOUND', authoritative: true })
      .respondToSend({ result: 'ACCEPTED' });

    const again = await pgCheck(failed.refundId).expect(200);

    const finalAttempts = await ctx.prisma.paymentCancel.count({
      where: { refundId: failed.refundId },
    });
    expect({
      previous: [
        autoAttempts[0].status,
        autoAttempts[0].failureCode,
        autoAttempts[0].resendCount,
      ],
      created: [
        autoAttempts[1].status,
        autoAttempts[1].failureCode,
        autoAttempts[1].resendCount,
      ],
      autoAttempts: autoAttempts.length,
      again: [again.body.data.checkStatus, again.body.data.resendResult],
      finalAttempts,
    }).toEqual({
      previous: [
        PaymentCancelStatus.FAILED,
        PaymentCancelFailureCode.SEND_FAILED,
        0,
      ],
      created: [
        PaymentCancelStatus.FAILED,
        PaymentCancelFailureCode.RETRY_EXHAUSTED,
        resendLimit,
      ],
      autoAttempts: 2,
      again: ['CHECKED', 'ACCEPTED'],
      finalAttempts: 3,
    });
  });

  it('고객·점주의 별도 지급 예약·결과 등록·미지급 확인·초과 취소 검토 요청은 403 REFUND_FORBIDDEN으로 거절되고 기록이 바뀌지 않는다', async () => {
    const refundId = await createFailedRefund();
    const payoutId = '00000000-0000-4000-8000-000000000000';
    const requests = [
      {
        path: `/refund/${refundId}/manual-payouts`,
        body: { amount: 1, reason: '예약' },
      },
      {
        path: `/refund/${refundId}/manual-payouts/${payoutId}/confirm`,
        body: {
          amount: 1,
          paidAt: new Date(Date.now() - 60_000).toISOString(),
          externalTransactionId: 'bank-1',
          evidenceReference: '증빙',
        },
      },
      {
        path: `/refund/${refundId}/manual-payouts/${payoutId}/not-paid`,
        body: { reason: '미지급', evidenceReference: '근거' },
      },
      {
        path: `/refund/${refundId}/amount-review`,
        body: { reason: '검토', evidenceReference: '근거' },
      },
    ];

    const results: unknown[] = [];
    for (const token of [ctx.customer.token, ctx.owner.token]) {
      for (const { path, body } of requests) {
        const res = await request(ctx.server)
          .post(path)
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', `ops-${randomUUID()}`)
          .send(body);
        results.push([res.status, res.body.error?.code]);
      }
    }

    const payouts = await ctx.prisma.manualRefundPayout.count({
      where: { refundId },
    });
    expect({ results, payouts }).toEqual({
      results: Array.from({ length: 8 }, () => [403, 'REFUND_FORBIDDEN']),
      payouts: 0,
    });
  });
});
