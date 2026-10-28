/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import {
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
});
