// src/refund/refund-store.integration.spec.ts
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PaymentStatus,
  PaymentType,
  RefundSource,
  TicketStatus,
  TicketType,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from 'src/app.module';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import { PrismaService } from 'src/prisma/prisma.service';
import { RefundStoreService } from './refund-store.service';
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

  /**
   * 결제를 마치고 사용 이력이 있는(활성화된) 정기권을 만든다
   * @param orderShopId 주문 매장(기본: 주 매장)
   * @returns 이용권과 주문 항목·결제 ID
   */
  async function createUsedPeriodTicket(orderShopId = shopId): Promise<{
    ticketId: string;
    orderItemId: string;
    paymentId: string;
  }> {
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
        status: TicketStatus.ACTIVE,
        orderItemId: orderItem.id,
        purchasedDurationDays: 30,
        activatedAt: new Date(Date.now() - 86_400_000),
        activationDeadline: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    return {
      ticketId: ticket.id,
      orderItemId: orderItem.id,
      paymentId: payment.id,
    };
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
});
