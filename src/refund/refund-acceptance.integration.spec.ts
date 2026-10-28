// src/refund/refund-acceptance.integration.spec.ts
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  LedgerStatus,
  PaymentCancelStatus,
  PaymentStatus,
  PaymentType,
  RefundDecisionStatus,
  RefundPayoutStatus,
  RefundSource,
  SeatAssignmentStatus,
  SeatReleaseReason,
  SeatType,
  TicketPauseCloseReason,
  TicketStatus,
  TicketType,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from 'src/app.module';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import { PrismaService } from 'src/prisma/prisma.service';
import { RefundAcceptanceService } from './refund-acceptance.service';
import { RefundRepository } from './refund.repository';
import { UsageSessionRepository } from 'src/usage-session/usage-session.repository';

/**
 * 환불 확정의 저장 결과를 실제 PostgreSQL에서 확인한다 (US1, tasks T032·T034)
 * - 앱 모듈 전체를 띄우고 환불 PG 포트만 응답을 정해 둔 대역으로 바꾼다
 * - 테스트마다 새 이용권을 만들고 afterAll에서 자기 데이터만 지운다
 */
describe('환불 확정 저장 (실제 DB)', () => {
  const pgGateway = {
    sendCancel: jest.fn(),
    inquireCancel: jest.fn(),
  };
  let app: INestApplication;
  let prisma: PrismaService;
  let service: RefundAcceptanceService;
  let customerId: string;
  let shopId: string;
  let productId: string;
  const orderIds: string[] = [];

  /** 결제 금액(원) */
  const paidAmount = 10000;
  /** 매장 안 좌석 번호(겹치지 않게 증가) */
  let nextSeatNumber = 1;

  /**
   * 결제를 마친 미사용 정기권을 만든다
   * @param amount 결제 금액(기본 10000원)
   * @returns 이용권과 주문 항목·결제 ID
   */
  async function createUnusedPeriodTicket(amount = paidAmount): Promise<{
    ticketId: string;
    orderItemId: string;
    paymentId: string;
  }> {
    const order = await prisma.order.create({
      data: {
        shopId,
        userId: customerId,
        originalAmount: amount,
        discountAmount: 0,
        totalAmount: amount,
      },
    });
    orderIds.push(order.id);
    const orderItem = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId,
        ticketType: TicketType.PERIOD,
        originalAmount: amount,
        discountAmount: 0,
        amount: amount,
        purchasedDurationDays: 30,
        usableDays: 30,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        type: PaymentType.CARD,
        amount: amount,
        status: PaymentStatus.SUCCESS,
      },
    });
    const ticket = await prisma.ticket.create({
      data: {
        userId: customerId,
        type: TicketType.PERIOD,
        status: TicketStatus.UNUSED,
        orderItemId: orderItem.id,
        purchasedDurationDays: 30,
        activationDeadline: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    return {
      ticketId: ticket.id,
      orderItemId: orderItem.id,
      paymentId: payment.id,
    };
  }

  /**
   * 고객으로 환불을 확정한다
   * @param ticketId 이용권 ID
   * @returns 접수 응답
   */
  function accept(ticketId: string) {
    return service.acceptCustomerRefund(
      { userId: customerId, role: UserRole.USER },
      { ticketId, consentToTerminateTicket: true },
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REFUND_PG_GATEWAY)
      .useValue(pgGateway)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(RefundAcceptanceService);

    const suffix = randomUUID().slice(0, 8);
    const customer = await prisma.user.create({
      data: {
        email: `refund-accept-${suffix}@test.com`,
        role: UserRole.USER,
        password: 'hashed',
      },
    });
    customerId = customer.id;
    const shop = await prisma.shop.create({
      data: { name: `환불확정검증매장-${suffix}` },
    });
    shopId = shop.id;
    const product = await prisma.product.create({
      data: {
        name: `환불확정검증상품-${suffix}`,
        ticketType: TicketType.PERIOD,
        amount: paidAmount,
        shopId,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    const byOrder = { orderId: { in: orderIds } };
    await prisma.refundIdempotencyRecord.deleteMany({
      where: { requesterId: customerId },
    });
    await prisma.refundNotification.deleteMany({
      where: { refund: { payment: byOrder } },
    });
    await prisma.ledger.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.paymentCancel.deleteMany({ where: { payment: byOrder } });
    await prisma.refund.deleteMany({ where: { payment: byOrder } });
    await prisma.seatAssignment.deleteMany({
      where: { seat: { shopId } },
    });
    await prisma.ticketPause.deleteMany({
      where: { ticket: { userId: customerId } },
    });
    await prisma.usageSession.deleteMany({ where: { userId: customerId } });
    await prisma.ticket.deleteMany({ where: { userId: customerId } });
    await prisma.payment.deleteMany({ where: byOrder });
    await prisma.orderItem.deleteMany({ where: byOrder });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.seat.deleteMany({ where: { shopId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await prisma.user.deleteMany({ where: { id: customerId } });
    await app.close();
  });

  beforeEach(() => {
    pgGateway.sendCancel.mockReset().mockResolvedValue({ result: 'ACCEPTED' });
  });

  it('환불 확정 시 확정된 환불(ACCEPTED)과 그 금액의 최초 PG 취소 요청(REQUESTED)이 저장된다', async () => {
    const issued = await createUnusedPeriodTicket();

    const { body } = await accept(issued.ticketId);

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: body.refundId },
      include: { paymentCancels: true },
    });
    expect(refund).toMatchObject({
      paymentId: issued.paymentId,
      orderItemId: issued.orderItemId,
      source: RefundSource.CUSTOMER,
      decisionStatus: RefundDecisionStatus.ACCEPTED,
      payoutStatus: RefundPayoutStatus.PENDING,
      amount: paidAmount,
    });
    expect(refund.paymentCancels).toEqual([
      expect.objectContaining({
        attemptNumber: 1,
        amount: paidAmount,
        status: PaymentCancelStatus.REQUESTED,
      }),
    ]);
  });

  it('환불 확정 뒤 이용권 상태가 REVOKED로 저장된다', async () => {
    const issued = await createUnusedPeriodTicket();

    await accept(issued.ticketId);

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect(ticket.status).toBe(TicketStatus.REVOKED);
  });

  it('환불 확정 뒤 고정석 배정이 해제된다', async () => {
    const issued = await createUnusedPeriodTicket();
    const seat = await prisma.seat.create({
      data: { number: nextSeatNumber++, shopId, type: SeatType.FIXED },
    });
    await prisma.seatAssignment.create({
      data: {
        seatId: seat.id,
        orderItemId: issued.orderItemId,
        ticketId: issued.ticketId,
        status: SeatAssignmentStatus.ACTIVE,
        assignedAt: new Date(),
      },
    });

    await accept(issued.ticketId);

    const assignment = await prisma.seatAssignment.findFirstOrThrow({
      where: { ticketId: issued.ticketId },
    });
    expect(assignment).toMatchObject({
      status: SeatAssignmentStatus.RELEASED,
      releaseReason: SeatReleaseReason.TICKET_REVOKED,
    });
  });

  it('환불 확정 뒤 진행 중이던 정지 기록이 REFUND_TERMINATED로 닫히고 재개되지 않는다', async () => {
    const issued = await createUnusedPeriodTicket();
    const pause = await prisma.ticketPause.create({
      data: {
        ticketId: issued.ticketId,
        pausedAt: new Date(Date.now() - 60_000),
        pausedBy: customerId,
      },
    });

    await accept(issued.ticketId);

    const closed = await prisma.ticketPause.findUniqueOrThrow({
      where: { id: pause.id },
    });
    expect(closed).toMatchObject({
      closeReason: TicketPauseCloseReason.REFUND_TERMINATED,
      resumedAt: null,
    });
    expect(closed.closedAt).toBeInstanceOf(Date);
  });

  it('환불 확정 뒤 정기권의 기한·만료 시각이 바뀌지 않는다', async () => {
    const issued = await createUnusedPeriodTicket();
    const before = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });

    await accept(issued.ticketId);

    const after = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect({
      activationDeadline: after.activationDeadline,
      expiresAt: after.expiresAt,
    }).toEqual({
      activationDeadline: before.activationDeadline,
      expiresAt: before.expiresAt,
    });
  });

  it('저장 마지막 단계가 실패하면 이용권·좌석·정지·환불·PG 취소 요청이 모두 저장 전 상태로 남는다', async () => {
    const issued = await createUnusedPeriodTicket();
    const seat = await prisma.seat.create({
      data: { number: nextSeatNumber++, shopId, type: SeatType.FIXED },
    });
    await prisma.seatAssignment.create({
      data: {
        seatId: seat.id,
        orderItemId: issued.orderItemId,
        ticketId: issued.ticketId,
        status: SeatAssignmentStatus.ACTIVE,
        assignedAt: new Date(),
      },
    });
    await prisma.ticketPause.create({
      data: {
        ticketId: issued.ticketId,
        pausedAt: new Date(Date.now() - 60_000),
        pausedBy: customerId,
      },
    });
    const repository = app.get(RefundRepository);
    jest
      .spyOn(repository, 'createAcceptedRefund')
      .mockRejectedValueOnce(new Error('환불 저장 실패'));

    await expect(accept(issued.ticketId)).rejects.toThrow('환불 저장 실패');

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
      include: { seatAssignments: true, ticketPauses: true },
    });
    expect({
      ticketStatus: ticket.status,
      seatStatuses: ticket.seatAssignments.map((row) => row.status),
      pauseClosedAt: ticket.ticketPauses.map((pause) => pause.closedAt),
      refunds: await prisma.refund.count({
        where: { orderItemId: issued.orderItemId },
      }),
      attempts: await prisma.paymentCancel.count({
        where: { orderItemId: issued.orderItemId },
      }),
    }).toEqual({
      ticketStatus: TicketStatus.UNUSED,
      seatStatuses: [SeatAssignmentStatus.ACTIVE],
      pauseClosedAt: [null],
      refunds: 0,
      attempts: 0,
    });
    expect(pgGateway.sendCancel).not.toHaveBeenCalled();
  });

  it('같은 이용권의 동시 신청 두 건 중 한 건만 확정되고 다른 한 건은 REFUND_IN_PROGRESS를 받는다', async () => {
    const issued = await createUnusedPeriodTicket();

    const results = await Promise.allSettled([
      accept(issued.ticketId),
      accept(issued.ticketId),
    ]);

    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      code: 'REFUND_IN_PROGRESS',
    });
    expect(
      await prisma.refund.count({ where: { orderItemId: issued.orderItemId } }),
    ).toBe(1);
  });

  it('PG 전송 결과가 NOT_SENT여도 접수는 성공하고 이용권은 REVOKED로 남는다', async () => {
    const issued = await createUnusedPeriodTicket();
    pgGateway.sendCancel.mockResolvedValue({
      result: 'NOT_SENT',
      reason: 'PG 미연동',
    });

    await expect(accept(issued.ticketId)).resolves.toMatchObject({
      status: 202,
    });

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect(ticket.status).toBe(TicketStatus.REVOKED);
  });

  it('실결제액 0원 고객 환불은 PG 취소 요청 없이 이용 종료·지급 완료·0원 원장을 함께 저장하고 PG를 호출하지 않는다', async () => {
    const issued = await createUnusedPeriodTicket(0);

    const { body } = await accept(issued.ticketId);

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: body.refundId },
      include: { paymentCancels: true, ledgers: true },
    });
    expect({
      payoutStatus: refund.payoutStatus,
      amount: refund.amount,
      paidAmount: refund.paidAmount,
      paidAt: refund.paidAt instanceof Date,
      attempts: refund.paymentCancels.length,
      ledgers: refund.ledgers.map((ledger) => ({
        amount: ledger.amount,
        shopId: ledger.shopId,
        status: ledger.status,
        paymentCancelId: ledger.paymentCancelId,
        manualRefundPayoutId: ledger.manualRefundPayoutId,
      })),
    }).toEqual({
      payoutStatus: RefundPayoutStatus.PAID,
      amount: 0,
      paidAmount: 0,
      paidAt: true,
      attempts: 0,
      ledgers: [
        {
          amount: 0,
          shopId,
          status: LedgerStatus.RELEASABLE,
          paymentCancelId: null,
          manualRefundPayoutId: null,
        },
      ],
    });
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect(ticket.status).toBe(TicketStatus.REVOKED);
    expect(pgGateway.sendCancel).not.toHaveBeenCalled();
  });

  it('입실이 먼저 이용권 잠금을 얻으면 뒤이은 고객 환불은 사용 이력을 보고 USED_TICKET으로 거절된다', async () => {
    const issued = await createUnusedPeriodTicket();
    const seat = await prisma.seat.create({
      data: { number: nextSeatNumber++, shopId, type: SeatType.FREE },
    });
    let releaseEntry!: () => void;
    const entryHolding = new Promise<void>((resolve) => {
      releaseEntry = resolve;
    });
    let entryLocked!: () => void;
    const entryLockedSignal = new Promise<void>((resolve) => {
      entryLocked = resolve;
    });

    // 입실: 세션 생성 전 확인 단계에서 잠시 멈춰 환불이 끼어들 틈을 만든다
    const now = new Date();
    const entry = app.get(UsageSessionRepository).createSession(
      issued.ticketId,
      shopId,
      seat.id,
      customerId,
      new Date(now.getTime() + 30 * 86_400_000),
      now,
      {
        activatedAt: now,
        expiresAt: new Date(now.getTime() + 30 * 86_400_000),
      },
      async () => {
        entryLocked();
        await entryHolding;
      },
    );
    await entryLockedSignal;
    // 환불: 입실 트랜잭션이 끝나기 전에 시작한다
    const refund = accept(issued.ticketId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    releaseEntry();

    const [entryResult, refundResult] = await Promise.allSettled([
      entry,
      refund,
    ]);

    expect({
      entry: entryResult.status,
      refund: refundResult.status,
      refundCode:
        refundResult.status === 'rejected'
          ? (refundResult.reason as { code?: string }).code
          : undefined,
    }).toEqual({
      entry: 'fulfilled',
      refund: 'rejected',
      refundCode: 'USED_TICKET',
    });
  });

  it('지급 조치가 필요한 환불로 종료된 이용권도 입실 트랜잭션에서 TICKET_TERMINATED로 거절된다', async () => {
    const issued = await createUnusedPeriodTicket();
    const { body } = await accept(issued.ticketId);
    await prisma.refund.update({
      where: { id: body.refundId },
      data: {
        payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
        actionCode: 'PG_REJECTED',
      },
    });
    const seat = await prisma.seat.create({
      data: { number: nextSeatNumber++, shopId, type: SeatType.FREE },
    });
    const now = new Date();

    // 서비스의 사전 확인을 거치지 않고 입실 트랜잭션의 잠금 아래 재확인만 검증한다
    const entry = app
      .get(UsageSessionRepository)
      .createSession(
        issued.ticketId,
        shopId,
        seat.id,
        customerId,
        new Date(now.getTime() + 86_400_000),
        now,
      );

    await expect(entry).rejects.toMatchObject({ code: 'TICKET_TERMINATED' });
    const sessions = await prisma.usageSession.count({
      where: { ticketId: issued.ticketId },
    });
    expect(sessions).toBe(0);
  });

  it('접수 응답과 같은 키 재응답은 PG 전송 결과(전송 전 실패 → 조치 필요)를 반영한 같은 응답이다', async () => {
    const issued = await createUnusedPeriodTicket();
    pgGateway.sendCancel.mockResolvedValueOnce({
      result: 'NOT_SENT',
      reason: 'PG 연결 설정 누락',
    });
    const command = {
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
      idempotencyKey: `key-${randomUUID()}`,
    };
    const actor = { userId: customerId, role: UserRole.USER };

    const first = await service.acceptCustomerRefund(actor, command);
    const replay = await service.acceptCustomerRefund(actor, command);

    expect({
      status: first.status,
      payoutStatus: first.body.payoutStatus,
      pgCalls: pgGateway.sendCancel.mock.calls.length,
    }).toEqual({
      status: 202,
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      pgCalls: 1,
    });
    // 저장 응답은 JSON으로 다시 읽으므로 키 순서가 아니라 값으로 비교한다
    expect({ status: replay.status, body: replay.body }).toEqual({
      status: first.status,
      body: first.body,
    });
  });

  it('최초 전송은 자동 재전송 횟수에 더해지지 않고 전송 시도 횟수에만 기록된다', async () => {
    const issued = await createUnusedPeriodTicket();
    pgGateway.sendCancel.mockResolvedValueOnce({
      result: 'UNKNOWN',
      reason: '응답 시간 초과',
    });

    const { body } = await accept(issued.ticketId);

    const attempt = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: body.paymentCancelId! },
    });
    expect({
      sendAttemptCount: attempt.sendAttemptCount,
      resendCount: attempt.resendCount,
      manualResendCount: attempt.manualResendCount,
    }).toEqual({ sendAttemptCount: 1, resendCount: 0, manualResendCount: 0 });
  });

  it('PG 전송 중에 같은 키로 다시 요청하면 처리 중으로 거절되고, 완료 뒤 재응답은 전송 결과를 반영한 최초 응답과 같다', async () => {
    const issued = await createUnusedPeriodTicket();
    let releaseSend!: () => void;
    const sendHeld = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let sendStarted!: () => void;
    const sendStartedSignal = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });
    pgGateway.sendCancel.mockImplementationOnce(async () => {
      sendStarted();
      await sendHeld;
      return { result: 'NOT_SENT', reason: 'PG 연결 설정 누락' };
    });
    const command = {
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
      idempotencyKey: `key-${randomUUID()}`,
    };
    const actor = { userId: customerId, role: UserRole.USER };

    const first = service.acceptCustomerRefund(actor, command);
    await sendStartedSignal;
    const duringSend = await service
      .acceptCustomerRefund(actor, command)
      .then(() => 'resolved')
      .catch((error: { code?: string }) => error.code);
    releaseSend();
    const firstResponse = await first;
    const replay = await service.acceptCustomerRefund(actor, command);

    expect({
      duringSend,
      firstPayout: firstResponse.body.payoutStatus,
      replay: { status: replay.status, body: replay.body },
    }).toEqual({
      duringSend: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      firstPayout: RefundPayoutStatus.ACTION_REQUIRED,
      replay: { status: firstResponse.status, body: firstResponse.body },
    });
  });

  it('확정은 커밋됐지만 PG 전송 단계 전에 중단되면, 처리 기한이 지난 뒤 같은 키 요청은 환불을 새로 만들지 않고 저장된 상태로 응답한다', async () => {
    const issued = await createUnusedPeriodTicket();
    pgGateway.sendCancel.mockRejectedValueOnce(new Error('서버 중단'));
    const command = {
      ticketId: issued.ticketId,
      consentToTerminateTicket: true,
      idempotencyKey: `key-${randomUUID()}`,
    };
    const actor = { userId: customerId, role: UserRole.USER };
    await expect(service.acceptCustomerRefund(actor, command)).rejects.toThrow(
      '서버 중단',
    );
    // 중단된 요청의 처리 기한이 지난 상태
    await prisma.refundIdempotencyRecord.updateMany({
      where: { requesterId: customerId, key: command.idempotencyKey },
      data: { claimUntil: new Date(Date.now() - 1_000) },
    });

    const retried = await service.acceptCustomerRefund(actor, command);

    const refunds = await prisma.refund.findMany({
      where: { orderItemId: issued.orderItemId },
    });
    const record = await prisma.refundIdempotencyRecord.findFirstOrThrow({
      where: { requesterId: customerId, key: command.idempotencyKey },
    });
    expect({
      status: retried.status,
      refundId: retried.body.refundId,
      refunds: refunds.length,
      sends: pgGateway.sendCancel.mock.calls.length,
      record: record.status,
    }).toEqual({
      status: 202,
      refundId: refunds[0].id,
      refunds: 1,
      sends: 1,
      record: 'COMPLETED',
    });
  });
});
