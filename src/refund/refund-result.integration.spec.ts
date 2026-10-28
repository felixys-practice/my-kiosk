// src/refund/refund-result.integration.spec.ts
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
  RefundTargetKind,
  TicketStatus,
  TicketType,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from 'src/app.module';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import { PrismaService } from 'src/prisma/prisma.service';
import { RefundResultService } from './refund-result.service';

/**
 * 환불금 지급 결과 공통 처리를 실제 PostgreSQL에서 확인한다 (US4, tasks T068~T071)
 * - 확정된 환불(ACCEPTED·PENDING)과 최초 PG 취소 요청(REQUESTED)을 DB에 직접 만들고 결과를 반영한다
 */
describe('환불금 지급 결과 반영 (실제 DB)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: RefundResultService;
  let customerId: string;
  let shopId: string;
  let productId: string;
  const orderIds: string[] = [];

  /** 확정된 환불 금액(원) */
  const refundAmount = 10000;

  /**
   * 이용 종료가 확정되고 PG 취소 결과를 기다리는 환불을 만든다
   * @returns 환불·PG 취소 요청과 원래 주문
   */
  async function createPendingRefund(): Promise<{
    refundId: string;
    paymentCancelId: string;
    orderId: string;
  }> {
    const now = new Date();
    const order = await prisma.order.create({
      data: {
        shopId,
        userId: customerId,
        originalAmount: refundAmount,
        discountAmount: 0,
        totalAmount: refundAmount,
      },
    });
    orderIds.push(order.id);
    const orderItem = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId,
        ticketType: TicketType.PERIOD,
        originalAmount: refundAmount,
        discountAmount: 0,
        amount: refundAmount,
        purchasedDurationDays: 30,
        usableDays: 30,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        type: PaymentType.CARD,
        amount: refundAmount,
        status: PaymentStatus.SUCCESS,
      },
    });
    await prisma.ticket.create({
      data: {
        userId: customerId,
        type: TicketType.PERIOD,
        status: TicketStatus.REVOKED,
        revokedAt: now,
        orderItemId: orderItem.id,
        purchasedDurationDays: 30,
      },
    });
    const refund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        orderItemId: orderItem.id,
        targetKind: RefundTargetKind.ORDER_ITEM,
        source: RefundSource.CUSTOMER,
        decisionStatus: RefundDecisionStatus.ACCEPTED,
        policyVersion: 'v0.4',
        amount: refundAmount,
        payoutStatus: RefundPayoutStatus.PENDING,
        requestedAt: now,
        acceptedAt: now,
        terminatedAt: now,
        requestedById: customerId,
        terminationConsentedAt: now,
        paymentCancels: {
          create: {
            paymentId: payment.id,
            orderItemId: orderItem.id,
            attemptNumber: 1,
            amount: refundAmount,
            status: PaymentCancelStatus.REQUESTED,
            requestedAt: now,
          },
        },
      },
      include: { paymentCancels: true },
    });
    return {
      refundId: refund.id,
      paymentCancelId: refund.paymentCancels[0].id,
      orderId: order.id,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REFUND_PG_GATEWAY)
      .useValue({ sendCancel: jest.fn(), inquireCancel: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(RefundResultService);

    const suffix = randomUUID().slice(0, 8);
    const customer = await prisma.user.create({
      data: {
        email: `refund-result-${suffix}@test.com`,
        role: UserRole.USER,
        password: 'hashed',
      },
    });
    customerId = customer.id;
    const shop = await prisma.shop.create({
      data: { name: `환불결과검증매장-${suffix}` },
    });
    shopId = shop.id;
    const product = await prisma.product.create({
      data: {
        name: `환불결과검증상품-${suffix}`,
        ticketType: TicketType.PERIOD,
        amount: refundAmount,
        shopId,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    const byOrder = { orderId: { in: orderIds } };
    const byRefund = { refund: { payment: byOrder } };
    await prisma.refundNotification.deleteMany({ where: byRefund });
    await prisma.ledger.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.paymentCancel.deleteMany({ where: { payment: byOrder } });
    await prisma.refund.deleteMany({ where: { payment: byOrder } });
    await prisma.ticket.deleteMany({ where: { userId: customerId } });
    await prisma.payment.deleteMany({ where: byOrder });
    await prisma.orderItem.deleteMany({ where: byOrder });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await prisma.user.deleteMany({ where: { id: customerId } });
    await app.close();
  });

  it('PG 성공 실제액이 확정된 환불 금액과 같으면 환불이 지급 완료(PAID)가 된다', async () => {
    const pending = await createPendingRefund();

    await service.applyPgResult({
      paymentCancelId: pending.paymentCancelId,
      outcome: {
        kind: 'SUCCEEDED',
        pgTransactionId: `pg-cancel-${randomUUID()}`,
        actualAmount: refundAmount,
      },
    });

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
    });
    expect({
      payoutStatus: refund.payoutStatus,
      paidAmount: refund.paidAmount,
      paidAt: refund.paidAt instanceof Date,
    }).toEqual({
      payoutStatus: RefundPayoutStatus.PAID,
      paidAmount: refundAmount,
      paidAt: true,
    });
  });
});
