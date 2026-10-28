// src/refund/refund-acceptance.integration.spec.ts
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PaymentCancelStatus,
  PaymentStatus,
  PaymentType,
  RefundDecisionStatus,
  RefundPayoutStatus,
  RefundSource,
  TicketStatus,
  TicketType,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from 'src/app.module';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import { PrismaService } from 'src/prisma/prisma.service';
import { RefundAcceptanceService } from './refund-acceptance.service';

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

  /**
   * 결제를 마친 미사용 정기권을 만든다
   * @returns 이용권과 주문 항목·결제 ID
   */
  async function createUnusedPeriodTicket(): Promise<{
    ticketId: string;
    orderItemId: string;
    paymentId: string;
  }> {
    const order = await prisma.order.create({
      data: {
        shopId,
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
        ticketType: TicketType.PERIOD,
        originalAmount: paidAmount,
        discountAmount: 0,
        amount: paidAmount,
        purchasedDurationDays: 30,
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
    await prisma.paymentCancel.deleteMany({ where: { payment: byOrder } });
    await prisma.refund.deleteMany({ where: { payment: byOrder } });
    await prisma.seatAssignment.deleteMany({
      where: { seat: { shopId } },
    });
    await prisma.ticketPause.deleteMany({
      where: { ticket: { userId: customerId } },
    });
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
});
