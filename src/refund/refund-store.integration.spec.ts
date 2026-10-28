// src/refund/refund-store.integration.spec.ts
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PaymentStatus,
  PaymentType,
  RefundPayoutStatus,
  RefundSource,
  TicketStatus,
  TicketType,
  UsageSessionStatus,
  UserRole,
} from '@prisma/client';
import { DomainConflictError } from 'src/common/errors';
import { randomUUID } from 'crypto';
import { AppModule } from 'src/app.module';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import { PrismaService } from 'src/prisma/prisma.service';
import { RefundStoreService } from './refund-store.service';
import { SessionLifecycleService } from 'src/session-lifecycle/session-lifecycle.service';
import { SessionEndJobQueue } from 'src/session-lifecycle/session-end-job.queue';
import { UsageSessionService } from 'src/usage-session/usage-session.service';
import { UsageSessionRepository } from 'src/usage-session/usage-session.repository';
import { ShopNotFoundError, TicketNotFoundError } from './errors';

/**
 * 매장 환불 확정의 저장 결과를 실제 PostgreSQL에서 확인한다 (US2, tasks T051~T056)
 * - 앱 모듈 전체를 띄우고 환불 PG 포트만 응답을 정해 둔 대역으로 바꾼다
 * - 테스트마다 새 이용권을 만들고 afterAll에서 자기 데이터만 지운다
 */
describe('매장 환불 확정 저장 (실제 DB)', () => {
  const pgGateway = {
    sendCancel: jest.fn(),
    inquireCancel: jest.fn(),
  };
  let app: INestApplication;
  let prisma: PrismaService;
  let service: RefundStoreService;
  let customerId: string;
  let ownerId: string;
  let strangerOwnerId: string;
  let shopId: string;
  let otherShopId: string;
  let productId: string;
  const orderIds: string[] = [];

  /** 결제 금액(원) */
  const paidAmount = 10000;

  /** 발급한 이용권과 주문 항목·결제 ID */
  type IssuedTicket = {
    ticketId: string;
    orderItemId: string;
    paymentId: string;
  };

  /**
   * 결제를 마친 주문 항목을 만든다
   * @param ticketType 이용권 타입
   * @param orderShopId 주문 매장
   * @returns 주문 항목·결제 ID
   */
  async function createPaidOrderItem(
    ticketType: TicketType,
    orderShopId: string,
  ): Promise<{ orderItemId: string; paymentId: string }> {
    const order = await prisma.order.create({
      data: {
        shopId: orderShopId,
        userId: customerId,
        originalAmount: paidAmount,
        discountAmount: 0,
        totalAmount: paidAmount,
      },
    });
    orderIds.push(order.id);
    const orderItem = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId,
        ticketType,
        originalAmount: paidAmount,
        discountAmount: 0,
        amount: paidAmount,
        purchasedDurationDays: ticketType === TicketType.PERIOD ? 30 : null,
        purchasedMinutes: ticketType === TicketType.TIME ? 600 : null,
        usableDays: 30,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        type: PaymentType.CARD,
        amount: paidAmount,
        status: PaymentStatus.SUCCESS,
      },
    });
    return { orderItemId: orderItem.id, paymentId: payment.id };
  }

  /**
   * 결제를 마치고 사용 이력이 있는(활성화된) 정기권을 만든다
   * @param orderShopId 주문 매장(기본: 주 매장)
   * @returns 이용권과 주문 항목·결제 ID
   */
  async function createUsedPeriodTicket(
    orderShopId = shopId,
  ): Promise<IssuedTicket> {
    const paid = await createPaidOrderItem(TicketType.PERIOD, orderShopId);
    const ticket = await prisma.ticket.create({
      data: {
        userId: customerId,
        type: TicketType.PERIOD,
        status: TicketStatus.ACTIVE,
        orderItemId: paid.orderItemId,
        purchasedDurationDays: 30,
        activatedAt: new Date(Date.now() - 86_400_000),
        activationDeadline: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    return { ticketId: ticket.id, ...paid };
  }

  /**
   * 결제를 마치고 일부를 쓴 시간권(구매 600분, 남은 500분)을 만든다
   * @returns 이용권과 주문 항목·결제 ID
   */
  async function createUsedTimeTicket(): Promise<IssuedTicket> {
    const paid = await createPaidOrderItem(TicketType.TIME, shopId);
    const ticket = await prisma.ticket.create({
      data: {
        userId: customerId,
        type: TicketType.TIME,
        status: TicketStatus.ACTIVE,
        orderItemId: paid.orderItemId,
        purchasedMinutes: 600,
        remainingMinutes: 500,
        activatedAt: new Date(Date.now() - 86_400_000),
        minuteExpireDeadline: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    return { ticketId: ticket.id, ...paid };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REFUND_PG_GATEWAY)
      .useValue(pgGateway)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(RefundStoreService);

    const suffix = randomUUID().slice(0, 8);
    const customer = await prisma.user.create({
      data: {
        email: `refund-store-customer-${suffix}@test.com`,
        role: UserRole.USER,
        password: 'hashed',
      },
    });
    customerId = customer.id;
    const owner = await prisma.user.create({
      data: {
        email: `refund-store-owner-${suffix}@test.com`,
        role: UserRole.OWNER,
        password: 'hashed',
      },
    });
    ownerId = owner.id;
    // 다른 매장을 가진 점주(이 매장의 점주가 아님)
    const strangerOwner = await prisma.user.create({
      data: {
        email: `refund-store-stranger-${suffix}@test.com`,
        role: UserRole.OWNER,
        password: 'hashed',
      },
    });
    strangerOwnerId = strangerOwner.id;
    const shop = await prisma.shop.create({
      data: { name: `매장환불검증매장-${suffix}` },
    });
    shopId = shop.id;
    const otherShop = await prisma.shop.create({
      data: { name: `매장환불검증다른매장-${suffix}` },
    });
    otherShopId = otherShop.id;
    await prisma.shopOwner.create({ data: { shopId, userId: ownerId } });
    const product = await prisma.product.create({
      data: {
        name: `매장환불검증상품-${suffix}`,
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
      where: { requesterId: ownerId },
    });
    await prisma.ledger.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.paymentCancel.deleteMany({ where: { payment: byOrder } });
    await prisma.refund.deleteMany({ where: { payment: byOrder } });
    await prisma.seatAssignment.deleteMany({ where: { seat: { shopId } } });
    await prisma.ticketPause.deleteMany({
      where: { ticket: { userId: customerId } },
    });
    await prisma.usageSession.deleteMany({
      where: { ticket: { userId: customerId } },
    });
    await prisma.ticket.deleteMany({ where: { userId: customerId } });
    await prisma.payment.deleteMany({ where: byOrder });
    await prisma.orderItem.deleteMany({ where: byOrder });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.seat.deleteMany({ where: { shopId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.shopOwner.deleteMany({ where: { shopId } });
    await prisma.shop.deleteMany({
      where: { id: { in: [shopId, otherShopId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [customerId, ownerId, strangerOwnerId] } },
    });
    await app.close();
  });

  beforeEach(() => {
    pgGateway.sendCancel.mockReset().mockResolvedValue({ result: 'ACCEPTED' });
  });

  it('매장 환불 확정 시 점주·확정 시각·사유·금액·종료 동의가 저장되고 이용권이 종료된다', async () => {
    const issued = await createUsedPeriodTicket();

    const { body } = await service.acceptStoreRefund(
      { userId: ownerId, role: UserRole.OWNER },
      shopId,
      {
        ticketId: issued.ticketId,
        amount: 7000,
        reason: '서비스 불만 보상',
        consentToTerminateTicket: true,
      },
    );

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: body.refundId },
    });
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect({
      source: refund.source,
      requestedById: refund.requestedById,
      amount: refund.amount,
      reason: refund.reason,
      acceptedAt: refund.acceptedAt instanceof Date,
      terminationConsentedAt: refund.terminationConsentedAt instanceof Date,
      ticketStatus: ticket.status,
    }).toEqual({
      source: RefundSource.STORE,
      requestedById: ownerId,
      amount: 7000,
      reason: '서비스 불만 보상',
      acceptedAt: true,
      terminationConsentedAt: true,
      ticketStatus: TicketStatus.REVOKED,
    });
  });

  it('다른 매장 이용권을 자기 매장 환불로 요청하면 TICKET_NOT_FOUND로 거절되고 아무것도 저장하지 않는다', async () => {
    const issued = await createUsedPeriodTicket(otherShopId);

    await expect(
      service.acceptStoreRefund(
        { userId: ownerId, role: UserRole.OWNER },
        shopId,
        {
          ticketId: issued.ticketId,
          amount: 7000,
          reason: '보상',
          consentToTerminateTicket: true,
        },
      ),
    ).rejects.toBeInstanceOf(TicketNotFoundError);
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
      include: { orderItem: { include: { refunds: true } } },
    });
    expect({
      status: ticket.status,
      refunds: ticket.orderItem.refunds.length,
    }).toEqual({ status: TicketStatus.ACTIVE, refunds: 0 });
  });

  it('요청 매장의 현재 점주가 아닌 OWNER는 SHOP_NOT_FOUND로 거절되고 아무것도 저장하지 않는다', async () => {
    const issued = await createUsedPeriodTicket();

    await expect(
      service.acceptStoreRefund(
        { userId: strangerOwnerId, role: UserRole.OWNER },
        shopId,
        {
          ticketId: issued.ticketId,
          amount: 7000,
          reason: '보상',
          consentToTerminateTicket: true,
        },
      ),
    ).rejects.toBeInstanceOf(ShopNotFoundError);
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect(ticket.status).toBe(TicketStatus.ACTIVE);
  });

  /**
   * 사용 이력이 있는 이용권을 0원·사유로 매장 환불한다
   * @returns 발급 정보와 접수 응답
   */
  async function acceptZeroStoreRefund() {
    const issued = await createUsedPeriodTicket();
    const accepted = await service.acceptStoreRefund(
      { userId: ownerId, role: UserRole.OWNER },
      shopId,
      {
        ticketId: issued.ticketId,
        amount: 0,
        reason: '환불금 없이 이용 종료',
        consentToTerminateTicket: true,
      },
    );
    return { issued, accepted };
  }

  it('0원 매장 환불은 PG 취소 요청 기록을 만들지 않고 PG를 호출하지 않는다', async () => {
    const { accepted } = await acceptZeroStoreRefund();

    const attempts = await prisma.paymentCancel.count({
      where: { refundId: accepted.body.refundId },
    });
    expect({
      attempts,
      pgCalls: pgGateway.sendCancel.mock.calls.length,
    }).toEqual({ attempts: 0, pgCalls: 0 });
  });

  it('0원 매장 환불은 지급 완료(PAID)와 0원 원장 1건을 함께 저장한다', async () => {
    const { accepted } = await acceptZeroStoreRefund();

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: accepted.body.refundId },
      include: { ledgers: true },
    });
    expect({
      payoutStatus: refund.payoutStatus,
      paidAt: refund.paidAt instanceof Date,
      ledgerAmounts: refund.ledgers.map((ledger) => ledger.amount),
    }).toEqual({
      payoutStatus: RefundPayoutStatus.PAID,
      paidAt: true,
      ledgerAmounts: [0],
    });
  });

  it('0원 매장 환불 응답은 200과 지급 완료 상태다', async () => {
    const { accepted } = await acceptZeroStoreRefund();

    expect({
      status: accepted.status,
      payoutStatus: accepted.body.payoutStatus,
      paymentCancelId: accepted.body.paymentCancelId,
    }).toEqual({
      status: 200,
      payoutStatus: RefundPayoutStatus.PAID,
      paymentCancelId: null,
    });
  });

  /** 매장 안 좌석 번호(겹치지 않게 증가) */
  let nextSeatNumber = 1;

  /**
   * 이용권으로 지금 좌석을 이용 중인 세션을 만든다
   * @param ticketId 이용권 ID
   * @param startedAt 입실 시각(기본: 30분 전)
   * @returns 세션 ID
   */
  async function startSession(
    ticketId: string,
    startedAt = new Date(Date.now() - 30 * 60_000),
  ): Promise<string> {
    const seat = await prisma.seat.create({
      data: { shopId, number: nextSeatNumber++ },
    });
    const session = await prisma.usageSession.create({
      data: {
        ticketId,
        seatId: seat.id,
        shopId,
        userId: customerId,
        startedAt,
        plannedEndAt: new Date(startedAt.getTime() + 4 * 60 * 60_000),
      },
    });
    return session.id;
  }

  it('이용 중인 이용권에 퇴실 동의가 없으면 TICKET_IN_USE(409)로 거절되고 이용·이용권은 그대로다', async () => {
    const issued = await createUsedPeriodTicket();
    const sessionId = await startSession(issued.ticketId);

    const rejection = service.acceptStoreRefund(
      { userId: ownerId, role: UserRole.OWNER },
      shopId,
      {
        ticketId: issued.ticketId,
        amount: 7000,
        reason: '보상',
        consentToTerminateTicket: true,
      },
    );

    await expect(rejection).rejects.toBeInstanceOf(DomainConflictError);
    await expect(rejection).rejects.toMatchObject({ code: 'TICKET_IN_USE' });
    const session = await prisma.usageSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect({ session: session.status, ticket: ticket.status }).toEqual({
      session: UsageSessionStatus.ACTIVE,
      ticket: TicketStatus.ACTIVE,
    });
  });

  it('이용 중인 시간권을 퇴실 동의와 함께 매장 환불하면 퇴실 시각까지의 사용 시간만 차감되고 그 세션이 환불에 기록된다', async () => {
    const issued = await createUsedTimeTicket();
    const startedAt = new Date(Date.now() - 30 * 60_000);
    const sessionId = await startSession(issued.ticketId, startedAt);

    const { body } = await service.acceptStoreRefund(
      { userId: ownerId, role: UserRole.OWNER },
      shopId,
      {
        ticketId: issued.ticketId,
        amount: 5000,
        reason: '이용 중 불편 보상',
        consentToTerminateTicket: true,
        consentToEndSession: true,
      },
    );

    const session = await prisma.usageSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: body.refundId },
    });
    // 기존 퇴실 규칙: 입실부터 퇴실까지 분 단위 올림만큼 차감
    const endedAt = session.endedAt ?? new Date(Number.NaN);
    const usedMinutes = Math.ceil(
      (endedAt.getTime() - startedAt.getTime()) / 60_000,
    );
    expect({
      session: session.status,
      remainingMinutes: ticket.remainingMinutes,
      ticket: ticket.status,
      endedSessionId: refund.endedSessionId,
      exitConsentedAt: refund.exitConsentedAt instanceof Date,
    }).toEqual({
      session: UsageSessionStatus.ENDED,
      remainingMinutes: 500 - usedMinutes,
      ticket: TicketStatus.REVOKED,
      endedSessionId: sessionId,
      exitConsentedAt: true,
    });
  });

  it('이용 중에 퇴실 동의가 있어도 금액이 실결제액을 넘으면 거절되고 세션은 퇴실되지 않은 채 남는다', async () => {
    const issued = await createUsedTimeTicket();
    const sessionId = await startSession(issued.ticketId);

    const rejection = service.acceptStoreRefund(
      { userId: ownerId, role: UserRole.OWNER },
      shopId,
      {
        ticketId: issued.ticketId,
        amount: paidAmount + 1,
        reason: '보상',
        consentToTerminateTicket: true,
        consentToEndSession: true,
      },
    );

    await expect(rejection).rejects.toMatchObject({
      code: 'REFUND_AMOUNT_EXCEEDED',
    });
    const session = await prisma.usageSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect({
      session: session.status,
      endedAt: session.endedAt,
      remainingMinutes: ticket.remainingMinutes,
    }).toEqual({
      session: UsageSessionStatus.ACTIVE,
      endedAt: null,
      remainingMinutes: 500,
    });
  });

  it('퇴실 동의를 다시 받는 사이에 이미 퇴실한 세션은 사용 시간을 다시 차감하지 않는다', async () => {
    const issued = await createUsedTimeTicket();
    const sessionId = await startSession(issued.ticketId);
    const owner = { userId: ownerId, role: UserRole.OWNER };
    const request = {
      ticketId: issued.ticketId,
      amount: 5000,
      reason: '보상',
      consentToTerminateTicket: true,
    };
    // 1) 퇴실 동의 없이 요청해 TICKET_IN_USE로 거절된다
    await expect(
      service.acceptStoreRefund(owner, shopId, request),
    ).rejects.toMatchObject({ code: 'TICKET_IN_USE' });
    // 2) 그사이 고객이 기존 퇴실 규칙으로 퇴실한다
    await prisma.$transaction((tx) =>
      app.get(SessionLifecycleService).endSession(sessionId, new Date(), tx),
    );
    const afterExit = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });

    // 3) 퇴실 동의를 담아 다시 요청한다
    const { body } = await service.acceptStoreRefund(owner, shopId, {
      ...request,
      consentToEndSession: true,
    });

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: body.refundId },
    });
    expect({
      remainingMinutes: ticket.remainingMinutes,
      endedSessionId: refund.endedSessionId,
    }).toEqual({
      remainingMinutes: afterExit.remainingMinutes,
      endedSessionId: null,
    });
  });

  it('커밋 뒤 세션 자동 종료 작업 제거가 실패해도 환불은 확정되고 이용권·퇴실은 복구되지 않는다', async () => {
    const issued = await createUsedTimeTicket();
    const sessionId = await startSession(issued.ticketId);
    await prisma.usageSession.update({
      where: { id: sessionId },
      data: { bullmqJobId: `job-${sessionId}` },
    });
    const jobRemoval = jest
      .spyOn(app.get(SessionEndJobQueue), 'remove')
      .mockRejectedValueOnce(new Error('redis unavailable'));

    const accepted = await service.acceptStoreRefund(
      { userId: ownerId, role: UserRole.OWNER },
      shopId,
      {
        ticketId: issued.ticketId,
        amount: 5000,
        reason: '보상',
        consentToTerminateTicket: true,
        consentToEndSession: true,
      },
    );

    const removalCalls = jobRemoval.mock.calls;
    jobRemoval.mockRestore();
    const session = await prisma.usageSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect({
      status: accepted.status,
      removalCalls,
      session: session.status,
      ticket: ticket.status,
    }).toEqual({
      status: 202,
      removalCalls: [[`job-${sessionId}`]],
      session: UsageSessionStatus.ENDED,
      ticket: TicketStatus.REVOKED,
    });
  });

  /**
   * 이용 중 시간권을 퇴실 동의와 함께 매장 환불한 뒤의 세션·이용권 상태를 만든다
   * @returns 세션 ID와 환불 직후의 세션 종료 시각·남은 시간
   */
  async function refundedInUseTimeTicket() {
    const issued = await createUsedTimeTicket();
    const sessionId = await startSession(issued.ticketId);
    await service.acceptStoreRefund(
      { userId: ownerId, role: UserRole.OWNER },
      shopId,
      {
        ticketId: issued.ticketId,
        amount: 5000,
        reason: '보상',
        consentToTerminateTicket: true,
        consentToEndSession: true,
      },
    );
    const session = await prisma.usageSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    return {
      ticketId: issued.ticketId,
      sessionId,
      endedAt: session.endedAt,
      remainingMinutes: ticket.remainingMinutes,
    };
  }

  it('환불 뒤 도착한 자동 종료 작업은 세션 종료 상태(종료 시각)를 덮어쓰지 않는다', async () => {
    const refunded = await refundedInUseTimeTicket();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 지연된 자동 종료 작업(처리기와 같은 호출)
    await app.get(UsageSessionService).endUsageSession(refunded.sessionId);

    const session = await prisma.usageSession.findUniqueOrThrow({
      where: { id: refunded.sessionId },
    });
    expect({ status: session.status, endedAt: session.endedAt }).toEqual({
      status: UsageSessionStatus.ENDED,
      endedAt: refunded.endedAt,
    });
  });

  it('환불 뒤 도착한 자동 종료 작업은 사용 시간을 다시 차감하지 않는다', async () => {
    const refunded = await refundedInUseTimeTicket();

    await app.get(UsageSessionService).endUsageSession(refunded.sessionId);

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: refunded.ticketId },
    });
    expect({
      status: ticket.status,
      remainingMinutes: ticket.remainingMinutes,
    }).toEqual({
      status: TicketStatus.REVOKED,
      remainingMinutes: refunded.remainingMinutes,
    });
  });

  it('입실 후속 실패 처리는 환불로 이미 종료된 세션을 실패 상태로 덮어쓰지 않는다', async () => {
    const refunded = await refundedInUseTimeTicket();

    // 작업 ID 등록 전에 환불이 퇴실을 확정한 뒤, 입실 서비스의 실패 처리가 늦게 실행된 상황
    await app
      .get(UsageSessionRepository)
      .failSession(
        refunded.sessionId,
        UsageSessionStatus.JOB_REGISTER_FAILED,
        '작업 ID 등록 실패',
      );

    const session = await prisma.usageSession.findUniqueOrThrow({
      where: { id: refunded.sessionId },
    });
    expect({
      status: session.status,
      endedAt: session.endedAt,
      failureReason: session.failureReason,
    }).toEqual({
      status: UsageSessionStatus.ENDED,
      endedAt: refunded.endedAt,
      failureReason: null,
    });
  });
});
