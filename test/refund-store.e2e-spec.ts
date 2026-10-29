/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { signedCallback } from './helpers/pg-callback';
import {
  PaymentCancelStatus,
  PaymentStatus,
  RefundDecisionStatus,
  RefundPayoutStatus,
  RefundSource,
  SeatAssignmentStatus,
  SeatType,
  TicketStatus,
  UsageSessionStatus,
} from '@prisma/client';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  IssuedTicket,
  RefundTestContext,
  TestActor,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';

/**
 * 사용자 스토리 2: 점주의 매장 환불 (E2E)
 * - 테스트 이름 끝의 (QS-n-m)은 specs/002-refund-completion/spec.md 사용자 스토리 n의 인수 시나리오 m
 */
describe('매장 환불 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'store',
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

  /**
   * 점주 권한으로 매장 환불을 요청한다
   * @param body 요청 본문
   * @param actor 요청자(기본: 주 매장 점주)
   * @param shopId 대상 매장(기본: 주 매장)
   * @returns supertest 요청
   */
  function requestStoreRefund(
    body: object,
    actor: TestActor = ctx.owner,
    shopId: string = ctx.shop.id,
  ) {
    return request(ctx.server)
      .post(`/refund/shop/${shopId}`)
      .set('Authorization', `Bearer ${actor.token}`)
      .send(body);
  }

  /**
   * 사용 이력이 있는(이미 활성화된) 고정석 정기권을 만든다
   * @returns 발급 정보
   */
  async function usedPeriodTicket(): Promise<IssuedTicket> {
    const issued = await ctx.issuePeriodTicket({ fixedSeat: true });
    await ctx.prisma.ticket.update({
      where: { id: issued.ticketId },
      data: {
        status: TicketStatus.ACTIVE,
        activatedAt: new Date(Date.now() - 86_400_000),
      },
    });
    return issued;
  }

  it('사용 이력이 있는 이용권을 점주가 실결제액 이하 금액과 사유로 환불하면 이용 종료·고정석 해제·그 금액의 환불이 확정되고 점주·시각·사유·금액이 기록되며 지급 처리 중으로 응답한다 (QS-2-1)', async () => {
    const issued = await usedPeriodTicket();
    const amount = issued.amount - 3000;

    const res = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount,
      reason: '서비스 불만 보상',
      consentToTerminateTicket: true,
    }).expect(202);

    // 응답: 이용 종료 완료·환불금 지급 처리 중
    expect(res.body.data).toMatchObject({
      decisionStatus: RefundDecisionStatus.ACCEPTED,
      ticketId: issued.ticketId,
      amount,
      payoutStatus: RefundPayoutStatus.PENDING,
    });

    // 저장 결과: 점주·시각·사유·금액, 이용 종료, 고정석 해제, PG 결제 취소 시작
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: res.body.data.refundId as string },
    });
    expect({
      source: refund.source,
      amount: refund.amount,
      reason: refund.reason,
      requestedById: refund.requestedById,
      acceptedAt: refund.acceptedAt instanceof Date,
    }).toEqual({
      source: RefundSource.STORE,
      amount,
      reason: '서비스 불만 보상',
      requestedById: ctx.owner.id,
      acceptedAt: true,
    });
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect(ticket.status).toBe(TicketStatus.REVOKED);
    const activeAssignment = await ctx.prisma.seatAssignment.findFirst({
      where: {
        ticketId: issued.ticketId,
        status: SeatAssignmentStatus.ACTIVE,
      },
    });
    expect(activeAssignment).toBeNull();
    expect(pgStub.sendCalls).toEqual([expect.objectContaining({ amount })]);
  });
  /**
   * 기한 안 미사용 정기권을 만든다(어긴 규칙 없음)
   * @returns 발급 정보
   */
  function unusedPeriodTicket(): Promise<IssuedTicket> {
    return ctx.issuePeriodTicket({ fixedSeat: true });
  }

  /**
   * 기한이 지난 미사용 정기권을 만든다
   * @returns 발급 정보
   */
  async function expiredUnusedTicket(): Promise<IssuedTicket> {
    const issued = await ctx.issuePeriodTicket({ fixedSeat: true });
    await ctx.prisma.ticket.update({
      where: { id: issued.ticketId },
      data: { activationDeadline: new Date(Date.now() - 60_000) },
    });
    return issued;
  }

  /**
   * 시간을 다 써서 소진된 시간권을 만든다
   * @returns 발급 정보
   */
  async function exhaustedTimeTicket(): Promise<IssuedTicket> {
    const issued = await ctx.issueTimeTicket();
    await ctx.prisma.ticket.update({
      where: { id: issued.ticketId },
      data: {
        status: TicketStatus.EXHAUSTED,
        activatedAt: new Date(Date.now() - 86_400_000),
        remainingMinutes: 0,
      },
    });
    return issued;
  }

  /**
   * 일부를 쓴 시간권으로 지금 자유석을 이용 중인 상태를 만든다
   * @returns 발급 정보와 이용 세션 ID
   */
  async function inUseTimeTicket(): Promise<
    IssuedTicket & { sessionId: string }
  > {
    const issued = await ctx.issueTimeTicket();
    const ticket = await ctx.prisma.ticket.update({
      where: { id: issued.ticketId },
      data: {
        status: TicketStatus.ACTIVE,
        activatedAt: new Date(Date.now() - 86_400_000),
        remainingMinutes: { decrement: 60 },
      },
    });
    const seatId = await ctx.createSeat(SeatType.FREE);
    const startedAt = new Date(Date.now() - 30 * 60_000);
    const session = await ctx.prisma.usageSession.create({
      data: {
        ticketId: issued.ticketId,
        seatId,
        shopId: ctx.shop.id,
        userId: ticket.userId,
        startedAt,
        plannedEndAt: new Date(startedAt.getTime() + 4 * 60 * 60_000),
      },
    });
    return { ...issued, sessionId: session.id };
  }

  /**
   * 이용권과 결제·환불 기록이 바뀌지 않았는지 확인할 상태를 읽는다
   * @param issued 발급 정보
   * @returns 이용권 상태·결제 상태·환불 수
   */
  async function unchangedState(issued: IssuedTicket) {
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    const payment = await ctx.prisma.payment.findUniqueOrThrow({
      where: { id: issued.paymentId },
    });
    const refunds = await ctx.prisma.refund.count({
      where: { orderItemId: issued.orderItemId },
    });
    return { ticket: ticket.status, payment: payment.status, refunds };
  }

  /**
   * PG 취소 결과 콜백을 보낸다(US7 서명 전까지 JWT 경로)
   * @param body 콜백 본문
   * @returns supertest 요청
   */
  function sendRefundCallback(body: object) {
    return signedCallback(ctx.server, '/refund/callback', body);
  }

  it('사용 이력 이용권의 매장 환불 뒤 PG가 그 금액의 취소를 확정하면 지급 완료가 되고 이용 종료·좌석 해제는 반복하지 않는다 (QS-2-2)', async () => {
    const issued = await usedPeriodTicket();
    const { body } = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount: 7000,
      reason: '보상',
      consentToTerminateTicket: true,
    }).expect(202);
    const before = await ctx.prisma.seatAssignment.findFirstOrThrow({
      where: { ticketId: issued.ticketId },
    });
    const ticketBefore = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });

    await sendRefundCallback({
      success: true,
      paymentCancelId: body.data.paymentCancelId,
      pgTransactionId: `pg-cancel-${body.data.paymentCancelId}`,
      orderItemId: issued.orderItemId,
      amount: 7000,
      reason: null,
    }).expect(200);

    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: body.data.refundId as string },
    });
    const after = await ctx.prisma.seatAssignment.findFirstOrThrow({
      where: { ticketId: issued.ticketId },
    });
    const ticketAfter = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect({
      payoutStatus: refund.payoutStatus,
      releasedAt: after.releasedAt,
      revokedAt: ticketAfter.revokedAt,
    }).toEqual({
      payoutStatus: RefundPayoutStatus.PAID,
      releasedAt: before.releasedAt,
      revokedAt: ticketBefore.revokedAt,
    });
  });

  it.each([
    [0, 200, RefundPayoutStatus.PAID],
    [7000, 202, RefundPayoutStatus.PENDING],
    [10000, 202, RefundPayoutStatus.PENDING],
  ])(
    '기한이 지난 미사용 이용권은 입력액 %d원으로 환불과 이용 종료·좌석 해제가 확정된다 (QS-2-3)',
    async (amount, status, payoutStatus) => {
      const issued = await expiredUnusedTicket();

      const res = await requestStoreRefund({
        ticketId: issued.ticketId,
        amount,
        reason: '기한 경과 환불',
        consentToTerminateTicket: true,
      }).expect(status);

      const refund = await ctx.prisma.refund.findUniqueOrThrow({
        where: { id: res.body.data.refundId as string },
        include: { ledgers: true },
      });
      const activeAssignment = await ctx.prisma.seatAssignment.findFirst({
        where: {
          ticketId: issued.ticketId,
          status: SeatAssignmentStatus.ACTIVE,
        },
      });
      expect({
        amount: refund.amount,
        payoutStatus: refund.payoutStatus,
        zeroLedger: refund.ledgers.map((l) => l.amount),
        activeAssignment,
        pgCalls: pgStub.sendCalls.length,
      }).toEqual({
        amount,
        payoutStatus,
        zeroLedger: amount === 0 ? [0] : [],
        activeAssignment: null,
        pgCalls: amount === 0 ? 0 : 1,
      });
    },
  );

  it.each([
    [3000, 202, RefundPayoutStatus.PENDING],
    [0, 200, RefundPayoutStatus.PAID],
  ])(
    '소진된 시간권도 금액 %d원과 사유로 매장 환불이 확정된다 (QS-2-3a)',
    async (amount, status, payoutStatus) => {
      const issued = await exhaustedTimeTicket();

      const res = await requestStoreRefund({
        ticketId: issued.ticketId,
        amount,
        reason: '소진 후 보상',
        consentToTerminateTicket: true,
      }).expect(status);

      expect(res.body.data).toMatchObject({ amount, payoutStatus });
    },
  );

  it('사용 이력 이용권을 0원과 사유로 매장 환불하면 PG 요청 없이 환불 확정·이용 종료·좌석 해제·지급 완료·원장 0원이 함께 처리된다 (QS-2-4)', async () => {
    const issued = await usedPeriodTicket();

    const res = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount: 0,
      reason: '환불금 없이 종료',
      consentToTerminateTicket: true,
    }).expect(200);

    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: res.body.data.refundId as string },
      include: { ledgers: true, paymentCancels: true },
    });
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    const activeAssignment = await ctx.prisma.seatAssignment.findFirst({
      where: {
        ticketId: issued.ticketId,
        status: SeatAssignmentStatus.ACTIVE,
      },
    });
    expect({
      payoutStatus: refund.payoutStatus,
      ledgers: refund.ledgers.map((l) => l.amount),
      attempts: refund.paymentCancels.length,
      ticket: ticket.status,
      activeAssignment,
      pgCalls: pgStub.sendCalls.length,
    }).toEqual({
      payoutStatus: RefundPayoutStatus.PAID,
      ledgers: [0],
      attempts: 0,
      ticket: TicketStatus.REVOKED,
      activeAssignment: null,
      pgCalls: 0,
    });
  });

  it('사용 이력 이용권에 실결제액보다 큰 금액을 입력하면 거절되고 이용권·결제에는 변화가 없다 (QS-2-5)', async () => {
    const issued = await usedPeriodTicket();

    const res = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount: issued.amount + 1,
      reason: '보상',
      consentToTerminateTicket: true,
    }).expect(400);

    expect(res.body.error.code).toBe('REFUND_AMOUNT_EXCEEDED');
    expect(await unchangedState(issued)).toEqual({
      ticket: TicketStatus.ACTIVE,
      payment: PaymentStatus.SUCCESS,
      refunds: 0,
    });
  });

  it('사용 이력 이용권을 사유 없이 매장 환불하면 거절된다 (QS-2-6)', async () => {
    const issued = await usedPeriodTicket();

    const res = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount: 5000,
      consentToTerminateTicket: true,
    }).expect(400);

    expect(res.body.error.code).toBe('REFUND_REASON_REQUIRED');
  });

  it('다른 매장의 이용권을 자기 매장에서 환불하면 찾을 수 없는 이용권으로 거절되고 다른 매장에 있다는 사실은 드러나지 않는다 (QS-2-7)', async () => {
    const issued = await ctx.issuePeriodTicket({ shop: ctx.otherShop });

    const res = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount: issued.amount,
      consentToTerminateTicket: true,
    }).expect(404);

    expect(res.body.error.code).toBe('TICKET_NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toContain(ctx.otherShop.id);
  });

  it('고객지원 계정이 매장 환불을 하면 권한이 없어 거절된다 (QS-2-7a)', async () => {
    const issued = await usedPeriodTicket();

    const res = await requestStoreRefund(
      {
        ticketId: issued.ticketId,
        amount: 5000,
        reason: '보상',
        consentToTerminateTicket: true,
      },
      ctx.manager,
    ).expect(403);

    expect(res.body.error.code).toBe('REFUND_FORBIDDEN');
  });

  it('기한 안 미사용 이용권을 실결제액 전액으로 매장 환불하면 사유 없이도 확정되고 점주·시각이 기록되며 지급 처리 중으로 응답한다 (QS-2-8)', async () => {
    const issued = await unusedPeriodTicket();

    const res = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount: issued.amount,
      consentToTerminateTicket: true,
    }).expect(202);

    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: res.body.data.refundId as string },
    });
    expect({
      payoutStatus: res.body.data.payoutStatus,
      requestedById: refund.requestedById,
      acceptedAt: refund.acceptedAt instanceof Date,
      reason: refund.reason,
    }).toEqual({
      payoutStatus: RefundPayoutStatus.PENDING,
      requestedById: ctx.owner.id,
      acceptedAt: true,
      reason: null,
    });
  });

  it('기한 안 미사용 이용권을 실결제액과 다른 금액으로 매장 환불하면 전액만 환불할 수 있다는 사유로 거절되고 이용권·결제에는 변화가 없다 (QS-2-8a)', async () => {
    const issued = await unusedPeriodTicket();

    const res = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount: issued.amount - 1000,
      reason: '부분 환불',
      consentToTerminateTicket: true,
    }).expect(400);

    expect(res.body.error.code).toBe('UNUSED_TICKET_FULL_REFUND_REQUIRED');
    expect(await unchangedState(issued)).toEqual({
      ticket: TicketStatus.UNUSED,
      payment: PaymentStatus.SUCCESS,
      refunds: 0,
    });
  });

  it.each([
    [RefundPayoutStatus.PAID, 'ALREADY_REFUNDED'],
    [RefundPayoutStatus.PENDING, 'REFUND_IN_PROGRESS'],
  ])(
    '이미 확정된 환불(%s)이 있는 이용권은 고객 환불과 같은 코드 %s로 거절된다 (QS-2-9)',
    async (payoutStatus, code) => {
      const issued = await usedPeriodTicket();
      const { body } = await requestStoreRefund({
        ticketId: issued.ticketId,
        amount: 5000,
        reason: '보상',
        consentToTerminateTicket: true,
      }).expect(202);
      await ctx.prisma.refund.update({
        where: { id: body.data.refundId as string },
        data: { payoutStatus },
      });

      const res = await requestStoreRefund({
        ticketId: issued.ticketId,
        amount: 3000,
        reason: '추가 보상',
        consentToTerminateTicket: true,
      }).expect(409);

      expect(res.body.error.code).toBe(code);
    },
  );

  it('고객이 이용 중일 때 퇴실 동의 없이 매장 환불하면 이용 중 오류로 거절되고 이용과 이용권에는 변화가 없다 (QS-2-10)', async () => {
    const issued = await inUseTimeTicket();

    const res = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount: 5000,
      reason: '보상',
      consentToTerminateTicket: true,
    }).expect(409);

    expect(res.body.error.code).toBe('TICKET_IN_USE');
    const session = await ctx.prisma.usageSession.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });
    expect({
      session: session.status,
      ...(await unchangedState(issued)),
    }).toEqual({
      session: UsageSessionStatus.ACTIVE,
      ticket: TicketStatus.ACTIVE,
      payment: PaymentStatus.SUCCESS,
      refunds: 0,
    });
  });

  it('고객이 이용 중일 때 퇴실 동의를 담아 매장 환불하면 퇴실·사용 시간 차감·이용 종료·환불 확정 뒤 PG 결제 취소를 시작하고 지급 처리 중으로 응답한다 (QS-2-11)', async () => {
    const issued = await inUseTimeTicket();
    const before = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });

    const res = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount: 5000,
      reason: '이용 중 불편 보상',
      consentToTerminateTicket: true,
      consentToEndSession: true,
    }).expect(202);

    const session = await ctx.prisma.usageSession.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect({
      payoutStatus: res.body.data.payoutStatus,
      session: session.status,
      deducted: before.remainingMinutes! > ticket.remainingMinutes!,
      ticket: ticket.status,
      pgCalls: pgStub.sendCalls.length,
    }).toEqual({
      payoutStatus: RefundPayoutStatus.PENDING,
      session: UsageSessionStatus.ENDED,
      deducted: true,
      ticket: TicketStatus.REVOKED,
      pgCalls: 1,
    });
  });

  it('이용 중에 퇴실 동의를 담았지만 실결제액보다 큰 금액이면 거절되고 퇴실도 되지 않는다 (QS-2-12)', async () => {
    const issued = await inUseTimeTicket();

    const res = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount: issued.amount + 1,
      reason: '보상',
      consentToTerminateTicket: true,
      consentToEndSession: true,
    }).expect(400);

    expect(res.body.error.code).toBe('REFUND_AMOUNT_EXCEEDED');
    const session = await ctx.prisma.usageSession.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });
    expect(session.status).toBe(UsageSessionStatus.ACTIVE);
  });

  it('이용 중 매장 환불이 확정된 뒤 PG가 취소 실패를 확정하면 실패·미지급 조치 필요를 기록하고 알리며 이용 종료·퇴실은 유지하고 새 환불을 받지 않는다 (QS-2-13)', async () => {
    const issued = await inUseTimeTicket();
    const { body } = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount: 5000,
      reason: '보상',
      consentToTerminateTicket: true,
      consentToEndSession: true,
    }).expect(202);

    await sendRefundCallback({
      success: false,
      paymentCancelId: body.data.paymentCancelId,
      pgTransactionId: `pg-cancel-${body.data.paymentCancelId}`,
      orderItemId: issued.orderItemId,
      amount: 5000,
      reason: '취소 가능 기간 경과',
    }).expect(200);

    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: body.data.refundId as string },
      include: { paymentCancels: true, notifications: true },
    });
    const session = await ctx.prisma.usageSession.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect({
      attempt: refund.paymentCancels[0].status,
      payoutStatus: refund.payoutStatus,
      notified: refund.notifications.length > 0,
      session: session.status,
      ticket: ticket.status,
    }).toEqual({
      attempt: PaymentCancelStatus.FAILED,
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      notified: true,
      session: UsageSessionStatus.ENDED,
      ticket: TicketStatus.REVOKED,
    });
    // 이용권을 복구하거나 새 환불을 받지 않는다(같은 환불의 지급 재처리는 US10)
    const retry = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount: 5000,
      reason: '다시 환불',
      consentToTerminateTicket: true,
    }).expect(409);
    expect(retry.body.error.code).toBe('REFUND_IN_PROGRESS');
  });
});
