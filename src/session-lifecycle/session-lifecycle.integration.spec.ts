// src/session-lifecycle/session-lifecycle.integration.spec.ts
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PaymentStatus,
  PaymentType,
  TicketStatus,
  TicketType,
  UsageSessionStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { SessionLifecycleService } from './session-lifecycle.service';

/**
 * 세션 종료의 잠금 순서를 실제 PostgreSQL에서 확인한다 (API 계약 §6 공유 잠금 순서)
 * - 환불은 Ticket → UsageSession 순서로 잠근다. 일반 퇴실도 같은 순서여야 교착이 생기지 않는다
 */
describe('SessionLifecycleService 잠금 순서 (실제 DB)', () => {
  let prisma: PrismaService;
  let service: SessionLifecycleService;
  let userId: string;
  let shopId: string;
  let productId: string;
  const orderIds: string[] = [];

  /**
   * 일부를 쓴 시간권으로 지금 이용 중인 세션을 만든다
   * @returns 이용권·세션 ID
   */
  async function createActiveSession(): Promise<{
    ticketId: string;
    sessionId: string;
  }> {
    const order = await prisma.order.create({
      data: {
        shopId,
        userId,
        originalAmount: 10000,
        discountAmount: 0,
        totalAmount: 10000,
      },
    });
    orderIds.push(order.id);
    const orderItem = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId,
        ticketType: TicketType.TIME,
        originalAmount: 10000,
        discountAmount: 0,
        amount: 10000,
        purchasedMinutes: 600,
        usableDays: 30,
      },
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        type: PaymentType.CARD,
        amount: 10000,
        status: PaymentStatus.SUCCESS,
      },
    });
    const ticket = await prisma.ticket.create({
      data: {
        userId,
        type: TicketType.TIME,
        status: TicketStatus.ACTIVE,
        orderItemId: orderItem.id,
        purchasedMinutes: 600,
        remainingMinutes: 500,
        activatedAt: new Date(Date.now() - 86_400_000),
        minuteExpireDeadline: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    const seat = await prisma.seat.create({
      data: { shopId, number: orderIds.length },
    });
    const startedAt = new Date(Date.now() - 30 * 60_000);
    const session = await prisma.usageSession.create({
      data: {
        ticketId: ticket.id,
        seatId: seat.id,
        shopId,
        userId,
        startedAt,
        plannedEndAt: new Date(startedAt.getTime() + 4 * 60 * 60_000),
      },
    });
    return { ticketId: ticket.id, sessionId: session.id };
  }

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();
    prisma = module.get(PrismaService);
    // 소진되지 않는 시나리오라 좌석 배정 해제는 호출되지 않는다
    service = new SessionLifecycleService({
      releaseByTicket: jest.fn(),
    } as unknown as SeatAssignmentService);

    const suffix = randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: {
        email: `session-lock-${suffix}@test.com`,
        role: UserRole.USER,
        password: 'hashed',
      },
    });
    userId = user.id;
    const shop = await prisma.shop.create({
      data: { name: `세션잠금검증매장-${suffix}` },
    });
    shopId = shop.id;
    const product = await prisma.product.create({
      data: {
        name: `세션잠금검증상품-${suffix}`,
        ticketType: TicketType.TIME,
        amount: 10000,
        shopId,
        usableDays: 30,
        purchasedMinutes: 600,
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    const byOrder = { orderId: { in: orderIds } };
    await prisma.usageSession.deleteMany({ where: { userId } });
    await prisma.ticket.deleteMany({ where: { userId } });
    await prisma.payment.deleteMany({ where: byOrder });
    await prisma.orderItem.deleteMany({ where: byOrder });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.seat.deleteMany({ where: { shopId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('환불이 이용권을 먼저 잠근 동안 일반 퇴실이 같은 세션을 종료해도 교착 없이 둘 다 끝난다', async () => {
    const { ticketId, sessionId } = await createActiveSession();
    let releaseRefund!: () => void;
    const refundHolding = new Promise<void>((resolve) => {
      releaseRefund = resolve;
    });
    let ticketLocked!: () => void;
    const ticketLockedSignal = new Promise<void>((resolve) => {
      ticketLocked = resolve;
    });

    // 환불: Ticket을 잠그고 잠시 기다린 뒤 UsageSession을 잠근다(공유 잠금 순서)
    const refund = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM tickets WHERE id = ${ticketId} FOR UPDATE`;
        ticketLocked();
        await refundHolding;
        await tx.$executeRaw`SELECT 1 FROM usage_sessions WHERE id = ${sessionId} FOR UPDATE`;
      },
      { timeout: 10_000 },
    );
    await ticketLockedSignal;
    // 일반 퇴실: 환불이 Ticket을 잡은 동안 시작한다
    const checkout = prisma.$transaction(
      (tx) => service.endSession(sessionId, new Date(), tx),
      { timeout: 10_000 },
    );
    // 퇴실이 먼저 잠금을 시도하도록 기다린 뒤 환불이 세션 잠금으로 진행한다
    await new Promise((resolve) => setTimeout(resolve, 300));
    releaseRefund();

    const results = await Promise.allSettled([refund, checkout]);

    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    const session = await prisma.usageSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.status).toBe(UsageSessionStatus.ENDED);
  });
});
