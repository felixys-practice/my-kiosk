// src/refund/refund-result.integration.spec.ts
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  LedgerStatus,
  PaymentCancelFailureCode,
  PaymentCancelStatus,
  PaymentStatus,
  PaymentType,
  RefundDecisionStatus,
  RefundNotificationAudience,
  RefundPayoutStatus,
  RefundSource,
  RefundTargetKind,
  TicketStatus,
  TicketType,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from 'src/app.module';
import { DomainConflictError, DomainNotFoundError } from 'src/common/errors';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import { PrismaService } from 'src/prisma/prisma.service';
import { TransactionLoggerService } from 'src/logger/transaction-logger.service';
import {
  PgCallbackTargetMismatchError,
  PgCallbackTargetNotFoundError,
  RefundStorageUnavailableError,
} from './errors';
import { RefundRepository } from './refund.repository';
import { RefundResultService } from './refund-result.service';
import { RefundDispatchService } from './refund-dispatch.service';
import { RefundRecoveryService } from './refund-recovery.service';

/**
 * 환불금 지급 결과 공통 처리를 실제 PostgreSQL에서 확인한다 (US4, tasks T068~T071)
 * - 확정된 환불(ACCEPTED·PENDING)과 최초 PG 취소 요청(REQUESTED)을 DB에 직접 만들고 결과를 반영한다
 */
describe('환불금 지급 결과 반영 (실제 DB)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: RefundResultService;
  /** 환불 PG 포트 대역(전송·조회 응답을 테스트마다 정한다) */
  const pgGateway = { sendCancel: jest.fn(), inquireCancel: jest.fn() };
  let customerId: string;
  let shopId: string;
  let productId: string;
  const orderIds: string[] = [];

  /** 확정된 환불 금액(원) */
  const refundAmount = 10000;

  /**
   * 이용 종료가 확정되고 PG 취소 결과를 기다리는 환불을 만든다
   * @param source 환불 경로(기본 고객 환불). 신청자는 경로와 무관하게 이 테스트의 사용자로 둔다
   * @returns 환불·PG 취소 요청과 원래 주문
   */
  async function createPendingRefund(
    source: RefundSource = RefundSource.CUSTOMER,
  ): Promise<{
    refundId: string;
    paymentCancelId: string;
    orderId: string;
    orderItemId: string;
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
        source,
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
      orderItemId: orderItem.id,
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

  beforeEach(() => {
    // 테스트마다 PG 응답과 호출 기록을 비운다
    pgGateway.sendCancel.mockReset();
    pgGateway.inquireCancel.mockReset();
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

  /**
   * PG 취소 성공 결과를 반영한다
   * @param paymentCancelId PG 취소 요청
   * @param actualAmount PG가 확인한 실제 취소액
   */
  function succeed(paymentCancelId: string, actualAmount: number) {
    return service.applyPgResult({
      paymentCancelId,
      outcome: {
        kind: 'SUCCEEDED',
        pgTransactionId: `pg-cancel-${randomUUID()}`,
        actualAmount,
      },
    });
  }

  it('PG 성공 시 실제액의 음수 원장 1건이 원래 매장·주문·RELEASABLE로 저장된다', async () => {
    const pending = await createPendingRefund();

    await succeed(pending.paymentCancelId, refundAmount);

    const ledgers = await prisma.ledger.findMany({
      where: { refundId: pending.refundId },
    });
    expect(ledgers).toEqual([
      expect.objectContaining({
        shopId,
        orderId: pending.orderId,
        amount: -refundAmount,
        status: LedgerStatus.RELEASABLE,
        paymentCancelId: pending.paymentCancelId,
        manualRefundPayoutId: null,
      }),
    ]);
  });

  it('PG 실제액이 확정 금액보다 적으면 조치 필요·검토 필요로 기록되고 확정 금액은 그대로다', async () => {
    const pending = await createPendingRefund();

    await succeed(pending.paymentCancelId, refundAmount - 3000);

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
    });
    expect({
      payoutStatus: refund.payoutStatus,
      reviewRequired: refund.reviewRequired,
      actionCode: refund.actionCode,
      amount: refund.amount,
      paidAmount: refund.paidAmount,
      paidAt: refund.paidAt,
    }).toEqual({
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      reviewRequired: true,
      actionCode: 'AMOUNT_MISMATCH',
      amount: refundAmount,
      paidAmount: refundAmount - 3000,
      paidAt: null,
    });
  });

  it('PG 실제액이 확정 금액보다 많으면 조치 필요·검토 필요로 기록되고 확정 금액은 그대로다', async () => {
    const pending = await createPendingRefund();

    await succeed(pending.paymentCancelId, refundAmount + 2000);

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
    });
    expect({
      payoutStatus: refund.payoutStatus,
      reviewRequired: refund.reviewRequired,
      amount: refund.amount,
      paidAmount: refund.paidAmount,
    }).toEqual({
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      reviewRequired: true,
      amount: refundAmount,
      paidAmount: refundAmount + 2000,
    });
  });

  it('PG 거절이면 그 PG 취소 요청은 실패(PG_REJECTED), 환불은 조치 필요가 되고 원장은 생기지 않는다', async () => {
    const pending = await createPendingRefund();

    await service.applyPgResult({
      paymentCancelId: pending.paymentCancelId,
      outcome: { kind: 'FAILED', reason: '취소 가능 기간 경과' },
    });

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { paymentCancels: true, ledgers: true },
    });
    expect({
      payoutStatus: refund.payoutStatus,
      actionCode: refund.actionCode,
      attempt: {
        status: refund.paymentCancels[0].status,
        failureCode: refund.paymentCancels[0].failureCode,
        failureReason: refund.paymentCancels[0].failureReason,
        failedAt: refund.paymentCancels[0].failedAt instanceof Date,
      },
      ledgers: refund.ledgers.length,
    }).toEqual({
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      actionCode: 'PG_REJECTED',
      attempt: {
        status: PaymentCancelStatus.FAILED,
        failureCode: PaymentCancelFailureCode.PG_REJECTED,
        failureReason: '취소 가능 기간 경과',
        failedAt: true,
      },
      ledgers: 0,
    });
  });

  it('같은 성공 결과를 두 번 반영해도 원장과 지급 합계는 한 번만 늘어난다', async () => {
    const pending = await createPendingRefund();
    const outcome = {
      kind: 'SUCCEEDED' as const,
      pgTransactionId: `pg-cancel-${randomUUID()}`,
      actualAmount: refundAmount,
    };
    await service.applyPgResult({
      paymentCancelId: pending.paymentCancelId,
      outcome,
    });

    await service.applyPgResult({
      paymentCancelId: pending.paymentCancelId,
      outcome,
    });

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { ledgers: true },
    });
    expect({
      paidAmount: refund.paidAmount,
      ledgers: refund.ledgers.length,
    }).toEqual({ paidAmount: refundAmount, ledgers: 1 });
  });

  it('이미 실패로 확정된 PG 취소 요청에 성공 통보가 오면 검토 필요·운영자 알림을 기록하고 지급액을 더하지 않는다', async () => {
    const pending = await createPendingRefund();
    await service.applyPgResult({
      paymentCancelId: pending.paymentCancelId,
      outcome: { kind: 'FAILED', reason: '취소 가능 기간 경과' },
    });

    await succeed(pending.paymentCancelId, refundAmount);

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { paymentCancels: true, ledgers: true, notifications: true },
    });
    expect({
      attemptStatus: refund.paymentCancels[0].status,
      paidAmount: refund.paidAmount,
      ledgers: refund.ledgers.length,
      reviewRequired: refund.reviewRequired,
      actionCode: refund.actionCode,
      // 거절 반영 때의 알림(U316)과 구분해 운영자 모순 알림만 확인한다
      conflictNotifications: refund.notifications
        .filter(
          (n) =>
            n.audience === RefundNotificationAudience.OPERATOR &&
            n.kind === 'PG_RESULT_CONFLICT',
        )
        .map((n) => ({ kind: n.kind, paymentCancelId: n.paymentCancelId })),
    }).toEqual({
      attemptStatus: PaymentCancelStatus.FAILED,
      paidAmount: 0,
      ledgers: 0,
      reviewRequired: true,
      actionCode: 'PG_RESULT_CONFLICT',
      conflictNotifications: [
        {
          kind: 'PG_RESULT_CONFLICT',
          paymentCancelId: pending.paymentCancelId,
        },
      ],
    });
  });

  it('담당 토큰이 바뀐 작업의 결과 저장은 지급액을 더하지 않고 저장된 상태를 반환한다', async () => {
    const pending = await createPendingRefund();
    // 앞 작업의 담당 기한이 지나 다른 작업이 담당을 이어받은 상태
    await prisma.paymentCancel.update({
      where: { id: pending.paymentCancelId },
      data: {
        claimToken: 'token-new-owner',
        claimUntil: new Date(Date.now() + 60_000),
      },
    });

    const result = await service.applyPgResult({
      paymentCancelId: pending.paymentCancelId,
      claimToken: 'token-old-owner',
      outcome: {
        kind: 'SUCCEEDED',
        pgTransactionId: `pg-cancel-${randomUUID()}`,
        actualAmount: refundAmount,
      },
    });

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { paymentCancels: true, ledgers: true },
    });
    expect({
      result,
      attemptStatus: refund.paymentCancels[0].status,
      paidAmount: refund.paidAmount,
      ledgers: refund.ledgers.length,
    }).toEqual({
      result: {
        applied: false,
        attemptStatus: PaymentCancelStatus.REQUESTED,
        payoutStatus: RefundPayoutStatus.PENDING,
      },
      attemptStatus: PaymentCancelStatus.REQUESTED,
      paidAmount: 0,
      ledgers: 0,
    });
  });

  it('결과 저장 중 중단되면 지급 완료·원장·시도 성공 어느 것도 저장되지 않는다', async () => {
    const pending = await createPendingRefund();
    // 마지막 단계(환불 지급 상태 갱신)에서 저장이 중단된 상황
    const repository = app.get(RefundRepository);
    const interrupted = jest
      .spyOn(repository, 'updateRefundPayout')
      .mockRejectedValueOnce(new Error('저장 중단'));

    await expect(
      succeed(pending.paymentCancelId, refundAmount),
    ).rejects.toThrow('저장 중단');
    interrupted.mockRestore();

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { paymentCancels: true, ledgers: true },
    });
    expect({
      payoutStatus: refund.payoutStatus,
      paidAmount: refund.paidAmount,
      attemptStatus: refund.paymentCancels[0].status,
      ledgers: refund.ledgers.length,
    }).toEqual({
      payoutStatus: RefundPayoutStatus.PENDING,
      paidAmount: 0,
      attemptStatus: PaymentCancelStatus.REQUESTED,
      ledgers: 0,
    });
  });

  it('콜백의 PG 취소 요청이 없으면 PG_CALLBACK_TARGET_NOT_FOUND(404)로 거절된다', async () => {
    const rejection = service.applyCallback({
      success: true,
      paymentCancelId: randomUUID(),
      pgTransactionId: `pg-cancel-${randomUUID()}`,
      orderItemId: randomUUID(),
      amount: refundAmount,
      reason: null,
    });

    // DomainNotFoundError는 HttpExceptionFilter에서 404로 바뀐다
    await expect(rejection).rejects.toBeInstanceOf(
      PgCallbackTargetNotFoundError,
    );
    await expect(rejection).rejects.toBeInstanceOf(DomainNotFoundError);
    await expect(rejection).rejects.toMatchObject({
      code: 'PG_CALLBACK_TARGET_NOT_FOUND',
    });
  });

  it('콜백의 PG 취소 요청이 다른 환불에 속하면 PG_CALLBACK_TARGET_MISMATCH(409)로 거절되고 아무것도 반영하지 않는다', async () => {
    const pending = await createPendingRefund();
    const other = await createPendingRefund();

    const rejection = service.applyCallback({
      success: true,
      paymentCancelId: pending.paymentCancelId,
      pgTransactionId: `pg-cancel-${randomUUID()}`,
      orderItemId: other.orderItemId,
      amount: refundAmount,
      reason: null,
    });

    // DomainConflictError는 HttpExceptionFilter에서 409로 바뀐다
    await expect(rejection).rejects.toBeInstanceOf(
      PgCallbackTargetMismatchError,
    );
    await expect(rejection).rejects.toBeInstanceOf(DomainConflictError);
    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { paymentCancels: true, ledgers: true },
    });
    expect({
      attemptStatus: refund.paymentCancels[0].status,
      ledgers: refund.ledgers.length,
    }).toEqual({ attemptStatus: PaymentCancelStatus.REQUESTED, ledgers: 0 });
  });

  it('이미 성공으로 확정된 PG 취소 요청에 실제액이 다른 성공 통보가 오면 기존 실제액·원장을 유지하고 모순·운영자 알림을 남긴다', async () => {
    const pending = await createPendingRefund();
    const pgTransactionId = `pg-cancel-${randomUUID()}`;
    const succeedWith = (actualAmount: number) =>
      service.applyPgResult({
        paymentCancelId: pending.paymentCancelId,
        outcome: { kind: 'SUCCEEDED', pgTransactionId, actualAmount },
      });
    await succeedWith(refundAmount);

    await succeedWith(refundAmount - 2000);

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { paymentCancels: true, ledgers: true, notifications: true },
    });
    expect({
      actualAmount: refund.paymentCancels[0].actualAmount,
      paidAmount: refund.paidAmount,
      ledgerAmounts: refund.ledgers.map((l) => l.amount),
      actionCode: refund.actionCode,
      conflictNotifications: refund.notifications.filter(
        (n) =>
          n.kind === 'PG_RESULT_CONFLICT' &&
          n.audience === RefundNotificationAudience.OPERATOR,
      ).length,
    }).toEqual({
      actualAmount: refundAmount,
      paidAmount: refundAmount,
      ledgerAmounts: [-refundAmount],
      actionCode: 'PG_RESULT_CONFLICT',
      conflictNotifications: 1,
    });
  });

  it('이미 성공으로 확정된 PG 취소 요청에 거래 ID가 다른 성공 통보가 오면 모순·운영자 알림을 남긴다', async () => {
    const pending = await createPendingRefund();
    await succeed(pending.paymentCancelId, refundAmount);

    await succeed(pending.paymentCancelId, refundAmount);

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { ledgers: true, notifications: true },
    });
    expect({
      ledgers: refund.ledgers.length,
      actionCode: refund.actionCode,
      conflictNotifications: refund.notifications.filter(
        (n) => n.kind === 'PG_RESULT_CONFLICT',
      ).length,
    }).toEqual({
      ledgers: 1,
      actionCode: 'PG_RESULT_CONFLICT',
      conflictNotifications: 1,
    });
  });

  it('지급 완료(PAID)된 환불에 모순 통보가 오면 환불은 조치 필요·검토 필요·PG_RESULT_CONFLICT가 되고 지급 기록은 그대로다', async () => {
    const pending = await createPendingRefund();
    await succeed(pending.paymentCancelId, refundAmount);

    await service.applyPgResult({
      paymentCancelId: pending.paymentCancelId,
      outcome: { kind: 'FAILED', reason: '늦은 실패 통보' },
    });

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { paymentCancels: true, ledgers: true },
    });
    expect({
      payoutStatus: refund.payoutStatus,
      paidAt: refund.paidAt,
      reviewRequired: refund.reviewRequired,
      actionCode: refund.actionCode,
      attemptStatus: refund.paymentCancels[0].status,
      paidAmount: refund.paidAmount,
      ledgers: refund.ledgers.length,
    }).toEqual({
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      paidAt: null,
      reviewRequired: true,
      actionCode: 'PG_RESULT_CONFLICT',
      attemptStatus: PaymentCancelStatus.SUCCEEDED,
      paidAmount: refundAmount,
      ledgers: 1,
    });
  });

  it('이미 검토 필요인 환불은 확정 금액과 같은 성공 결과가 와도 지급 완료가 되지 않는다', async () => {
    const pending = await createPendingRefund();
    await prisma.refund.update({
      where: { id: pending.refundId },
      data: { reviewRequired: true, actionCode: 'PG_RESULT_CONFLICT' },
    });

    await succeed(pending.paymentCancelId, refundAmount);

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
    });
    expect({
      payoutStatus: refund.payoutStatus,
      paidAt: refund.paidAt,
      paidAmount: refund.paidAmount,
      reviewRequired: refund.reviewRequired,
    }).toEqual({
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      paidAt: null,
      paidAmount: refundAmount,
      reviewRequired: true,
    });
  });

  it('고객 환불의 PG 거절은 고객 본인·점주·운영자 알림을 저장한다', async () => {
    const pending = await createPendingRefund();

    await service.applyPgResult({
      paymentCancelId: pending.paymentCancelId,
      outcome: { kind: 'FAILED', reason: '취소 가능 기간 경과' },
    });

    const notifications = await prisma.refundNotification.findMany({
      where: { refundId: pending.refundId, kind: 'PG_REJECTED' },
    });
    expect(
      notifications
        .map((n) => ({
          audience: n.audience,
          recipientUserId: n.recipientUserId,
          shopId: n.shopId,
          paymentCancelId: n.paymentCancelId,
        }))
        .sort((a, b) => a.audience.localeCompare(b.audience)),
    ).toEqual([
      {
        audience: RefundNotificationAudience.CUSTOMER,
        recipientUserId: customerId,
        shopId,
        paymentCancelId: pending.paymentCancelId,
      },
      {
        audience: RefundNotificationAudience.OPERATOR,
        recipientUserId: null,
        shopId,
        paymentCancelId: pending.paymentCancelId,
      },
      {
        audience: RefundNotificationAudience.SHOP,
        recipientUserId: null,
        shopId,
        paymentCancelId: pending.paymentCancelId,
      },
    ]);
  });

  it('매장 환불의 PG 거절은 점주·운영자에게 알리고 고객에게는 알리지 않는다', async () => {
    const pending = await createPendingRefund(RefundSource.STORE);

    await service.applyPgResult({
      paymentCancelId: pending.paymentCancelId,
      outcome: { kind: 'FAILED', reason: '취소 가능 기간 경과' },
    });

    const notifications = await prisma.refundNotification.findMany({
      where: { refundId: pending.refundId, kind: 'PG_REJECTED' },
    });
    expect(notifications.map((n) => n.audience).sort()).toEqual([
      RefundNotificationAudience.OPERATOR,
      RefundNotificationAudience.SHOP,
    ]);
  });

  it('PG 실제액 불일치는 운영자 알림을 저장한다', async () => {
    const pending = await createPendingRefund();

    await succeed(pending.paymentCancelId, refundAmount - 3000);

    const notifications = await prisma.refundNotification.findMany({
      where: { refundId: pending.refundId, kind: 'AMOUNT_MISMATCH' },
    });
    expect(
      notifications.map((n) => ({
        audience: n.audience,
        paymentCancelId: n.paymentCancelId,
      })),
    ).toEqual([
      {
        audience: RefundNotificationAudience.OPERATOR,
        paymentCancelId: pending.paymentCancelId,
      },
    ]);
  });

  it.each([
    [
      'PG 거절',
      'PG_REJECTED',
      (paymentCancelId: string) =>
        service.applyPgResult({
          paymentCancelId,
          outcome: { kind: 'FAILED', reason: '취소 가능 기간 경과' },
        }),
    ],
    [
      'PG 실제액 불일치',
      'AMOUNT_MISMATCH',
      (paymentCancelId: string) => succeed(paymentCancelId, refundAmount - 1),
    ],
    [
      '확정 결과와 모순되는 통보',
      'PG_RESULT_CONFLICT',
      async (paymentCancelId: string) => {
        await succeed(paymentCancelId, refundAmount);
        return service.applyPgResult({
          paymentCancelId,
          outcome: { kind: 'FAILED', reason: '늦은 실패 통보' },
        });
      },
    ],
  ])(
    '%s는 거래 로그에 환불·PG 취소 요청과 함께 기록된다',
    async (_label, status, apply) => {
      const pending = await createPendingRefund();
      const txLog = jest.spyOn(
        app.get(TransactionLoggerService),
        'logTransaction',
      );

      await apply(pending.paymentCancelId);

      const logged = txLog.mock.calls.map(([log]) => log);
      txLog.mockRestore();
      expect(logged).toContainEqual(
        expect.objectContaining({
          type: 'REFUND',
          status,
          orderId: pending.orderId,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest 비대칭 매처는 any를 반환한다
          metadata: expect.objectContaining({
            refundId: pending.refundId,
            paymentCancelId: pending.paymentCancelId,
          }),
        }),
      );
    },
  );
  it('기존 경로가 만든 PG 취소 요청에 결제 전체(null) 대상 콜백이 오면 PG_CALLBACK_TARGET_MISMATCH로 거절된다', async () => {
    // 환불 기록 없이 기존 경로가 만든 PG 취소 요청
    const pending = await createPendingRefund();
    const source = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: pending.paymentCancelId },
    });
    const legacy = await prisma.paymentCancel.create({
      data: {
        paymentId: source.paymentId,
        orderItemId: pending.orderItemId,
        amount: refundAmount,
        status: PaymentCancelStatus.REQUESTED,
        requestedAt: new Date(),
      },
    });

    await expect(
      service.receiveCallback({
        success: true,
        paymentCancelId: legacy.id,
        pgTransactionId: `pg-cancel-${randomUUID()}`,
        orderItemId: null,
        amount: refundAmount,
        reason: null,
      }),
    ).rejects.toBeInstanceOf(PgCallbackTargetMismatchError);
  });

  it('콜백의 PG 취소 거래 ID가 원승인 거래 ID와 같으면 PG_CALLBACK_TARGET_MISMATCH로 거절되고 반영하지 않는다', async () => {
    const pending = await createPendingRefund();
    const approvalTransactionId = `pg-approve-${randomUUID()}`;
    const attempt = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: pending.paymentCancelId },
    });
    await prisma.payment.update({
      where: { id: attempt.paymentId },
      data: { pgTransactionId: approvalTransactionId },
    });

    await expect(
      service.applyCallback({
        success: true,
        paymentCancelId: pending.paymentCancelId,
        pgTransactionId: approvalTransactionId,
        orderItemId: pending.orderItemId,
        amount: refundAmount,
        reason: null,
      }),
    ).rejects.toBeInstanceOf(PgCallbackTargetMismatchError);
    const after = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: pending.paymentCancelId },
    });
    expect(after.status).toBe(PaymentCancelStatus.REQUESTED);
  });

  it('콜백의 PG 취소 거래 ID가 다른 PG 취소 요청에 이미 쓰였으면 PG_CALLBACK_TARGET_MISMATCH로 거절되고 반영하지 않는다', async () => {
    const first = await createPendingRefund();
    const second = await createPendingRefund();
    const usedTransactionId = `pg-cancel-${randomUUID()}`;
    await service.applyPgResult({
      paymentCancelId: first.paymentCancelId,
      outcome: {
        kind: 'SUCCEEDED',
        pgTransactionId: usedTransactionId,
        actualAmount: refundAmount,
      },
    });

    await expect(
      service.applyCallback({
        success: true,
        paymentCancelId: second.paymentCancelId,
        pgTransactionId: usedTransactionId,
        orderItemId: second.orderItemId,
        amount: refundAmount,
        reason: null,
      }),
    ).rejects.toBeInstanceOf(PgCallbackTargetMismatchError);
    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: second.refundId },
      include: { paymentCancels: true, ledgers: true },
    });
    expect({
      attemptStatus: refund.paymentCancels[0].status,
      ledgers: refund.ledgers.length,
    }).toEqual({ attemptStatus: PaymentCancelStatus.REQUESTED, ledgers: 0 });
  });

  it('콜백 결과 저장이 실패하면 REFUND_STORAGE_UNAVAILABLE(503)로 응답해 PG가 다시 보내게 한다', async () => {
    const pending = await createPendingRefund();
    const storageFailure = jest
      .spyOn(app.get(RefundRepository), 'runInTransaction')
      .mockRejectedValueOnce(new Error('connection terminated unexpectedly'));

    const rejection = service.receiveCallback({
      success: true,
      paymentCancelId: pending.paymentCancelId,
      pgTransactionId: `pg-cancel-${randomUUID()}`,
      orderItemId: pending.orderItemId,
      amount: refundAmount,
      reason: null,
    });

    await expect(rejection).rejects.toBeInstanceOf(
      RefundStorageUnavailableError,
    );
    storageFailure.mockRestore();
  });

  it('콜백 대상이 없다는 오류는 저장 실패(503)로 바뀌지 않고 그대로 전달된다', async () => {
    await expect(
      service.receiveCallback({
        success: true,
        paymentCancelId: randomUUID(),
        pgTransactionId: `pg-cancel-${randomUUID()}`,
        orderItemId: randomUUID(),
        amount: refundAmount,
        reason: null,
      }),
    ).rejects.toBeInstanceOf(PgCallbackTargetNotFoundError);
  });

  it('모순 결과 처리의 반환 상태는 처리 후 저장된 환불 상태와 같다', async () => {
    const pending = await createPendingRefund();
    await succeed(pending.paymentCancelId, refundAmount);

    const result = await service.applyPgResult({
      paymentCancelId: pending.paymentCancelId,
      outcome: { kind: 'FAILED', reason: '늦은 실패 통보' },
    });

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
    });
    expect(result).toEqual({
      applied: false,
      attemptStatus: PaymentCancelStatus.SUCCEEDED,
      payoutStatus: refund.payoutStatus,
    });
  });

  it('같은 PG 취소 거래 ID가 동시에 저장돼 DB unique 위반이 나면 503이 아니라 PG_CALLBACK_TARGET_MISMATCH로 거절된다', async () => {
    const first = await createPendingRefund();
    const second = await createPendingRefund();
    const racedTransactionId = `pg-cancel-${randomUUID()}`;
    await service.applyPgResult({
      paymentCancelId: first.paymentCancelId,
      outcome: {
        kind: 'SUCCEEDED',
        pgTransactionId: racedTransactionId,
        actualAmount: refundAmount,
      },
    });
    // 두 콜백이 사전 확인을 함께 통과한 경쟁 상황: 사전 확인은 사용 중이 아니라고 답한다
    const raced = jest
      .spyOn(app.get(RefundRepository), 'isCancelTransactionUsedByOther')
      .mockResolvedValueOnce(false);

    const rejection = service.receiveCallback({
      success: true,
      paymentCancelId: second.paymentCancelId,
      pgTransactionId: racedTransactionId,
      orderItemId: second.orderItemId,
      amount: refundAmount,
      reason: null,
    });

    await expect(rejection).rejects.toBeInstanceOf(
      PgCallbackTargetMismatchError,
    );
    raced.mockRestore();
    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: second.refundId },
      include: { paymentCancels: true, ledgers: true },
    });
    expect({
      attemptStatus: refund.paymentCancels[0].status,
      ledgers: refund.ledgers.length,
    }).toEqual({ attemptStatus: PaymentCancelStatus.REQUESTED, ledgers: 0 });
  });

  it('모순 결과의 거래 로그에는 기존 결과와 새 통보의 종류·실제액·거래 ID가 함께 남는다', async () => {
    const pending = await createPendingRefund();
    const storedTransactionId = `pg-cancel-${randomUUID()}`;
    const receivedTransactionId = `pg-cancel-${randomUUID()}`;
    await service.applyPgResult({
      paymentCancelId: pending.paymentCancelId,
      outcome: {
        kind: 'SUCCEEDED',
        pgTransactionId: storedTransactionId,
        actualAmount: refundAmount,
      },
    });
    const txLog = jest.spyOn(
      app.get(TransactionLoggerService),
      'logTransaction',
    );

    await service.applyPgResult({
      paymentCancelId: pending.paymentCancelId,
      outcome: {
        kind: 'SUCCEEDED',
        pgTransactionId: receivedTransactionId,
        actualAmount: refundAmount - 500,
      },
    });

    const conflictLog = txLog.mock.calls
      .map(([log]) => log)
      .find((log) => log.status === 'PG_RESULT_CONFLICT');
    txLog.mockRestore();
    expect(conflictLog?.metadata).toEqual({
      refundId: pending.refundId,
      paymentCancelId: pending.paymentCancelId,
      stored: {
        kind: PaymentCancelStatus.SUCCEEDED,
        actualAmount: refundAmount,
        pgTransactionId: storedTransactionId,
      },
      received: {
        kind: 'SUCCEEDED',
        actualAmount: refundAmount - 500,
        pgTransactionId: receivedTransactionId,
      },
    });
  });

  it('응답 없는(UNKNOWN) PG 취소 요청은 전송 시도가 기록되고 전송 60초 뒤 첫 조회가 예정된다', async () => {
    const pending = await createPendingRefund();
    pgGateway.sendCancel.mockResolvedValueOnce({
      result: 'UNKNOWN',
      reason: '응답 시간 초과',
    });

    await app.get(RefundDispatchService).dispatch(pending.paymentCancelId);

    const attempt = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: pending.paymentCancelId },
    });
    const sentAt = attempt.lastSendAttemptAt ?? new Date(Number.NaN);
    expect({
      status: attempt.status,
      sendAttemptCount: attempt.sendAttemptCount,
      nextInquiryAt: attempt.nextInquiryAt?.getTime(),
      claimToken: attempt.claimToken,
    }).toEqual({
      status: PaymentCancelStatus.REQUESTED,
      sendAttemptCount: 1,
      nextInquiryAt: sentAt.getTime() + 60_000,
      claimToken: null,
    });
  });

  it('PG 전송 결과가 NOT_SENT이면 그 시도는 실패(SEND_FAILED), 환불은 조치 필요가 되고 운영자 알림이 저장된다', async () => {
    const pending = await createPendingRefund();
    pgGateway.sendCancel.mockResolvedValueOnce({
      result: 'NOT_SENT',
      reason: 'PG 연결 설정 누락',
    });

    await app.get(RefundDispatchService).dispatch(pending.paymentCancelId);

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { paymentCancels: true, notifications: true },
    });
    expect({
      attempt: refund.paymentCancels[0].status,
      failureCode: refund.paymentCancels[0].failureCode,
      nextInquiryAt: refund.paymentCancels[0].nextInquiryAt,
      payoutStatus: refund.payoutStatus,
      actionCode: refund.actionCode,
      operatorNotified: refund.notifications.some(
        (n) =>
          n.audience === RefundNotificationAudience.OPERATOR &&
          n.kind === 'SEND_FAILED',
      ),
    }).toEqual({
      attempt: PaymentCancelStatus.FAILED,
      failureCode: PaymentCancelFailureCode.SEND_FAILED,
      nextInquiryAt: null,
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      actionCode: 'SEND_FAILED',
      operatorNotified: true,
    });
  });

  it('PG 전송 결과가 즉시 REJECTED이면 그 시도는 실패(PG_REJECTED), 환불은 조치 필요다', async () => {
    const pending = await createPendingRefund();
    pgGateway.sendCancel.mockResolvedValueOnce({
      result: 'REJECTED',
      reason: '취소 가능 기간 경과',
    });

    await app.get(RefundDispatchService).dispatch(pending.paymentCancelId);

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { paymentCancels: true },
    });
    expect({
      attempt: refund.paymentCancels[0].status,
      failureCode: refund.paymentCancels[0].failureCode,
      payoutStatus: refund.payoutStatus,
    }).toEqual({
      attempt: PaymentCancelStatus.FAILED,
      failureCode: PaymentCancelFailureCode.PG_REJECTED,
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
    });
  });

  it('PG 전송 결과가 즉시 SUCCEEDED이면 공통 결과 처리로 지급 완료와 실제액 원장을 반영한다', async () => {
    const pending = await createPendingRefund();
    pgGateway.sendCancel.mockResolvedValueOnce({
      result: 'SUCCEEDED',
      pgTransactionId: `pg-cancel-${randomUUID()}`,
      cancelledAmount: refundAmount,
    });

    await app.get(RefundDispatchService).dispatch(pending.paymentCancelId);

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { paymentCancels: true, ledgers: true },
    });
    expect({
      attempt: refund.paymentCancels[0].status,
      payoutStatus: refund.payoutStatus,
      ledgers: refund.ledgers.map((l) => l.amount),
    }).toEqual({
      attempt: PaymentCancelStatus.SUCCEEDED,
      payoutStatus: RefundPayoutStatus.PAID,
      ledgers: [-refundAmount],
    });
  });

  /** 다른 테스트 데이터와 겹치지 않는 먼 과거의 기준 시각 */
  const pastBase = new Date('2001-01-01T00:00:00Z');

  /**
   * 응답 없이 전송된 뒤 첫 조회를 기다리는 PG 취소 요청을 만든다(먼 과거 시각 기준)
   * @param resendCount 지금까지의 자동 재전송 횟수
   * @returns 환불·PG 취소 요청과 첫 조회 예정 시각
   */
  async function createAwaitingInquiry(resendCount = 0) {
    const pending = await createPendingRefund();
    const dueAt = new Date(pastBase.getTime() + 60_000);
    await prisma.paymentCancel.update({
      where: { id: pending.paymentCancelId },
      data: {
        sendAttemptCount: 1,
        lastSendAttemptAt: pastBase,
        nextInquiryAt: dueAt,
        resendCount,
      },
    });
    return { ...pending, dueAt };
  }

  it('PG가 미접수를 확실히 확인했고 자동 재전송 횟수가 한도보다 1 적으면 같은 ID·금액으로 다시 보내고 횟수가 1 늘어난다', async () => {
    const awaiting = await createAwaitingInquiry(2);
    pgGateway.inquireCancel.mockResolvedValueOnce({
      result: 'NOT_FOUND',
      authoritative: true,
    });
    pgGateway.sendCancel.mockResolvedValueOnce({ result: 'ACCEPTED' });

    await app
      .get(RefundRecoveryService)
      .inquireAttempt(awaiting.paymentCancelId, awaiting.dueAt);

    const attempt = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: awaiting.paymentCancelId },
    });
    expect({
      sent: pgGateway.sendCancel.mock.calls,
      resendCount: attempt.resendCount,
      status: attempt.status,
    }).toEqual({
      sent: [
        [{ paymentCancelId: awaiting.paymentCancelId, amount: refundAmount }],
      ],
      resendCount: 3,
      status: PaymentCancelStatus.REQUESTED,
    });
  });

  it('자동 재전송 횟수가 한도와 같고 PG가 미접수를 확인하면 시도 실패(RETRY_EXHAUSTED)·조치 필요·운영자 알림을 함께 기록한다', async () => {
    const awaiting = await createAwaitingInquiry(3);
    pgGateway.inquireCancel.mockResolvedValueOnce({
      result: 'NOT_FOUND',
      authoritative: true,
    });

    await app
      .get(RefundRecoveryService)
      .inquireAttempt(awaiting.paymentCancelId, awaiting.dueAt);

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: awaiting.refundId },
      include: { paymentCancels: true, notifications: true },
    });
    expect({
      sent: pgGateway.sendCancel.mock.calls.length,
      attempt: refund.paymentCancels[0].status,
      failureCode: refund.paymentCancels[0].failureCode,
      nextInquiryAt: refund.paymentCancels[0].nextInquiryAt,
      claimToken: refund.paymentCancels[0].claimToken,
      payoutStatus: refund.payoutStatus,
      actionCode: refund.actionCode,
      operatorNotified: refund.notifications.some(
        (n) =>
          n.audience === RefundNotificationAudience.OPERATOR &&
          n.kind === 'RETRY_EXHAUSTED',
      ),
    }).toEqual({
      sent: 0,
      attempt: PaymentCancelStatus.FAILED,
      failureCode: PaymentCancelFailureCode.RETRY_EXHAUSTED,
      nextInquiryAt: null,
      claimToken: null,
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      actionCode: 'RETRY_EXHAUSTED',
      operatorNotified: true,
    });
  });

  it('자동 재전송 한도를 소진한 뒤 PG가 처리 중이면 실패로 끝내지 않고 정상 간격(15초) 뒤 다시 조회를 예약한다', async () => {
    const awaiting = await createAwaitingInquiry(3);
    pgGateway.inquireCancel.mockResolvedValueOnce({ result: 'IN_PROGRESS' });

    await app
      .get(RefundRecoveryService)
      .inquireAttempt(awaiting.paymentCancelId, awaiting.dueAt);

    const attempt = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: awaiting.paymentCancelId },
    });
    expect({
      status: attempt.status,
      nextInquiryAt: attempt.nextInquiryAt?.getTime(),
      claimToken: attempt.claimToken,
    }).toEqual({
      status: PaymentCancelStatus.REQUESTED,
      nextInquiryAt: awaiting.dueAt.getTime() + 15_000,
      claimToken: null,
    });
  });

  it('자동 재전송 한도를 소진한 뒤 조회 오류이면 실패로 끝내지 않고 다시 조회를 예약한다', async () => {
    const awaiting = await createAwaitingInquiry(3);
    pgGateway.inquireCancel.mockResolvedValueOnce({
      result: 'QUERY_ERROR',
      reason: 'PG 조회 시간 초과',
    });

    await app
      .get(RefundRecoveryService)
      .inquireAttempt(awaiting.paymentCancelId, awaiting.dueAt);

    const attempt = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: awaiting.paymentCancelId },
    });
    expect({
      status: attempt.status,
      rescheduled:
        attempt.nextInquiryAt !== null &&
        attempt.nextInquiryAt > awaiting.dueAt,
      claimToken: attempt.claimToken,
    }).toEqual({
      status: PaymentCancelStatus.REQUESTED,
      rescheduled: true,
      claimToken: null,
    });
  });
});
