/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import {
  ManualRefundPayoutStatus,
  PaymentCancelFailureCode,
  PaymentCancelStatus,
  RefundDecisionStatus,
  RefundNotificationAudience,
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
 * 사용자 스토리 5: PG 결과 조회·재전송·장애 복구 (E2E)
 * - 테스트 이름 끝의 (QS-n-m)은 specs/002-refund-completion/spec.md 사용자 스토리 n의 인수 시나리오 m
 */
describe('PG 결과 조회·재전송·장애 복구 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'recovery',
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

  it('PG 취소 요청이 보내기 전에 실패하면 실패·지급 조치 필요를 기록해 운영자에게 알리고 이용 종료는 유지하며 응답에서 이용 종료와 미지급을 구분한다 (QS-5-1)', async () => {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'NOT_SENT', reason: 'PG 연결 설정 누락' });

    const res = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);

    expect(res.body.data).toMatchObject({
      decisionStatus: RefundDecisionStatus.ACCEPTED,
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
    });
    expect(res.body.data.terminatedAt).toEqual(expect.any(String));
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: res.body.data.refundId as string },
      include: { paymentCancels: true, notifications: true },
    });
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect({
      attempt: refund.paymentCancels[0].status,
      failureCode: refund.paymentCancels[0].failureCode,
      payoutStatus: refund.payoutStatus,
      operatorNotified: refund.notifications.some(
        (n) => n.audience === RefundNotificationAudience.OPERATOR,
      ),
      ticket: ticket.status,
    }).toEqual({
      attempt: PaymentCancelStatus.FAILED,
      failureCode: PaymentCancelFailureCode.SEND_FAILED,
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      operatorNotified: true,
      ticket: TicketStatus.REVOKED,
    });
  });

  /**
   * 고객 환불을 확정하고 그 PG 취소 요청을 결과 확인 실패(QUERY_FAILED) 상태로 만든다
   * @returns 환불·PG 취소 요청 ID
   */
  async function queryFailedRefund(): Promise<{
    refundId: string;
    paymentCancelId: string;
  }> {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'UNKNOWN', reason: '응답 시간 초과' });
    const { body } = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    const paymentCancelId = body.data.paymentCancelId as string;
    await ctx.prisma.paymentCancel.update({
      where: { id: paymentCancelId },
      data: {
        status: PaymentCancelStatus.QUERY_FAILED,
        inquiryFailureCount: 5,
        queryFailedAt: new Date(Date.now() - 60_000),
        nextInquiryAt: null,
      },
    });
    return { refundId: body.data.refundId as string, paymentCancelId };
  }

  it('결과 확인 실패 건이 쌓였을 때 운영자가 전체 재확인을 실행하면 예정 시각을 기다리지 않고 결과 확인 실패 건을 처리 단위로 조회하며 지급 완료를 뜻하지 않는다 (QS-5-10a)', async () => {
    await ctx.prisma.refundRecoveryControl.deleteMany({});
    const failed = await queryFailedRefund();
    pgStub.respondByDefault({ inquiry: { result: 'IN_PROGRESS' } });

    const res = await request(ctx.server)
      .post('/refund/recovery/resume')
      .set('Authorization', `Bearer ${ctx.manager.token}`)
      .send({})
      .expect(202);
    // 테스트 환경은 자동 작업자를 끄므로 예약된 실행을 직접 한 번 돌린다
    await ctx.app.get(RefundRecoveryService).recoverQueryFailed(new Date());

    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: failed.refundId },
    });
    expect({
      status: res.body.data.status,
      inquired: pgStub.inquiryCalls.some(
        (call) => call.paymentCancelId === failed.paymentCancelId,
      ),
      payoutStatus: refund.payoutStatus,
    }).toEqual({
      status: 'SCHEDULED',
      inquired: true,
      payoutStatus: RefundPayoutStatus.PENDING,
    });
  });

  it.each([
    ['점주', 'owner'],
    ['고객', 'customer'],
  ] as const)(
    '고객지원 계정이 아닌 %s이 전체 재확인을 실행하면 권한 오류로 거부된다 (QS-5-10b)',
    async (_label, actor) => {
      const res = await request(ctx.server)
        .post('/refund/recovery/resume')
        .set('Authorization', `Bearer ${ctx[actor].token}`)
        .send({})
        .expect(403);

      expect(res.body.error.code).toBe('REFUND_FORBIDDEN');
    },
  );

  it('운영자는 복구 현황(모드·실행 여부·건수·가장 오래된 결과 확인 실패 시각·다음 확인 시각)을 조회하고 다른 역할은 거부된다', async () => {
    await queryFailedRefund();

    const res = await request(ctx.server)
      .get('/refund/recovery/status')
      .set('Authorization', `Bearer ${ctx.manager.token}`)
      .expect(200);
    await request(ctx.server)
      .get('/refund/recovery/status')
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .expect(403);

    expect(res.body.data).toEqual({
      mode: expect.stringMatching(/^(PROBE|BATCH)$/),
      running: expect.any(Boolean),
      requestedCount: expect.any(Number),
      queryFailedCount: expect.any(Number),
      actionRequiredCount: expect.any(Number),
      reservedManualCount: expect.any(Number),
      oldestQueryFailedAt: expect.any(String),
      nextProbeAt: null,
    });
    expect(res.body.data.queryFailedCount).toBeGreaterThanOrEqual(1);
  });

  /**
   * 주 매장 고객 환불을 확정해 PG 결과를 기다리는 상태로 만든다
   * @returns 환불 ID
   */
  async function pendingRefund(): Promise<string> {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'UNKNOWN', reason: '응답 시간 초과' });
    const { body } = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    return body.data.refundId as string;
  }

  /**
   * 개별 확인을 요청한다
   * @param refundId 환불 ID
   * @param token 로그인 토큰(없으면 미로그인)
   * @param body 요청 본문
   * @returns supertest 요청
   */
  function pgCheck(refundId: string, token?: string, body: object = {}) {
    const req = request(ctx.server).post(`/refund/${refundId}/pg-check`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  }

  it('다른 매장 점주는 찾을 수 없음, 일반 고객은 권한 오류, 미로그인은 인증 오류로 거부되고 PG를 호출하지 않는다 (QS-5-17)', async () => {
    const refundId = await pendingRefund();
    pgStub.reset();

    const otherOwner = await pgCheck(refundId, ctx.otherShopOwner.token);
    const customer = await pgCheck(refundId, ctx.customer.token);
    const anonymous = await pgCheck(refundId);

    expect({
      otherOwner: [otherOwner.status, otherOwner.body.error?.code],
      customer: [customer.status, customer.body.error?.code],
      anonymous: anonymous.status,
      inquiries: pgStub.inquiryCalls.length,
    }).toEqual({
      otherOwner: [404, 'REFUND_NOT_FOUND'],
      customer: [403, 'REFUND_FORBIDDEN'],
      anonymous: 401,
      inquiries: 0,
    });
  });

  it('개별 확인 본문에 금액 필드가 있으면 400을 받고 PG를 호출하지 않는다', async () => {
    const refundId = await pendingRefund();
    pgStub.reset();

    await pgCheck(refundId, ctx.manager.token, { amount: 5000 }).expect(400);

    expect(pgStub.inquiryCalls.length).toBe(0);
  });

  /**
   * 고객 환불을 확정하고 PG 전송이 응답 없이 끝나 결과를 기다리는 상태를 만든다
   * @returns 발급 정보와 환불·PG 취소 요청 ID
   */
  async function awaitingResult() {
    const issued = await ctx.issuePeriodTicket({ fixedSeat: true });
    pgStub.respondToSend({ result: 'UNKNOWN', reason: '응답 시간 초과' });
    const { body } = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    pgStub.reset();
    return {
      ...issued,
      refundId: body.data.refundId as string,
      paymentCancelId: body.data.paymentCancelId as string,
    };
  }

  /**
   * 정해진 시간이 지난 뒤의 자동 조회를 그 시도 한 건에 대해 실행한다
   * @param paymentCancelId PG 취소 요청 ID
   * @param seconds 지금부터 지난 초
   */
  function inquireLater(paymentCancelId: string, seconds: number) {
    return ctx.app
      .get(RefundRecoveryService)
      .inquireAttempt(paymentCancelId, new Date(Date.now() + seconds * 1000));
  }

  /**
   * 환불·시도·원장·알림을 함께 읽는다
   * @param refundId 환불 ID
   * @returns 환불 상세
   */
  function loadRefund(refundId: string) {
    return ctx.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { paymentCancels: true, ledgers: true, notifications: true },
    });
  }

  it('응답 없음으로 지급 처리 중일 때 정해진 시간 뒤 거래조회 결과가 확정 금액의 취소 완료이면 지급 완료와 실제액 원장을 반영하고 이용 종료·좌석 해제는 반복하지 않는다 (QS-5-2)', async () => {
    const awaiting = await awaitingResult();
    const before = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: awaiting.ticketId },
    });
    pgStub.respondToInquiry({
      result: 'SUCCEEDED',
      pgTransactionId: `pg-cancel-${awaiting.paymentCancelId}`,
      cancelledAmount: awaiting.amount,
    });

    await inquireLater(awaiting.paymentCancelId, 61);

    const refund = await loadRefund(awaiting.refundId);
    const after = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: awaiting.ticketId },
    });
    expect({
      payoutStatus: refund.payoutStatus,
      ledgers: refund.ledgers.map((l) => l.amount),
      revokedAt: after.revokedAt,
    }).toEqual({
      payoutStatus: RefundPayoutStatus.PAID,
      ledgers: [-awaiting.amount],
      revokedAt: before.revokedAt,
    });
  });

  it('응답 없음으로 지급 처리 중일 때 거래조회 결과가 PG 거절이면 시도 실패·지급 조치 필요를 기록하고 알리며 확정 금액과 이용 종료는 유지한다 (QS-5-3)', async () => {
    const awaiting = await awaitingResult();
    pgStub.respondToInquiry({
      result: 'FAILED',
      reason: '취소 가능 기간 경과',
    });

    await inquireLater(awaiting.paymentCancelId, 61);

    const refund = await loadRefund(awaiting.refundId);
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: awaiting.ticketId },
    });
    expect({
      attempt: refund.paymentCancels[0].status,
      payoutStatus: refund.payoutStatus,
      amount: refund.amount,
      notified: refund.notifications.length > 0,
      ticket: ticket.status,
    }).toEqual({
      attempt: PaymentCancelStatus.FAILED,
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      amount: awaiting.amount,
      notified: true,
      ticket: TicketStatus.REVOKED,
    });
  });

  it('PG 응답이 없을 때 거래조회로 미접수가 확인되고 재전송 한도가 남아 있으면 같은 환불 건에서 같은 금액으로 다시 보내고 지급 처리 중으로 둔다 (QS-5-4)', async () => {
    const awaiting = await awaitingResult();
    pgStub
      .respondToInquiry({ result: 'NOT_FOUND', authoritative: true })
      .respondToSend({ result: 'ACCEPTED' });

    await inquireLater(awaiting.paymentCancelId, 61);

    const refund = await loadRefund(awaiting.refundId);
    expect({
      sent: pgStub.sendCalls.map((call) => [call.paymentCancelId, call.amount]),
      attempts: refund.paymentCancels.length,
      resendCount: refund.paymentCancels[0].resendCount,
      payoutStatus: refund.payoutStatus,
    }).toEqual({
      sent: [[awaiting.paymentCancelId, awaiting.amount]],
      attempts: 1,
      resendCount: 1,
      payoutStatus: RefundPayoutStatus.PENDING,
    });
  });

  it('자동 재전송 한도를 모두 소진한 뒤 미접수가 확인되면 그 요청을 실패로 끝내 자동 처리에서 빼고 운영자 재처리 대상으로 알리며, 처리 중이면 실패로 끝내지 않는다 (QS-5-6)', async () => {
    const exhausted = await awaitingResult();
    const stillRunning = await awaitingResult();
    await ctx.prisma.paymentCancel.updateMany({
      where: {
        id: { in: [exhausted.paymentCancelId, stillRunning.paymentCancelId] },
      },
      data: { resendCount: 3 },
    });
    pgStub
      .respondToInquiry({ result: 'NOT_FOUND', authoritative: true })
      .respondToInquiry({ result: 'IN_PROGRESS' });

    await inquireLater(exhausted.paymentCancelId, 61);
    await inquireLater(stillRunning.paymentCancelId, 61);

    const failed = await loadRefund(exhausted.refundId);
    const running = await loadRefund(stillRunning.refundId);
    expect({
      failedAttempt: [
        failed.paymentCancels[0].status,
        failed.paymentCancels[0].failureCode,
        failed.paymentCancels[0].nextInquiryAt,
      ],
      failedPayout: failed.payoutStatus,
      operatorNotified: failed.notifications.some(
        (n) => n.audience === RefundNotificationAudience.OPERATOR,
      ),
      runningAttempt: running.paymentCancels[0].status,
      sent: pgStub.sendCalls.length,
    }).toEqual({
      failedAttempt: [
        PaymentCancelStatus.FAILED,
        PaymentCancelFailureCode.RETRY_EXHAUSTED,
        null,
      ],
      failedPayout: RefundPayoutStatus.ACTION_REQUIRED,
      operatorNotified: true,
      runningAttempt: PaymentCancelStatus.REQUESTED,
      sent: 0,
    });
  });

  it('결과가 미확정일 때 거래조회 자체가 실패하면 성공·실패로 단정하지 않고 다시 조회하며 다른 환불은 받지 않는다 (QS-5-7)', async () => {
    const awaiting = await awaitingResult();
    pgStub.respondToInquiry({
      result: 'QUERY_ERROR',
      reason: 'PG 조회 시간 초과',
    });

    await inquireLater(awaiting.paymentCancelId, 61);

    const refund = await loadRefund(awaiting.refundId);
    const retry = await request(ctx.server)
      .post(`/refund/shop/${ctx.shop.id}`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({
        ticketId: awaiting.ticketId,
        amount: awaiting.amount,
        consentToTerminateTicket: true,
      })
      .expect(409);
    expect({
      attempt: refund.paymentCancels[0].status,
      rescheduled: refund.paymentCancels[0].nextInquiryAt !== null,
      payoutStatus: refund.payoutStatus,
      retry: retry.body.error.code,
    }).toEqual({
      attempt: PaymentCancelStatus.REQUESTED,
      rescheduled: true,
      payoutStatus: RefundPayoutStatus.PENDING,
      retry: 'REFUND_IN_PROGRESS',
    });
  });

  it('거래조회가 정해진 횟수만큼 연속 실패하면 결과 확인 실패로 표시하고 운영자에게 알리며 지급은 미확정·이용 종료는 유지된다 (QS-5-8)', async () => {
    const awaiting = await awaitingResult();
    await ctx.prisma.paymentCancel.update({
      where: { id: awaiting.paymentCancelId },
      data: { inquiryFailureCount: 4 },
    });
    pgStub.respondToInquiry({ result: 'QUERY_ERROR', reason: 'PG 장애' });

    await inquireLater(awaiting.paymentCancelId, 61);

    const refund = await loadRefund(awaiting.refundId);
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: awaiting.ticketId },
    });
    expect({
      attempt: refund.paymentCancels[0].status,
      operatorNotified: refund.notifications.some(
        (n) =>
          n.audience === RefundNotificationAudience.OPERATOR &&
          n.kind === 'QUERY_FAILED',
      ),
      payoutStatus: refund.payoutStatus,
      ticket: ticket.status,
    }).toEqual({
      attempt: PaymentCancelStatus.QUERY_FAILED,
      operatorNotified: true,
      payoutStatus: RefundPayoutStatus.PENDING,
      ticket: TicketStatus.REVOKED,
    });
  });

  /**
   * 결과 확인 실패 상태로 만든다(진입 시각 지정)
   * @param paymentCancelId PG 취소 요청 ID
   * @param queryFailedAt 진입 시각
   */
  function markQueryFailed(paymentCancelId: string, queryFailedAt: Date) {
    return ctx.prisma.paymentCancel.update({
      where: { id: paymentCancelId },
      data: {
        status: PaymentCancelStatus.QUERY_FAILED,
        inquiryFailureCount: 5,
        queryFailedAt,
        nextInquiryAt: null,
      },
    });
  }

  it('결과 확인 실패 건이 여러 건 쌓였을 때 자동 재확인 시점이 되면 가장 오래된 1건만 거래조회한다 (QS-5-9)', async () => {
    await ctx.prisma.refundRecoveryControl.deleteMany({});
    const oldest = await awaitingResult();
    const newer = await awaitingResult();
    await markQueryFailed(oldest.paymentCancelId, new Date('1981-01-01'));
    await markQueryFailed(newer.paymentCancelId, new Date('1981-01-02'));
    pgStub.respondByDefault({
      inquiry: { result: 'QUERY_ERROR', reason: 'PG 장애 지속' },
    });

    await ctx.app.get(RefundRecoveryService).recoverQueryFailed(new Date());

    expect(pgStub.inquiryCalls.map((call) => call.paymentCancelId)).toEqual([
      oldest.paymentCancelId,
    ]);
  });

  it('1건 조회에서 정상 응답을 받으면 그 결과를 반영하고 나머지를 정해진 건수씩 나눠 조회한다 (QS-5-10)', async () => {
    await ctx.prisma.refundRecoveryControl.deleteMany({});
    const oldest = await awaitingResult();
    const rest = await awaitingResult();
    await markQueryFailed(oldest.paymentCancelId, new Date('1980-01-01'));
    await markQueryFailed(rest.paymentCancelId, new Date('1980-01-02'));
    pgStub.respondByDefault({ inquiry: { result: 'IN_PROGRESS' } });
    const recovery = ctx.app.get(RefundRecoveryService);

    await recovery.recoverQueryFailed(new Date());
    const control = await ctx.prisma.refundRecoveryControl.findFirstOrThrow();
    await recovery.recoverQueryFailed(new Date());

    const inquired = pgStub.inquiryCalls.map((call) => call.paymentCancelId);
    const restAttempt = await ctx.prisma.paymentCancel.findUniqueOrThrow({
      where: { id: rest.paymentCancelId },
    });
    expect({
      modeAfterProbe: control.mode,
      first: inquired[0],
      restInquired: inquired.includes(rest.paymentCancelId),
      restStatus: restAttempt.status,
    }).toEqual({
      modeAfterProbe: 'BATCH',
      first: oldest.paymentCancelId,
      restInquired: true,
      restStatus: PaymentCancelStatus.REQUESTED,
    });
  });

  it('PG가 다른 금액의 취소 완료를 알리면 실제 지급액과 원장을 기록하고 확정 금액은 그대로 두며 부족액을 조치 필요로 두고 운영자에게 알린다 (QS-5-11)', async () => {
    const awaiting = await awaitingResult();
    pgStub.respondToInquiry({
      result: 'SUCCEEDED',
      pgTransactionId: `pg-cancel-${awaiting.paymentCancelId}`,
      cancelledAmount: awaiting.amount - 3000,
    });

    await inquireLater(awaiting.paymentCancelId, 61);

    const refund = await loadRefund(awaiting.refundId);
    expect({
      amount: refund.amount,
      paidAmount: refund.paidAmount,
      ledgers: refund.ledgers.map((l) => l.amount),
      payoutStatus: refund.payoutStatus,
      reviewRequired: refund.reviewRequired,
      operatorNotified: refund.notifications.some(
        (n) =>
          n.audience === RefundNotificationAudience.OPERATOR &&
          n.kind === 'AMOUNT_MISMATCH',
      ),
    }).toEqual({
      amount: awaiting.amount,
      paidAmount: awaiting.amount - 3000,
      ledgers: [-(awaiting.amount - 3000)],
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      reviewRequired: true,
      operatorNotified: true,
    });
  });

  it('점주가 자기 매장 환불의 PG 처리 결과를 확인하고 PG가 확정 금액의 취소 완료를 응답하면 그 시도 한 건만 즉시 조회해 지급 완료·실제액·원장을 한 번 반영해 보여준다 (QS-5-13)', async () => {
    const awaiting = await awaitingResult();
    pgStub.respondToInquiry({
      result: 'SUCCEEDED',
      pgTransactionId: `pg-cancel-${awaiting.paymentCancelId}`,
      cancelledAmount: awaiting.amount,
    });

    const res = await pgCheck(awaiting.refundId, ctx.owner.token).expect(200);

    const refund = await loadRefund(awaiting.refundId);
    expect({
      checkStatus: res.body.data.checkStatus,
      shownPayout: res.body.data.refund.payoutStatus,
      inquiries: pgStub.inquiryCalls.length,
      ledgers: refund.ledgers.length,
    }).toEqual({
      checkStatus: 'CHECKED',
      shownPayout: RefundPayoutStatus.PAID,
      inquiries: 1,
      ledgers: 1,
    });
  });

  it.each([
    ['처리 중', { result: 'IN_PROGRESS' as const }, 'IN_PROGRESS', false],
    [
      '조회 실패',
      { result: 'QUERY_ERROR' as const, reason: 'PG 조회 실패' },
      'QUERY_ERROR',
      true,
    ],
  ])(
    '개별 확인에서 PG가 %s이면 그대로 안내하고 지급을 확정하지 않는다 (QS-5-14)',
    async (_label, inquiry, inquiryResult, lastInquiryFailed) => {
      const awaiting = await awaitingResult();
      pgStub.respondToInquiry(inquiry);

      const res = await pgCheck(awaiting.refundId, ctx.manager.token).expect(
        200,
      );

      expect({
        inquiryResult: res.body.data.inquiryResult,
        lastInquiryFailed: res.body.data.lastInquiryFailed,
        payoutStatus: res.body.data.refund.payoutStatus,
        sent: pgStub.sendCalls.length,
      }).toEqual({
        inquiryResult,
        lastInquiryFailed,
        payoutStatus: RefundPayoutStatus.PENDING,
        sent: 0,
      });
    },
  );

  it('자동 작업이 그 요청을 전송·조회 중일 때 같은 환불의 PG 확인을 실행하면 진행 중과 현재 상태를 안내하고 PG를 중복 호출하지 않는다 (QS-5-15)', async () => {
    const awaiting = await awaitingResult();
    await ctx.prisma.paymentCancel.update({
      where: { id: awaiting.paymentCancelId },
      data: {
        claimToken: 'auto-worker',
        claimUntil: new Date(Date.now() + 30_000),
      },
    });

    const res = await pgCheck(awaiting.refundId, ctx.owner.token).expect(202);

    expect({
      checkStatus: res.body.data.checkStatus,
      inquiries: pgStub.inquiryCalls.length,
    }).toEqual({ checkStatus: 'ALREADY_RUNNING', inquiries: 0 });
  });

  it('결과 확인 실패 환불이 여러 건일 때 한 건만 개별 확인하면 그 환불만 확인하고 전체 장애 복구 모드·예정 시각은 바꾸지 않는다 (QS-5-16)', async () => {
    await ctx.prisma.refundRecoveryControl.deleteMany({});
    const target = await awaitingResult();
    const other = await awaitingResult();
    await markQueryFailed(target.paymentCancelId, new Date());
    await markQueryFailed(other.paymentCancelId, new Date());
    const controlBefore = await request(ctx.server)
      .get('/refund/recovery/status')
      .set('Authorization', `Bearer ${ctx.manager.token}`)
      .expect(200);
    pgStub.respondByDefault({ inquiry: { result: 'IN_PROGRESS' } });

    await pgCheck(target.refundId, ctx.manager.token).expect(200);

    const controlAfter = await request(ctx.server)
      .get('/refund/recovery/status')
      .set('Authorization', `Bearer ${ctx.manager.token}`)
      .expect(200);
    const otherAttempt = await ctx.prisma.paymentCancel.findUniqueOrThrow({
      where: { id: other.paymentCancelId },
    });
    expect({
      inquired: pgStub.inquiryCalls.map((call) => call.paymentCancelId),
      otherStatus: otherAttempt.status,
      mode: controlAfter.body.data.mode,
      nextProbeAt: controlAfter.body.data.nextProbeAt,
    }).toEqual({
      inquired: [target.paymentCancelId],
      otherStatus: PaymentCancelStatus.QUERY_FAILED,
      mode: controlBefore.body.data.mode,
      nextProbeAt: controlBefore.body.data.nextProbeAt,
    });
  });

  it('지급 완료 등 개별 PG 조회 대상이 아닌 환불을 확인하면 PG를 호출하지 않고 저장된 상태를 보여준다 (QS-5-18)', async () => {
    const awaiting = await awaitingResult();
    pgStub.respondToInquiry({
      result: 'SUCCEEDED',
      pgTransactionId: `pg-cancel-${awaiting.paymentCancelId}`,
      cancelledAmount: awaiting.amount,
    });
    await inquireLater(awaiting.paymentCancelId, 61);
    pgStub.reset();

    const res = await pgCheck(awaiting.refundId, ctx.owner.token).expect(200);

    expect({
      checkStatus: res.body.data.checkStatus,
      payoutStatus: res.body.data.refund.payoutStatus,
      inquiries: pgStub.inquiryCalls.length,
    }).toEqual({
      checkStatus: 'NO_PENDING_ATTEMPT',
      payoutStatus: RefundPayoutStatus.PAID,
      inquiries: 0,
    });
  });

  it('미확정 시도의 개별 확인에서 PG 미접수가 확인되면 자동 재전송 횟수와 관계없이 기존 식별자·확정 금액으로 즉시 다시 보내고, 조회 오류이면 보내지 않는다 (QS-5-19)', async () => {
    const notReceived = await awaitingResult();
    const queryError = await awaitingResult();
    await ctx.prisma.paymentCancel.update({
      where: { id: notReceived.paymentCancelId },
      data: { resendCount: 3 },
    });
    pgStub
      .respondToInquiry({ result: 'NOT_FOUND', authoritative: true })
      .respondToSend({ result: 'ACCEPTED' })
      .respondToInquiry({ result: 'QUERY_ERROR', reason: '조회 실패' });

    const resent = await pgCheck(notReceived.refundId, ctx.owner.token).expect(
      200,
    );
    const notResent = await pgCheck(
      queryError.refundId,
      ctx.owner.token,
    ).expect(200);

    expect({
      resendResult: resent.body.data.resendResult,
      notResendResult: notResent.body.data.resendResult,
      sent: pgStub.sendCalls.map((call) => [call.paymentCancelId, call.amount]),
    }).toEqual({
      resendResult: 'ACCEPTED',
      notResendResult: null,
      sent: [[notReceived.paymentCancelId, notReceived.amount]],
    });
  });

  it('직전 조회 시작부터 정해진 간격이 지나지 않았을 때 개별 확인을 반복하면 최근 조회 시각과 저장 상태를 보여주고 PG를 추가 호출하지 않는다 (QS-5-20)', async () => {
    const awaiting = await awaitingResult();
    pgStub.respondByDefault({ inquiry: { result: 'IN_PROGRESS' } });
    const first = await pgCheck(awaiting.refundId, ctx.owner.token).expect(200);

    const second = await pgCheck(awaiting.refundId, ctx.manager.token).expect(
      200,
    );

    expect({
      checkStatus: second.body.data.checkStatus,
      lastInquiryAt: second.body.data.lastInquiryAt,
      inquiries: pgStub.inquiryCalls.length,
    }).toEqual({
      checkStatus: 'RECENT_RESULT',
      lastInquiryAt: first.body.data.lastInquiryAt,
      inquiries: 1,
    });
  });

  /**
   * 고객 환불의 최초 PG 취소 요청이 보내기 전에 실패해 조치 필요가 된 환불을 만든다
   * @returns 환불 ID
   */
  async function sendFailedRefund(): Promise<string> {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'NOT_SENT', reason: 'PG 연결 설정 누락' });
    const res = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    return res.body.data.refundId as string;
  }

  it('별도 환불금 지급 예약이 있는 환불은 PG를 호출하지 않고 예약과 기존 실패 이력을 바꾸지 않으며, 최근 시도가 전송 전 실패로 실패한 환불은 개별 조회 대상이다 (QS-5-18)', async () => {
    const reserved = await sendFailedRefund();
    const retryable = await sendFailedRefund();
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: reserved },
    });
    await ctx.prisma.manualRefundPayout.create({
      data: {
        refundId: reserved,
        status: ManualRefundPayoutStatus.RESERVED,
        amount: refund.amount,
        reservedById: ctx.manager.id,
        reservedAt: new Date(),
        reason: '계좌 이체로 지급 예정',
      },
    });
    pgStub.reset();
    pgStub.respondToInquiry({ result: 'IN_PROGRESS' });

    const reservedRes = await pgCheck(reserved, ctx.owner.token).expect(200);
    const reservedInquiries = pgStub.inquiryCalls.length;
    const retryableRes = await pgCheck(retryable, ctx.owner.token).expect(200);

    const after = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: reserved },
      include: { manualPayouts: true, paymentCancels: true },
    });
    expect({
      reserved: reservedRes.body.data.checkStatus,
      reservedInquiries,
      reservation: after.manualPayouts.map((payout) => payout.status),
      failures: after.paymentCancels.map((attempt) => [
        attempt.status,
        attempt.failureCode,
      ]),
      retryable: [
        retryableRes.body.data.checkStatus,
        retryableRes.body.data.inquiryResult,
      ],
    }).toEqual({
      reserved: 'NO_PENDING_ATTEMPT',
      reservedInquiries: 0,
      reservation: [ManualRefundPayoutStatus.RESERVED],
      failures: [
        [PaymentCancelStatus.FAILED, PaymentCancelFailureCode.SEND_FAILED],
      ],
      retryable: ['CHECKED', 'IN_PROGRESS'],
    });
  });

  it('최근 시도가 이미 실패한 환불의 개별 확인에서 미접수가 확인되면 실패 이력을 보존한 채 새 PG 취소 요청 식별자로 확정 금액을 보내고, 미확정 요청의 조회에서 거절이 새로 확인되면 실패·조치 필요만 기록하고 같은 실행에서 새 요청을 만들지 않는다 (QS-5-19)', async () => {
    const failed = await sendFailedRefund();
    const awaiting = await awaitingResult();
    pgStub.reset();
    pgStub
      .respondToInquiry({ result: 'NOT_FOUND', authoritative: true })
      .respondToSend({ result: 'ACCEPTED' })
      .respondToInquiry({ result: 'FAILED', reason: '카드사 거절' });

    const resent = await pgCheck(failed, ctx.owner.token).expect(200);
    const rejected = await pgCheck(awaiting.refundId, ctx.owner.token).expect(
      200,
    );

    const failedAttempts = await ctx.prisma.paymentCancel.findMany({
      where: { refundId: failed },
      orderBy: { attemptNumber: 'asc' },
    });
    const awaitingRefund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: awaiting.refundId },
      include: { paymentCancels: true },
    });
    expect({
      resent: resent.body.data.resendResult,
      failedAttempts: failedAttempts.map((attempt) => [
        attempt.status,
        attempt.amount,
      ]),
      sent: pgStub.sendCalls.map((call) => call.paymentCancelId),
      rejected: rejected.body.data.resendResult,
      awaiting: {
        attempts: awaitingRefund.paymentCancels.map((attempt) => [
          attempt.status,
          attempt.failureCode,
        ]),
        payoutStatus: awaitingRefund.payoutStatus,
      },
    }).toEqual({
      resent: 'ACCEPTED',
      failedAttempts: [
        [PaymentCancelStatus.FAILED, failedAttempts[0].amount],
        [PaymentCancelStatus.REQUESTED, failedAttempts[0].amount],
      ],
      sent: [failedAttempts[1]?.id],
      rejected: null,
      awaiting: {
        attempts: [
          [PaymentCancelStatus.FAILED, PaymentCancelFailureCode.PG_REJECTED],
        ],
        payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      },
    });
  });

  /**
   * 승인 금액 불일치로 시스템 자동 취소가 시작된 결제를 만든다
   * @param firstSend 최초 PG 전송 결과
   * @returns 결제·자동 취소 환불·PG 취소 요청·승인액
   */
  async function systemAutoCancel(
    firstSend: Parameters<RefundPgStub['respondToSend']>[0],
  ) {
    const awaiting = await ctx.orderPeriodAwaitingApproval();
    const approvedAmount = awaiting.amount - 1000;
    pgStub.respondToSend(firstSend);
    await request(ctx.server)
      .post('/payments/callback')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({
        success: true,
        pgTransactionId: awaiting.pgTransactionId,
        amount: approvedAmount,
        reason: null,
      })
      .expect(200);
    const refund = await ctx.prisma.refund.findFirstOrThrow({
      where: { paymentId: awaiting.paymentId },
      include: { paymentCancels: true },
    });
    return {
      awaiting,
      refundId: refund.id,
      paymentCancelId: refund.paymentCancels[0].id,
      approvedAmount,
    };
  }

  it('시스템 자동 취소의 PG 응답이 없을 때 거래조회로 미접수가 확인되고 재전송 한도가 남아 있으면 같은 금액을 다시 보낸다 (QS-5-5)', async () => {
    const auto = await systemAutoCancel({
      result: 'UNKNOWN',
      reason: '응답 시간 초과',
    });
    pgStub
      .respondToInquiry({ result: 'NOT_FOUND', authoritative: true })
      .respondToSend({ result: 'ACCEPTED' });

    await inquireLater(auto.paymentCancelId, 61);

    const attempt = await ctx.prisma.paymentCancel.findUniqueOrThrow({
      where: { id: auto.paymentCancelId },
    });
    expect({
      sent: pgStub.sendCalls.map((call) => [call.paymentCancelId, call.amount]),
      resendCount: attempt.resendCount,
    }).toEqual({
      sent: [
        [auto.paymentCancelId, auto.approvedAmount],
        [auto.paymentCancelId, auto.approvedAmount],
      ],
      resendCount: 1,
    });
  });

  it('시스템 자동 취소 건의 지급 결과를 받지 못하면 같은 조회·미지급 관리 규칙을 적용해 거래조회의 PG 거절은 실패·조치 필요·운영자에게만 알리며, 승인 금액 불일치 건은 이용권을 만들지 않는다 (QS-5-12)', async () => {
    const auto = await systemAutoCancel({
      result: 'UNKNOWN',
      reason: '응답 시간 초과',
    });
    pgStub.respondToInquiry({ result: 'FAILED', reason: '카드사 거절' });

    await inquireLater(auto.paymentCancelId, 61);

    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: auto.refundId },
      include: { paymentCancels: true, notifications: true },
    });
    const tickets = await ctx.prisma.ticket.count({
      where: { orderItem: { orderId: auto.awaiting.orderId } },
    });
    expect({
      attempt: [
        refund.paymentCancels[0].status,
        refund.paymentCancels[0].failureCode,
      ],
      payoutStatus: refund.payoutStatus,
      audiences: refund.notifications
        .filter((n) => n.kind === 'PG_REJECTED')
        .map((n) => n.audience),
      tickets,
    }).toEqual({
      attempt: [
        PaymentCancelStatus.FAILED,
        PaymentCancelFailureCode.PG_REJECTED,
      ],
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      audiences: [RefundNotificationAudience.OPERATOR],
      tickets: 0,
    });
  });
});
