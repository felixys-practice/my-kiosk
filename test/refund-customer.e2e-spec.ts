/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import {
  PaymentStatus,
  RefundDecisionStatus,
  RefundPayoutStatus,
  RefundSource,
  RefundTargetKind,
  SeatAssignmentStatus,
  SeatType,
  TicketStatus,
  UsageSessionStatus,
} from '@prisma/client';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';

/**
 * 사용자 스토리 1: 고객 환불 판정과 이용 종료 확정 (E2E)
 * - 테스트 이름 끝의 (QS-n-m)은 specs/002-refund-completion/spec.md 사용자 스토리 n의 인수 시나리오 m
 */
describe('고객 환불 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'customer',
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
   * 고객 권한으로 환불을 신청한다
   * @param body 요청 본문
   * @returns supertest 요청
   */
  function requestRefund(body: object) {
    return request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send(body);
  }

  it('결제를 마친 미사용 이용권을 기한 안에 환불하면 실결제액 전액 환불과 이용 종료가 확정되고 고정석이 해제되며 이용 종료 완료·지급 처리 중으로 응답한다 (QS-1-1)', async () => {
    const issued = await ctx.issuePeriodTicket({ fixedSeat: true });

    const res = await requestRefund({
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
    }).expect(202);

    // 응답: 이용 종료 완료·환불금 지급 처리 중
    expect(res.body.data).toMatchObject({
      decisionStatus: RefundDecisionStatus.ACCEPTED,
      ticketId: issued.ticketId,
      amount: issued.amount,
      payoutStatus: RefundPayoutStatus.PENDING,
    });
    expect(res.body.data.terminatedAt).toEqual(expect.any(String));

    // 저장 결과: 실결제액 전액 확정 환불, 이용 종료, 고정석 해제
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: res.body.data.refundId as string },
    });
    expect(refund.amount).toBe(issued.amount);
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
  });

  it('이용 종료와 환불 금액 동의 없이 신청하면 동의가 필요하다는 오류로 거절되고 이용권·좌석·환불 기록에 변화가 없다 (QS-1-1a)', async () => {
    const issued = await ctx.issuePeriodTicket({ fixedSeat: true });

    const res = await requestRefund({ ticketId: issued.ticketId }).expect(400);

    expect(res.body.error.code).toBe('REFUND_TERMINATION_CONSENT_REQUIRED');
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
      include: { seatAssignments: true },
    });
    expect(ticket.status).toBe(TicketStatus.UNUSED);
    expect(ticket.seatAssignments.map((row) => row.status)).toEqual([
      SeatAssignmentStatus.ACTIVE,
    ]);
    await expect(
      ctx.prisma.refund.count({ where: { orderItemId: issued.orderItemId } }),
    ).resolves.toBe(0);
  });

  it('다른 고객의 이용권을 환불 신청하면 찾을 수 없는 이용권으로 거절된다 (QS-1-2)', async () => {
    const issued = await ctx.issuePeriodTicket({ buyer: ctx.otherCustomer });

    const res = await requestRefund({
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
    }).expect(404);

    expect(res.body.error.code).toBe('TICKET_NOT_FOUND');
  });

  it('이용권 주문의 결제가 성공 상태가 아니면 PAYMENT_NOT_COMPLETED로 거절된다 (QS-1-3)', async () => {
    const issued = await ctx.issuePeriodTicket();
    await ctx.prisma.payment.update({
      where: { id: issued.paymentId },
      data: { status: PaymentStatus.CANCELLED },
    });

    const res = await requestRefund({
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
    }).expect(409);

    expect(res.body.error.code).toBe('PAYMENT_NOT_COMPLETED');
  });

  it('환불이 확정되고 지급까지 완료된 이용권이면 ALREADY_REFUNDED로 거절된다 (QS-1-4)', async () => {
    const issued = await ctx.issuePeriodTicket();
    const now = new Date();
    await ctx.prisma.refund.create({
      data: {
        paymentId: issued.paymentId,
        orderItemId: issued.orderItemId,
        targetKind: RefundTargetKind.ORDER_ITEM,
        source: RefundSource.CUSTOMER,
        decisionStatus: RefundDecisionStatus.ACCEPTED,
        policyVersion: 'v0.4',
        amount: issued.amount,
        paidAmount: issued.amount,
        payoutStatus: RefundPayoutStatus.PAID,
        requestedAt: now,
        acceptedAt: now,
        terminatedAt: now,
        requestedById: ctx.customer.id,
        terminationConsentedAt: now,
        paidAt: now,
      },
    });

    const res = await requestRefund({
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
    }).expect(409);

    expect(res.body.error.code).toBe('ALREADY_REFUNDED');
  });

  it('같은 이용권에 확정됐지만 지급이 끝나지 않은 환불이 있으면 REFUND_IN_PROGRESS로 거절된다 (QS-1-5)', async () => {
    const issued = await ctx.issuePeriodTicket();
    await requestRefund({
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
    }).expect(202);

    const res = await requestRefund({
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
    }).expect(409);

    expect(res.body.error.code).toBe('REFUND_IN_PROGRESS');
  });

  it('사용 이력이 있는 이용권이면 USED_TICKET으로 거절되고 매장 환불 안내와 함께 환불 기록이 남지 않는다 (QS-1-6)', async () => {
    const issued = await ctx.issuePeriodTicket();
    await ctx.prisma.ticket.update({
      where: { id: issued.ticketId },
      data: {
        status: TicketStatus.ACTIVE,
        activatedAt: new Date(Date.now() - 86_400_000),
      },
    });

    const res = await requestRefund({
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
    }).expect(409);

    expect(res.body.error).toMatchObject({
      code: 'USED_TICKET',
      details: { action: 'CONTACT_SHOP' },
    });
    await expect(
      ctx.prisma.refund.count({ where: { orderItemId: issued.orderItemId } }),
    ).resolves.toBe(0);
  });

  it('지금 이용 중인 이용권이면 USED_TICKET으로 거절된다 (QS-1-7)', async () => {
    const issued = await ctx.issuePeriodTicket();
    const seatId = await ctx.createSeat(SeatType.FREE);
    await ctx.prisma.usageSession.create({
      data: {
        ticketId: issued.ticketId,
        shopId: ctx.shop.id,
        seatId,
        userId: ctx.customer.id,
        startedAt: new Date(Date.now() - 10 * 60_000),
        plannedEndAt: new Date(Date.now() + 60 * 60_000),
        status: UsageSessionStatus.ACTIVE,
      },
    });

    const res = await requestRefund({
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
    }).expect(409);

    expect(res.body.error.code).toBe('USED_TICKET');
  });

  it('이용 기한이 지난 미사용 이용권이면 EXPIRED_TICKET으로 거절되고 매장 환불 안내를 받는다 (QS-1-8)', async () => {
    const issued = await ctx.issuePeriodTicket();
    await ctx.prisma.ticket.update({
      where: { id: issued.ticketId },
      data: { activationDeadline: new Date(Date.now() - 60_000) },
    });

    const res = await requestRefund({
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
    }).expect(409);

    expect(res.body.error).toMatchObject({
      code: 'EXPIRED_TICKET',
      details: { action: 'CONTACT_SHOP' },
    });
  });

  it('확정된 미지급 환불과 사용 이력이 함께 있으면 USED_TICKET이 아니라 REFUND_IN_PROGRESS로 거절된다 (QS-1-9)', async () => {
    const issued = await ctx.issuePeriodTicket();
    await requestRefund({
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
    }).expect(202);
    await ctx.prisma.ticket.update({
      where: { id: issued.ticketId },
      data: { activatedAt: new Date(Date.now() - 86_400_000) },
    });

    const res = await requestRefund({
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
    }).expect(409);

    expect(res.body.error.code).toBe('REFUND_IN_PROGRESS');
  });
});
