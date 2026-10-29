// src/refund/refund-result.integration.spec.ts
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  LedgerStatus,
  ManualRefundPayoutStatus,
  PaymentCancelFailureCode,
  PaymentCancelStatus,
  PaymentStatus,
  PaymentType,
  RefundDecisionStatus,
  RefundNotificationAudience,
  RefundPayoutMethod,
  RefundPayoutStatus,
  RefundRecoveryMode,
  RefundSource,
  RefundTargetKind,
  TicketStatus,
  TicketType,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
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
import { RefundWorkRepository } from './refund-work.repository';
import { RefundPgCheckService } from './refund-pg-check.service';
import { RefundRetryService } from './refund-retry.service';
import { RefundOperationsService } from './refund-operations.service';

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
  /** PG 재시도 실행자(MANAGER, PaymentCancel.requestedById 외래 키 대상) */
  let managerId: string;
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
    const manager = await prisma.user.create({
      data: {
        email: `refund-result-manager-${suffix}@test.com`,
        role: UserRole.MANAGER,
        password: 'hashed',
      },
    });
    managerId = manager.id;
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
    // 원장이 별도 환불금 지급을 가리키므로 원장을 먼저 지운다
    await prisma.ledger.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.manualRefundPayout.deleteMany({ where: byRefund });
    await prisma.paymentCancel.deleteMany({ where: { payment: byOrder } });
    await prisma.refundIdempotencyRecord.deleteMany({
      where: { requesterId: { in: [customerId, managerId] } },
    });
    await prisma.refund.deleteMany({ where: { payment: byOrder } });
    await prisma.ticket.deleteMany({ where: { userId: customerId } });
    await prisma.payment.deleteMany({ where: byOrder });
    await prisma.orderItem.deleteMany({ where: byOrder });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await prisma.user.deleteMany({
      where: { id: { in: [customerId, managerId] } },
    });
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

  it('시스템 자동 취소 환불의 PG 거절은 운영자에게만 알린다', async () => {
    const pending = await createPendingRefund(RefundSource.SYSTEM);

    await service.applyPgResult({
      paymentCancelId: pending.paymentCancelId,
      outcome: { kind: 'FAILED', reason: '취소 가능 기간 경과' },
    });

    const notifications = await prisma.refundNotification.findMany({
      where: { refundId: pending.refundId, kind: 'PG_REJECTED' },
    });
    expect(notifications.map((n) => n.audience)).toEqual([
      RefundNotificationAudience.OPERATOR,
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
   * @param sentAt 전송 시각(기본: 먼 과거 기준 시각, 일정 탐색 테스트는 저마다 다른 시각을 쓴다)
   * @returns 환불·PG 취소 요청과 첫 조회 예정 시각
   */
  async function createAwaitingInquiry(resendCount = 0, sentAt = pastBase) {
    const pending = await createPendingRefund();
    const dueAt = new Date(sentAt.getTime() + 60_000);
    await prisma.paymentCancel.update({
      where: { id: pending.paymentCancelId },
      data: {
        sendAttemptCount: 1,
        lastSendAttemptAt: sentAt,
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

  /**
   * 연속 조회 오류가 쌓인 상태에서 결과를 받아 조회한다
   * @param failures 지금까지의 연속 조회 오류 횟수
   * @param result 이번 조회 결과
   * @returns 조회 뒤 PG 취소 요청과 조회 시각
   */
  async function inquireAfterFailures(
    failures: number,
    result:
      { result: 'QUERY_ERROR'; reason: string } | { result: 'IN_PROGRESS' },
  ) {
    const awaiting = await createAwaitingInquiry();
    await prisma.paymentCancel.update({
      where: { id: awaiting.paymentCancelId },
      data: { inquiryFailureCount: failures },
    });
    pgGateway.inquireCancel.mockResolvedValueOnce(result);
    await app
      .get(RefundRecoveryService)
      .inquireAttempt(awaiting.paymentCancelId, awaiting.dueAt);
    const attempt = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: awaiting.paymentCancelId },
    });
    return { ...awaiting, attempt };
  }

  /** 조회 오류 응답 */
  const queryError = { result: 'QUERY_ERROR' as const, reason: '조회 실패' };

  it('첫 조회 오류 뒤 다음 조회 간격은 15초다', async () => {
    const { attempt, dueAt } = await inquireAfterFailures(0, queryError);

    expect(attempt.nextInquiryAt?.getTime()).toBe(dueAt.getTime() + 15_000);
  });

  it('연속 조회 오류 4회에서는 결과 확인 중(REQUESTED)이 유지된다', async () => {
    const { attempt } = await inquireAfterFailures(3, queryError);

    expect({
      status: attempt.status,
      failures: attempt.inquiryFailureCount,
    }).toEqual({ status: PaymentCancelStatus.REQUESTED, failures: 4 });
  });

  it('PG가 처리 중이라고 응답하면 연속 조회 오류 횟수를 0으로 되돌린다', async () => {
    const { attempt } = await inquireAfterFailures(3, {
      result: 'IN_PROGRESS',
    });

    expect({
      failures: attempt.inquiryFailureCount,
      lastInquiryError: attempt.lastInquiryError,
    }).toEqual({ failures: 0, lastInquiryError: null });
  });

  it('연속 조회 오류 5회에서 결과 확인 실패(QUERY_FAILED)와 운영자 알림이 기록된다', async () => {
    const { attempt, refundId } = await inquireAfterFailures(4, queryError);

    const notifications = await prisma.refundNotification.findMany({
      where: { refundId, kind: 'QUERY_FAILED' },
    });
    expect({
      status: attempt.status,
      queryFailedAt: attempt.queryFailedAt instanceof Date,
      failures: attempt.inquiryFailureCount,
      claimToken: attempt.claimToken,
      operatorNotified: notifications.some(
        (n) => n.audience === RefundNotificationAudience.OPERATOR,
      ),
    }).toEqual({
      status: PaymentCancelStatus.QUERY_FAILED,
      queryFailedAt: true,
      failures: 5,
      claimToken: null,
      operatorNotified: true,
    });
  });

  it('응답 없는 전송 59초 시점의 정기 탐색은 조회하지 않고 60초 시점에는 조회한다', async () => {
    const sentAt = new Date('1999-03-01T00:00:00Z');
    const awaiting = await createAwaitingInquiry(0, sentAt);
    pgGateway.inquireCancel.mockResolvedValue({ result: 'IN_PROGRESS' });
    const recovery = app.get(RefundRecoveryService);

    await recovery.sweep(new Date(sentAt.getTime() + 59_000));
    const callsAt59 = pgGateway.inquireCancel.mock.calls.length;
    await recovery.sweep(new Date(sentAt.getTime() + 60_000));

    expect({
      callsAt59,
      calledAt60: pgGateway.inquireCancel.mock.calls,
    }).toEqual({
      callsAt59: 0,
      calledAt60: [[{ paymentCancelId: awaiting.paymentCancelId }]],
    });
  });

  it('실패로 확정된 PG 취소 요청은 예정 시각이 남아 있어도 정기 탐색에서 조회·재전송하지 않는다', async () => {
    // 정기 탐색은 기준 시각 이전의 모든 예정 건을 고르므로, 앞 테스트가 남긴 데이터보다 이른 시각을 쓴다
    const sentAt = new Date('1998-01-01T00:00:00Z');
    const awaiting = await createAwaitingInquiry(0, sentAt);
    // 실패 확정 뒤에도 예정 시각이 남아 있는 비정상 데이터라도 제외해야 한다
    await prisma.paymentCancel.update({
      where: { id: awaiting.paymentCancelId },
      data: { status: PaymentCancelStatus.FAILED },
    });

    await app.get(RefundRecoveryService).sweep(awaiting.dueAt);

    expect({
      inquiries: pgGateway.inquireCancel.mock.calls.length,
      sends: pgGateway.sendCancel.mock.calls.length,
    }).toEqual({ inquiries: 0, sends: 0 });
  });

  /** 정기 탐색 테스트용 기준 연도(테스트마다 앞 테스트보다 이른 시각을 써서 남은 예정 건과 섞이지 않게 한다) */
  let sweepYear = 1997;

  /**
   * 앞 테스트보다 이른 정기 탐색 기준 시각을 돌려준다
   * @returns 해당 연도 1월 1일
   */
  function isolatedSweepBase(): Date {
    return new Date(Date.UTC(sweepYear--, 0, 1));
  }

  it('별도 환불금 지급 예약이 있는 환불은 정기 탐색에서 조회·재전송하지 않는다', async () => {
    const awaiting = await createAwaitingInquiry(0, isolatedSweepBase());
    await prisma.manualRefundPayout.create({
      data: {
        refundId: awaiting.refundId,
        status: ManualRefundPayoutStatus.RESERVED,
        amount: refundAmount,
        reservedById: customerId,
        reservedAt: new Date(),
        reason: '계좌 이체로 지급 예정',
      },
    });
    pgGateway.inquireCancel.mockResolvedValue({ result: 'IN_PROGRESS' });

    await app.get(RefundRecoveryService).sweep(awaiting.dueAt);

    expect(pgGateway.inquireCancel.mock.calls.length).toBe(0);
  });

  it('커밋 뒤 전송 전에 중단된 PG 취소 요청은 담당 기한이 지나면 다시 보내지 않고 조회부터 한다', async () => {
    const committedAt = isolatedSweepBase();
    const pending = await createPendingRefund();
    // 확정 트랜잭션이 전송 기록·담당을 저장하고 커밋했지만 PG에 보내기 전에 서버가 멈춘 상태
    await prisma.paymentCancel.update({
      where: { id: pending.paymentCancelId },
      data: {
        sendAttemptCount: 1,
        lastSendAttemptAt: committedAt,
        claimToken: 'crashed-worker',
        claimUntil: new Date(committedAt.getTime() + 30_000),
        nextInquiryAt: null,
      },
    });
    pgGateway.inquireCancel.mockResolvedValue({ result: 'IN_PROGRESS' });

    await app
      .get(RefundRecoveryService)
      .sweep(new Date(committedAt.getTime() + 31_000));

    expect({
      inquiries: pgGateway.inquireCancel.mock.calls,
      sends: pgGateway.sendCancel.mock.calls.length,
    }).toEqual({
      inquiries: [[{ paymentCancelId: pending.paymentCancelId }]],
      sends: 0,
    });
  });

  it('지급 처리 중이 아닌(조치 필요) 환불의 미확정 시도는 정기 탐색에서 조회하지 않는다', async () => {
    const awaiting = await createAwaitingInquiry(0, isolatedSweepBase());
    await prisma.refund.update({
      where: { id: awaiting.refundId },
      data: {
        payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
        reviewRequired: true,
        actionCode: 'PG_RESULT_CONFLICT',
      },
    });
    pgGateway.inquireCancel.mockResolvedValue({ result: 'IN_PROGRESS' });

    await app.get(RefundRecoveryService).sweep(awaiting.dueAt);

    expect(pgGateway.inquireCancel.mock.calls.length).toBe(0);
  });

  /** 장애 복구 확인 테스트용 기준 연도(테스트마다 앞 테스트보다 이른 시각) */
  let recoveryYear = 1990;

  /**
   * 결과 확인 실패(QUERY_FAILED) 상태의 PG 취소 요청을 만든다
   * @param queryFailedAt 결과 확인 실패 진입 시각
   * @returns 환불·PG 취소 요청
   */
  async function createQueryFailed(queryFailedAt: Date) {
    const pending = await createPendingRefund();
    await prisma.paymentCancel.update({
      where: { id: pending.paymentCancelId },
      data: {
        status: PaymentCancelStatus.QUERY_FAILED,
        sendAttemptCount: 1,
        lastSendAttemptAt: queryFailedAt,
        inquiryFailureCount: 5,
        queryFailedAt,
      },
    });
    return pending;
  }

  /**
   * 단일 복구 제어 행을 PROBE·즉시 실행 가능 상태로 되돌린다
   */
  async function resetRecoveryControl() {
    await prisma.refundRecoveryControl.deleteMany({});
    await app.get(RefundWorkRepository).getRecoveryControl();
  }

  it('PROBE 모드는 가장 오래된 결과 확인 실패 1건만 조회하고 900초가 지나기 전에는 다시 조회하지 않는다', async () => {
    await resetRecoveryControl();
    const year = recoveryYear--;
    const oldest = await createQueryFailed(new Date(Date.UTC(year, 0, 1)));
    await createQueryFailed(new Date(Date.UTC(year, 0, 2)));
    pgGateway.inquireCancel.mockResolvedValue({
      result: 'QUERY_ERROR',
      reason: 'PG 장애 지속',
    });
    const recovery = app.get(RefundRecoveryService);
    const now = new Date(Date.UTC(year, 1, 1));

    await recovery.recoverQueryFailed(now);
    const firstProbe: unknown[] = pgGateway.inquireCancel.mock.calls.slice();
    await recovery.recoverQueryFailed(new Date(now.getTime() + 899_000));

    expect({
      firstProbe,
      totalCalls: pgGateway.inquireCancel.mock.calls.length,
    }).toEqual({
      firstProbe: [[{ paymentCancelId: oldest.paymentCancelId }]],
      totalCalls: 1,
    });
  });

  it('결과 확인 실패 건이 PG 처리 중 응답을 받으면 일반 조회 일정(REQUESTED)으로 돌아간다', async () => {
    const queryFailedAt = new Date(Date.UTC(recoveryYear--, 0, 1));
    const failed = await createQueryFailed(queryFailedAt);
    pgGateway.inquireCancel.mockResolvedValueOnce({ result: 'IN_PROGRESS' });
    const now = new Date(queryFailedAt.getTime() + 86_400_000);

    await app
      .get(RefundRecoveryService)
      .inquireAttempt(failed.paymentCancelId, now);

    const attempt = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: failed.paymentCancelId },
    });
    expect({
      status: attempt.status,
      queryFailedAt: attempt.queryFailedAt,
      failures: attempt.inquiryFailureCount,
      nextInquiryAt: attempt.nextInquiryAt?.getTime(),
    }).toEqual({
      status: PaymentCancelStatus.REQUESTED,
      queryFailedAt: null,
      failures: 0,
      nextInquiryAt: now.getTime() + 15_000,
    });
  });

  it('PROBE 조회가 정상 응답이면 BATCH 모드로 바뀌고 다음 실행에서 남은 결과 확인 실패 건을 처리 단위만큼 조회한다', async () => {
    await resetRecoveryControl();
    const year = recoveryYear--;
    const oldest = await createQueryFailed(new Date(Date.UTC(year, 0, 1)));
    const second = await createQueryFailed(new Date(Date.UTC(year, 0, 2)));
    const third = await createQueryFailed(new Date(Date.UTC(year, 0, 3)));
    pgGateway.inquireCancel.mockResolvedValue({ result: 'IN_PROGRESS' });
    const recovery = app.get(RefundRecoveryService);
    const now = new Date(Date.UTC(year, 1, 1));

    await recovery.recoverQueryFailed(now);
    const control = await prisma.refundRecoveryControl.findFirstOrThrow();
    await recovery.recoverQueryFailed(new Date(now.getTime() + 1_000));

    expect({
      mode: control.mode,
      inquired: pgGateway.inquireCancel.mock.calls.map(
        ([request]: [{ paymentCancelId: string }]) => request.paymentCancelId,
      ),
    }).toEqual({
      mode: 'BATCH',
      inquired: [
        oldest.paymentCancelId,
        second.paymentCancelId,
        third.paymentCancelId,
      ],
    });
  });

  it('BATCH 조회 중 오류가 다시 나면 남은 건을 조회하지 않고 PROBE 모드로 돌아간다', async () => {
    await resetRecoveryControl();
    const year = recoveryYear--;
    const first = await createQueryFailed(new Date(Date.UTC(year, 0, 1)));
    await createQueryFailed(new Date(Date.UTC(year, 0, 2)));
    const now = new Date(Date.UTC(year, 1, 1));
    await prisma.refundRecoveryControl.update({
      where: { id: 'PG_RESULT_RECOVERY' },
      data: { mode: 'BATCH', batchCutoffAt: now, nextProbeAt: null },
    });
    pgGateway.inquireCancel.mockResolvedValue({
      result: 'QUERY_ERROR',
      reason: 'PG 장애 재발',
    });

    await app.get(RefundRecoveryService).recoverQueryFailed(now);

    const control = await prisma.refundRecoveryControl.findFirstOrThrow();
    expect({
      inquired: pgGateway.inquireCancel.mock.calls.length,
      firstInquired: pgGateway.inquireCancel.mock.calls[0] as unknown,
      mode: control.mode,
      nextProbeAt: control.nextProbeAt?.getTime(),
    }).toEqual({
      inquired: 1,
      firstInquired: [{ paymentCancelId: first.paymentCancelId }],
      mode: 'PROBE',
      nextProbeAt: now.getTime() + 900_000,
    });
  });

  it('전체 재확인 요청은 결과 확인 실패 대상이 없으면 NO_WORK를 받고 복구 제어를 바꾸지 않는다', async () => {
    await resetRecoveryControl();
    // 어떤 결과 확인 실패 건보다도 이른 기준 시각
    const now = new Date(Date.UTC(1970, 0, 2));

    const outcome = await app.get(RefundRecoveryService).resumeRecovery(now);

    const control = await prisma.refundRecoveryControl.findFirstOrThrow();
    expect({ outcome, mode: control.mode }).toEqual({
      outcome: 'NO_WORK',
      mode: 'PROBE',
    });
  });

  it('전체 재확인 요청은 대상이 있으면 SCHEDULED를 받고, 자동 확인 예정 시각을 기다리지 않도록 BATCH로 바꿔 즉시 실행을 예약한다', async () => {
    await resetRecoveryControl();
    const year = recoveryYear--;
    await createQueryFailed(new Date(Date.UTC(year, 0, 1)));
    const now = new Date(Date.UTC(year, 1, 1));
    // 앞선 PROBE 오류로 다음 확인 시각이 먼 상태
    await prisma.refundRecoveryControl.update({
      where: { id: 'PG_RESULT_RECOVERY' },
      data: { nextProbeAt: new Date(now.getTime() + 900_000) },
    });
    const queue = app.get<Queue>(getQueueToken('refund-recovery'));
    const enqueue = jest.spyOn(queue, 'add').mockResolvedValue({} as Job);

    const outcome = await app.get(RefundRecoveryService).resumeRecovery(now);

    const control = await prisma.refundRecoveryControl.findFirstOrThrow();
    const enqueued = enqueue.mock.calls.map(([name]) => name);
    enqueue.mockRestore();
    expect({
      outcome,
      mode: control.mode,
      batchCutoffAt: control.batchCutoffAt,
      nextProbeAt: control.nextProbeAt,
      enqueued,
    }).toEqual({
      outcome: 'SCHEDULED',
      mode: 'BATCH',
      batchCutoffAt: now,
      nextProbeAt: null,
      enqueued: ['sweep'],
    });
  });

  it('전체 재확인 요청은 복구 작업이 실행 중이면 ALREADY_RUNNING을 받고 아무것도 바꾸지 않는다', async () => {
    await resetRecoveryControl();
    const year = recoveryYear--;
    await createQueryFailed(new Date(Date.UTC(year, 0, 1)));
    const now = new Date(Date.UTC(year, 1, 1));
    // 다른 작업자가 복구 작업을 맡아 처리 기한 안에서 실행 중인 상태
    await prisma.refundRecoveryControl.update({
      where: { id: 'PG_RESULT_RECOVERY' },
      data: {
        claimToken: 'running-worker',
        claimUntil: new Date(now.getTime() + 30_000),
      },
    });
    const queue = app.get<Queue>(getQueueToken('refund-recovery'));
    const enqueue = jest.spyOn(queue, 'add').mockResolvedValue({} as Job);

    const outcome = await app.get(RefundRecoveryService).resumeRecovery(now);

    const control = await prisma.refundRecoveryControl.findFirstOrThrow();
    const enqueued = enqueue.mock.calls.length;
    enqueue.mockRestore();
    expect({ outcome, mode: control.mode, enqueued }).toEqual({
      outcome: 'ALREADY_RUNNING',
      mode: 'PROBE',
      enqueued: 0,
    });
  });

  it('장애 복구 확인은 다른 작업자가 맡고 있으면 건너뛰고, 직접 실행한 뒤에는 담당을 내려놓는다', async () => {
    await resetRecoveryControl();
    const year = recoveryYear--;
    await createQueryFailed(new Date(Date.UTC(year, 0, 1)));
    const now = new Date(Date.UTC(year, 1, 1));
    pgGateway.inquireCancel.mockResolvedValue({
      result: 'QUERY_ERROR',
      reason: 'PG 장애 지속',
    });
    const recovery = app.get(RefundRecoveryService);
    await prisma.refundRecoveryControl.update({
      where: { id: 'PG_RESULT_RECOVERY' },
      data: {
        claimToken: 'other-worker',
        claimUntil: new Date(now.getTime() + 30_000),
      },
    });

    await recovery.recoverQueryFailed(now);
    const whileOtherRunning = pgGateway.inquireCancel.mock.calls.length;
    // 다른 작업자의 처리 기한이 지난 뒤에는 직접 맡아 실행한다
    await recovery.recoverQueryFailed(new Date(now.getTime() + 31_000));

    const control = await prisma.refundRecoveryControl.findFirstOrThrow();
    expect({
      whileOtherRunning,
      afterExpiry: pgGateway.inquireCancel.mock.calls.length,
      claimToken: control.claimToken,
      claimUntil: control.claimUntil,
    }).toEqual({
      whileOtherRunning: 0,
      afterExpiry: 1,
      claimToken: null,
      claimUntil: null,
    });
  });

  /** 개별 확인을 요청하는 운영자 */
  const operator = { userId: 'operator-1', role: UserRole.MANAGER };

  /**
   * 마지막 조회가 지정한 시간 전에 끝난 미확정 PG 취소 요청을 만든다
   * @param secondsSinceLastInquiry 마지막 조회 뒤 지난 초
   * @returns 환불·PG 취소 요청과 기준 시각
   */
  async function createInquiredBefore(secondsSinceLastInquiry: number) {
    const pending = await createPendingRefund();
    const now = new Date();
    await prisma.paymentCancel.update({
      where: { id: pending.paymentCancelId },
      data: {
        sendAttemptCount: 1,
        lastSendAttemptAt: new Date(now.getTime() - 120_000),
        lastInquiryAt: new Date(now.getTime() - secondsSinceLastInquiry * 1000),
        nextInquiryAt: new Date(now.getTime() + 600_000),
      },
    });
    return { ...pending, now };
  }

  it('최근 조회 후 15초가 지났으면 자동 조회 예정 시각 전이라도 그 시도 한 건을 즉시 조회한다', async () => {
    const target = await createInquiredBefore(15);
    pgGateway.inquireCancel.mockResolvedValueOnce({ result: 'IN_PROGRESS' });

    const result = await app
      .get(RefundPgCheckService)
      .check(operator, target.refundId, target.now);

    expect({
      checkStatus: result.checkStatus,
      inquiryResult: result.inquiryResult,
      inquired: pgGateway.inquireCancel.mock.calls,
    }).toEqual({
      checkStatus: 'CHECKED',
      inquiryResult: 'IN_PROGRESS',
      inquired: [[{ paymentCancelId: target.paymentCancelId }]],
    });
  });

  it('최근 조회 후 14초에 개별 확인하면 RECENT_RESULT와 최근 조회 시각을 받고 PG는 호출되지 않는다', async () => {
    const target = await createInquiredBefore(14);
    pgGateway.inquireCancel.mockResolvedValue({ result: 'IN_PROGRESS' });

    const result = await app
      .get(RefundPgCheckService)
      .check(operator, target.refundId, target.now);

    expect({
      checkStatus: result.checkStatus,
      lastInquiryAt: result.lastInquiryAt,
      inquired: pgGateway.inquireCancel.mock.calls.length,
    }).toEqual({
      checkStatus: 'RECENT_RESULT',
      lastInquiryAt: new Date(target.now.getTime() - 14_000).toISOString(),
      inquired: 0,
    });
  });

  it('같은 환불의 전송·조회 담당이 유효하면 ALREADY_RUNNING을 받고 PG는 호출되지 않는다', async () => {
    const target = await createInquiredBefore(60);
    await prisma.paymentCancel.update({
      where: { id: target.paymentCancelId },
      data: {
        claimToken: 'auto-worker',
        claimUntil: new Date(target.now.getTime() + 20_000),
      },
    });
    pgGateway.inquireCancel.mockResolvedValue({ result: 'IN_PROGRESS' });

    const result = await app
      .get(RefundPgCheckService)
      .check(operator, target.refundId, target.now);

    expect({
      checkStatus: result.checkStatus,
      inquired: pgGateway.inquireCancel.mock.calls.length,
    }).toEqual({ checkStatus: 'ALREADY_RUNNING', inquired: 0 });
  });

  it('자동 재전송 한도를 소진한 미확정 요청도 개별 확인에서 PG 미접수가 확인되면 기존 ID·금액으로 즉시 다시 보낸다', async () => {
    const target = await createInquiredBefore(60);
    await prisma.paymentCancel.update({
      where: { id: target.paymentCancelId },
      data: { resendCount: 3 },
    });
    pgGateway.inquireCancel.mockResolvedValueOnce({
      result: 'NOT_FOUND',
      authoritative: true,
    });
    pgGateway.sendCancel.mockResolvedValueOnce({ result: 'ACCEPTED' });

    const result = await app
      .get(RefundPgCheckService)
      .check(operator, target.refundId, target.now);

    expect({
      checkStatus: result.checkStatus,
      inquiryResult: result.inquiryResult,
      resendResult: result.resendResult,
      sent: pgGateway.sendCancel.mock.calls,
    }).toEqual({
      checkStatus: 'CHECKED',
      inquiryResult: 'NOT_FOUND',
      resendResult: 'ACCEPTED',
      sent: [
        [{ paymentCancelId: target.paymentCancelId, amount: refundAmount }],
      ],
    });
  });

  it('개별 확인 재전송은 개별 확인 재전송 횟수만 늘리고 자동 재전송 횟수는 그대로 둔다', async () => {
    const target = await createInquiredBefore(60);
    await prisma.paymentCancel.update({
      where: { id: target.paymentCancelId },
      data: { resendCount: 2 },
    });
    pgGateway.inquireCancel.mockResolvedValueOnce({
      result: 'NOT_FOUND',
      authoritative: true,
    });
    pgGateway.sendCancel.mockResolvedValueOnce({ result: 'ACCEPTED' });

    await app
      .get(RefundPgCheckService)
      .check(operator, target.refundId, target.now);

    const attempt = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: target.paymentCancelId },
    });
    expect({
      resendCount: attempt.resendCount,
      manualResendCount: attempt.manualResendCount,
      sendAttemptCount: attempt.sendAttemptCount,
    }).toEqual({ resendCount: 2, manualResendCount: 1, sendAttemptCount: 2 });
  });

  it.each([
    ['PG 처리 중', { result: 'IN_PROGRESS' as const }],
    ['조회 오류', { result: 'QUERY_ERROR' as const, reason: '조회 실패' }],
  ])(
    '개별 확인 조회가 %s이면 다시 보내지 않고 지급을 확정하지 않는다',
    async (_label, inquiry) => {
      const target = await createInquiredBefore(60);
      pgGateway.inquireCancel.mockResolvedValueOnce(inquiry);

      const result = await app
        .get(RefundPgCheckService)
        .check(operator, target.refundId, target.now);

      const refund = await prisma.refund.findUniqueOrThrow({
        where: { id: target.refundId },
      });
      expect({
        resendResult: result.resendResult,
        sends: pgGateway.sendCancel.mock.calls.length,
        payoutStatus: refund.payoutStatus,
      }).toEqual({
        resendResult: null,
        sends: 0,
        payoutStatus: RefundPayoutStatus.PENDING,
      });
    },
  );

  it('미확정 요청의 개별 확인에서 새로 확인한 거절은 실패·조치 필요만 기록하고 새 PG 취소 요청을 만들지 않는다', async () => {
    const target = await createInquiredBefore(60);
    pgGateway.inquireCancel.mockResolvedValueOnce({
      result: 'FAILED',
      reason: '취소 가능 기간 경과',
    });

    await app
      .get(RefundPgCheckService)
      .check(operator, target.refundId, target.now);

    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: target.refundId },
      include: { paymentCancels: true },
    });
    expect({
      attempts: refund.paymentCancels.map((a) => a.status),
      payoutStatus: refund.payoutStatus,
      sends: pgGateway.sendCancel.mock.calls.length,
    }).toEqual({
      attempts: [PaymentCancelStatus.FAILED],
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      sends: 0,
    });
  });

  it('개별 확인은 다른 환불의 상태와 전체 복구 제어를 바꾸지 않는다', async () => {
    await resetRecoveryControl();
    const target = await createInquiredBefore(60);
    const other = await createInquiredBefore(60);
    const otherBefore = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: other.paymentCancelId },
    });
    const controlBefore = await prisma.refundRecoveryControl.findFirstOrThrow();
    pgGateway.inquireCancel.mockResolvedValue({ result: 'IN_PROGRESS' });

    await app
      .get(RefundPgCheckService)
      .check(operator, target.refundId, target.now);

    const otherAfter = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: other.paymentCancelId },
    });
    const controlAfter = await prisma.refundRecoveryControl.findFirstOrThrow();
    expect({
      inquired: pgGateway.inquireCancel.mock.calls,
      other: otherAfter.updatedAt,
      control: controlAfter.updatedAt,
    }).toEqual({
      inquired: [[{ paymentCancelId: target.paymentCancelId }]],
      other: otherBefore.updatedAt,
      control: controlBefore.updatedAt,
    });
  });

  it.each([
    [
      '지급 완료',
      { payoutStatus: RefundPayoutStatus.PAID, paidAmount: 10000 },
      false,
    ],
    ['금액 검토 중', { reviewRequired: true }, false],
    ['별도 지급 방식', { payoutMethod: RefundPayoutMethod.MANUAL }, false],
    ['별도 지급 예약 중', {}, true],
  ] as const)(
    '%s 환불은 개별 확인에서 NO_PENDING_ATTEMPT를 받고 PG는 호출되지 않는다',
    async (_label, refundState, reserved) => {
      const target = await createInquiredBefore(60);
      await prisma.refund.update({
        where: { id: target.refundId },
        data: refundState,
      });
      if (reserved) {
        await prisma.manualRefundPayout.create({
          data: {
            refundId: target.refundId,
            status: ManualRefundPayoutStatus.RESERVED,
            amount: refundAmount,
            reservedById: customerId,
            reservedAt: new Date(),
            reason: '계좌 이체 예정',
          },
        });
      }
      pgGateway.inquireCancel.mockResolvedValue({ result: 'IN_PROGRESS' });

      const result = await app
        .get(RefundPgCheckService)
        .check(operator, target.refundId, target.now);

      expect({
        checkStatus: result.checkStatus,
        inquired: pgGateway.inquireCancel.mock.calls.length,
      }).toEqual({ checkStatus: 'NO_PENDING_ATTEMPT', inquired: 0 });
    },
  );

  it('PG 결과 모순이 기록된 환불은 개별 확인에서 재전송 없이 저장된 상태를 받는다', async () => {
    const target = await createInquiredBefore(60);
    await prisma.refund.update({
      where: { id: target.refundId },
      data: {
        payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
        reviewRequired: true,
        actionCode: 'PG_RESULT_CONFLICT',
      },
    });
    pgGateway.inquireCancel.mockResolvedValue({
      result: 'NOT_FOUND',
      authoritative: true,
    });

    const result = await app
      .get(RefundPgCheckService)
      .check(operator, target.refundId, target.now);

    expect({
      checkStatus: result.checkStatus,
      inquired: pgGateway.inquireCancel.mock.calls.length,
      sent: pgGateway.sendCancel.mock.calls.length,
    }).toEqual({ checkStatus: 'NO_PENDING_ATTEMPT', inquired: 0, sent: 0 });
  });

  it('결과 확인 실패 건이 미접수 확인 뒤 재전송이 접수되면 연속 오류를 지우고 일반 조회 일정으로 복귀한다', async () => {
    const queryFailedAt = new Date(Date.UTC(recoveryYear--, 0, 1));
    const failed = await createQueryFailed(queryFailedAt);
    await prisma.paymentCancel.update({
      where: { id: failed.paymentCancelId },
      data: { lastInquiryError: 'PG 장애' },
    });
    pgGateway.inquireCancel.mockResolvedValueOnce({
      result: 'NOT_FOUND',
      authoritative: true,
    });
    pgGateway.sendCancel.mockResolvedValueOnce({ result: 'ACCEPTED' });
    const now = new Date(queryFailedAt.getTime() + 86_400_000);

    await app
      .get(RefundRecoveryService)
      .inquireAttempt(failed.paymentCancelId, now);

    const attempt = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: failed.paymentCancelId },
    });
    expect({
      status: attempt.status,
      queryFailedAt: attempt.queryFailedAt,
      failures: attempt.inquiryFailureCount,
      lastInquiryError: attempt.lastInquiryError,
      nextInquiryAt: attempt.nextInquiryAt?.getTime(),
    }).toEqual({
      status: PaymentCancelStatus.REQUESTED,
      queryFailedAt: null,
      failures: 0,
      lastInquiryError: null,
      nextInquiryAt: now.getTime() + 60_000,
    });
  });

  it('개별 확인은 잠금 안에서 최근 조회 간격을 다시 확인해, 먼저 읽은 기록이 오래됐어도 PG를 다시 부르지 않는다', async () => {
    const target = await createInquiredBefore(60);
    pgGateway.inquireCancel.mockResolvedValue({ result: 'IN_PROGRESS' });
    const pgCheck = app.get(RefundPgCheckService);
    // 두 요청이 같은 오래된 기록을 읽은 경합: 두 번째 요청은 첫 조회 전의 기록을 보고 들어온다
    const stale = await app
      .get(RefundRepository)
      .findPendingAttemptOfRefund(target.refundId);
    await pgCheck.check(operator, target.refundId, target.now);
    const staleRead = jest
      .spyOn(app.get(RefundRepository), 'findPendingAttemptOfRefund')
      .mockResolvedValueOnce(stale);

    const second = await pgCheck.check(
      operator,
      target.refundId,
      new Date(target.now.getTime() + 1_000),
    );
    staleRead.mockRestore();

    expect({
      checkStatus: second.checkStatus,
      inquiries: pgGateway.inquireCancel.mock.calls.length,
    }).toEqual({ checkStatus: 'RECENT_RESULT', inquiries: 1 });
  });

  it('복구 제어 상태 변경은 현재 담당 토큰일 때만 반영된다', async () => {
    await resetRecoveryControl();
    const work = app.get(RefundWorkRepository);
    const now = new Date();
    await work.claimRecoveryControl(
      'current-worker',
      now,
      new Date(now.getTime() + 30_000),
    );

    await work.updateRecoveryControl('stale-worker', {
      mode: RefundRecoveryMode.BATCH,
    });
    const afterStale = await work.getRecoveryControl();
    await work.updateRecoveryControl('current-worker', {
      mode: RefundRecoveryMode.BATCH,
    });
    const afterCurrent = await work.getRecoveryControl();

    expect({
      afterStale: afterStale.mode,
      afterCurrent: afterCurrent.mode,
    }).toEqual({
      afterStale: RefundRecoveryMode.PROBE,
      afterCurrent: RefundRecoveryMode.BATCH,
    });
  });

  it('BATCH의 뒤쪽 건은 앞 건 조회에 걸린 시간을 반영한 시각으로 조회 담당을 정한다', async () => {
    await resetRecoveryControl();
    const year = recoveryYear--;
    await createQueryFailed(new Date(Date.UTC(year, 0, 1)));
    const later = await createQueryFailed(new Date(Date.UTC(year, 0, 2)));
    const now = new Date(Date.UTC(year, 1, 1));
    const work = app.get(RefundWorkRepository);
    await work.claimRecoveryControl('setup', now, new Date(now.getTime() + 1));
    await work.updateRecoveryControl('setup', {
      mode: RefundRecoveryMode.BATCH,
      batchCutoffAt: now,
    });
    await work.releaseRecoveryControl('setup');
    // 앞 건의 PG 조회가 1.1초 걸린다
    pgGateway.inquireCancel
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ result: 'IN_PROGRESS' }), 1_100),
          ),
      )
      .mockResolvedValue({ result: 'IN_PROGRESS' });

    await app.get(RefundRecoveryService).recoverQueryFailed(now);

    const attempt = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: later.paymentCancelId },
    });
    expect(attempt.lastInquiryAt!.getTime()).toBeGreaterThanOrEqual(
      now.getTime() + 1_000,
    );
  });

  it('개별 확인 재전송은 실행자·시각·개별 확인 재전송임을 거래 로그에 남긴다', async () => {
    const target = await createInquiredBefore(60);
    pgGateway.inquireCancel.mockResolvedValueOnce({
      result: 'NOT_FOUND',
      authoritative: true,
    });
    pgGateway.sendCancel.mockResolvedValueOnce({ result: 'ACCEPTED' });
    const txLog = jest.spyOn(
      app.get(TransactionLoggerService),
      'logTransaction',
    );

    await app
      .get(RefundPgCheckService)
      .check(operator, target.refundId, target.now);

    const logged = txLog.mock.calls
      .map(([log]) => log)
      .find((log) => log.status === 'MANUAL_RESEND');
    txLog.mockRestore();
    expect(logged).toEqual(
      expect.objectContaining({
        type: 'REFUND',
        userId: operator.userId,
        metadata: expect.objectContaining({
          refundId: target.refundId,
          paymentCancelId: target.paymentCancelId,
          requestedAt: target.now.toISOString(),
          resendResult: 'ACCEPTED',
        }) as unknown,
      }),
    );
  });

  it('일반 정기 탐색의 뒤쪽 건은 앞 건 조회에 걸린 시간을 반영한 시각으로 조회 담당을 정한다', async () => {
    const base = isolatedSweepBase();
    await createAwaitingInquiry(0, base);
    const later = await createAwaitingInquiry(0, new Date(base.getTime() + 1));
    // 앞 건의 PG 조회가 1.1초 걸린다
    pgGateway.inquireCancel
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ result: 'IN_PROGRESS' }), 1_100),
          ),
      )
      .mockResolvedValue({ result: 'IN_PROGRESS' });

    await app.get(RefundRecoveryService).sweep(later.dueAt);

    const attempt = await prisma.paymentCancel.findUniqueOrThrow({
      where: { id: later.paymentCancelId },
    });
    expect(attempt.lastInquiryAt!.getTime()).toBeGreaterThanOrEqual(
      later.dueAt.getTime() + 1_000,
    );
  });

  /**
   * 최초 PG 취소 요청이 확정 실패해 조치 필요가 된 환불을 만든다
   * @param failureCode 실패 사유
   * @param resendCount 실패한 요청의 자동 재전송 횟수
   * @returns 환불·실패한 요청·주문 ID
   */
  async function createFailedRefund(
    failureCode: PaymentCancelFailureCode = PaymentCancelFailureCode.SEND_FAILED,
    resendCount = 0,
  ) {
    const pending = await createPendingRefund();
    await prisma.paymentCancel.update({
      where: { id: pending.paymentCancelId },
      data: {
        status: PaymentCancelStatus.FAILED,
        failureCode,
        failedAt: new Date(),
        resendCount,
      },
    });
    await prisma.refund.update({
      where: { id: pending.refundId },
      data: {
        payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
        actionCode: failureCode,
      },
    });
    return pending;
  }

  const manager = () => ({ userId: managerId, role: UserRole.MANAGER });

  describe('MANAGER의 PG 직접 재시도', () => {
    const retryReason = 'PG 연결 설정을 복구해 다시 요청';

    it('확정 실패·지급액 0원이면 같은 금액의 새 PG 취소 요청을 만들어 보내고 이전 실패 기록·이용 종료는 그대로 둔다', async () => {
      const failed = await createFailedRefund();
      pgGateway.sendCancel.mockResolvedValueOnce({ result: 'ACCEPTED' });

      const response = await app
        .get(RefundRetryService)
        .retryByManager(manager(), failed.refundId, {
          reason: retryReason,
          idempotencyKey: `retry-${randomUUID()}`,
        });

      const attempts = await prisma.paymentCancel.findMany({
        where: { refundId: failed.refundId },
        orderBy: { attemptNumber: 'asc' },
      });
      const refund = await prisma.refund.findUniqueOrThrow({
        where: { id: failed.refundId },
      });
      const ticket = await prisma.ticket.findFirstOrThrow({
        where: { orderItemId: failed.orderItemId },
      });
      expect({
        response: { status: response.status, body: response.body },
        attempts: attempts.map((attempt) => ({
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          failureCode: attempt.failureCode,
          amount: attempt.amount,
          requestedById: attempt.requestedById,
          retryReason: attempt.retryReason,
        })),
        sent: pgGateway.sendCancel.mock.calls,
        refund: {
          payoutStatus: refund.payoutStatus,
          payoutMethod: refund.payoutMethod,
          actionCode: refund.actionCode,
        },
        ticket: ticket.status,
      }).toEqual({
        response: {
          status: 202,
          body: {
            refundId: failed.refundId,
            paymentCancelId: attempts[1]?.id,
            payoutStatus: RefundPayoutStatus.PENDING,
          },
        },
        attempts: [
          {
            attemptNumber: 1,
            status: PaymentCancelStatus.FAILED,
            failureCode: PaymentCancelFailureCode.SEND_FAILED,
            amount: refundAmount,
            requestedById: null,
            retryReason: null,
          },
          {
            attemptNumber: 2,
            status: PaymentCancelStatus.REQUESTED,
            failureCode: null,
            amount: refundAmount,
            requestedById: managerId,
            retryReason,
          },
        ],
        sent: [[{ paymentCancelId: attempts[1]?.id, amount: refundAmount }]],
        refund: {
          payoutStatus: RefundPayoutStatus.PENDING,
          payoutMethod: RefundPayoutMethod.PG,
          actionCode: null,
        },
        ticket: TicketStatus.REVOKED,
      });
    });

    it('결제 전체 대상 환불도 재시도하면 대상 상품 없는 새 PG 취소 요청을 만든다', async () => {
      const failed = await createFailedRefund();
      // 같은 결제를 결제 전체 대상 시스템 환불로 바꾼다(승인 금액 불일치 자동 취소와 같은 형태)
      await prisma.paymentCancel.update({
        where: { id: failed.paymentCancelId },
        data: { refundId: null },
      });
      await prisma.refund.update({
        where: { id: failed.refundId },
        data: {
          targetKind: RefundTargetKind.PAYMENT,
          source: RefundSource.SYSTEM,
          orderItemId: null,
          requestedById: null,
        },
      });
      await prisma.paymentCancel.update({
        where: { id: failed.paymentCancelId },
        data: { refundId: failed.refundId, orderItemId: null },
      });
      pgGateway.sendCancel.mockResolvedValueOnce({ result: 'ACCEPTED' });

      const response = await app
        .get(RefundRetryService)
        .retryByManager(manager(), failed.refundId, {
          reason: retryReason,
          idempotencyKey: `retry-${randomUUID()}`,
        });

      const created = await prisma.paymentCancel.findFirst({
        where: { refundId: failed.refundId, attemptNumber: 2 },
      });
      expect({
        status: response.status,
        created: created && [created.status, created.orderItemId],
      }).toEqual({
        status: 202,
        created: [PaymentCancelStatus.REQUESTED, null],
      });
    });

    it('한도를 소진해 실패한 요청을 재시도한 새 요청의 자동 재전송 횟수는 0이고 이전 요청의 횟수는 그대로다', async () => {
      const failed = await createFailedRefund(
        PaymentCancelFailureCode.RETRY_EXHAUSTED,
        5,
      );
      pgGateway.sendCancel.mockResolvedValueOnce({ result: 'ACCEPTED' });

      await app
        .get(RefundRetryService)
        .retryByManager(manager(), failed.refundId, {
          reason: retryReason,
          idempotencyKey: `retry-${randomUUID()}`,
        });

      const attempts = await prisma.paymentCancel.findMany({
        where: { refundId: failed.refundId },
        orderBy: { attemptNumber: 'asc' },
      });
      expect(
        attempts.map((attempt) => ({
          resendCount: attempt.resendCount,
          manualResendCount: attempt.manualResendCount,
        })),
      ).toEqual([
        { resendCount: 5, manualResendCount: 0 },
        { resendCount: 0, manualResendCount: 0 },
      ]);
    });
  });

  describe('실패가 확정된 요청의 개별 확인', () => {
    /**
     * 정해진 사유로 실패한 환불을 개별 확인하고 결과·요청 수·전송 수를 모은다
     * @param failureCode 실패 사유
     * @param inquiry 재조회 결과
     * @returns 확인 결과 요약
     */
    async function checkFailedWith(
      failureCode: PaymentCancelFailureCode,
      inquiry: unknown,
    ) {
      const failed = await createFailedRefund(failureCode);
      pgGateway.inquireCancel.mockResolvedValueOnce(inquiry);
      pgGateway.sendCancel.mockResolvedValueOnce({ result: 'ACCEPTED' });
      const result = await app
        .get(RefundPgCheckService)
        .check(manager(), failed.refundId, new Date());
      const attempts = await prisma.paymentCancel.findMany({
        where: { refundId: failed.refundId },
        orderBy: { attemptNumber: 'asc' },
      });
      return {
        failed,
        summary: {
          checkStatus: result.checkStatus,
          inquiryResult: result.inquiryResult,
          resendResult: result.resendResult,
          attempts: attempts.map((attempt) => attempt.status),
          previousFailure: attempts[0].failureCode,
          inquiries: pgGateway.inquireCancel.mock.calls.length,
          sends: pgGateway.sendCancel.mock.calls.length,
        },
      };
    }

    it('한도 소진으로 실패한 요청을 개별 확인해 PG 미접수가 확인되면 같은 금액의 새 PG 취소 요청을 즉시 보내고 이전 실패 기록은 그대로 둔다', async () => {
      const failed = await createFailedRefund(
        PaymentCancelFailureCode.RETRY_EXHAUSTED,
        5,
      );
      pgGateway.inquireCancel.mockResolvedValueOnce({
        result: 'NOT_FOUND',
        authoritative: true,
      });
      pgGateway.sendCancel.mockResolvedValueOnce({ result: 'ACCEPTED' });

      const result = await app
        .get(RefundPgCheckService)
        .check(manager(), failed.refundId, new Date());

      const attempts = await prisma.paymentCancel.findMany({
        where: { refundId: failed.refundId },
        orderBy: { attemptNumber: 'asc' },
      });
      const refund = await prisma.refund.findUniqueOrThrow({
        where: { id: failed.refundId },
      });
      expect({
        checkStatus: result.checkStatus,
        inquiryResult: result.inquiryResult,
        resendResult: result.resendResult,
        inquired: pgGateway.inquireCancel.mock.calls,
        attempts: attempts.map((attempt) => ({
          status: attempt.status,
          failureCode: attempt.failureCode,
          resendCount: attempt.resendCount,
          amount: attempt.amount,
        })),
        sent: pgGateway.sendCancel.mock.calls,
        payoutStatus: refund.payoutStatus,
      }).toEqual({
        checkStatus: 'CHECKED',
        inquiryResult: 'NOT_FOUND',
        resendResult: 'ACCEPTED',
        inquired: [[{ paymentCancelId: failed.paymentCancelId }]],
        attempts: [
          {
            status: PaymentCancelStatus.FAILED,
            failureCode: PaymentCancelFailureCode.RETRY_EXHAUSTED,
            resendCount: 5,
            amount: refundAmount,
          },
          {
            status: PaymentCancelStatus.REQUESTED,
            failureCode: null,
            resendCount: 0,
            amount: refundAmount,
          },
        ],
        sent: [[{ paymentCancelId: attempts[1]?.id, amount: refundAmount }]],
        payoutStatus: RefundPayoutStatus.PENDING,
      });
    });

    it('전송 전 실패로 실패한 요청을 개별 확인해 PG 미접수가 확인되면 새 PG 취소 요청을 즉시 보낸다', async () => {
      const { summary } = await checkFailedWith(
        PaymentCancelFailureCode.SEND_FAILED,
        { result: 'NOT_FOUND', authoritative: true },
      );

      expect(summary).toEqual({
        checkStatus: 'CHECKED',
        inquiryResult: 'NOT_FOUND',
        resendResult: 'ACCEPTED',
        attempts: [PaymentCancelStatus.FAILED, PaymentCancelStatus.REQUESTED],
        previousFailure: PaymentCancelFailureCode.SEND_FAILED,
        inquiries: 1,
        sends: 1,
      });
    });

    it('PG 거절로 실패한 요청을 개별 확인해 거절 확정이면 새 PG 취소 요청을 즉시 보낸다', async () => {
      const { summary } = await checkFailedWith(
        PaymentCancelFailureCode.PG_REJECTED,
        { result: 'FAILED', reason: '카드사 거절' },
      );

      expect(summary).toEqual({
        checkStatus: 'CHECKED',
        inquiryResult: 'FAILED',
        resendResult: 'ACCEPTED',
        attempts: [PaymentCancelStatus.FAILED, PaymentCancelStatus.REQUESTED],
        previousFailure: PaymentCancelFailureCode.PG_REJECTED,
        inquiries: 1,
        sends: 1,
      });
    });

    it('세 사유 외의 확정 실패(과거 구현의 PG 미도달)는 NO_PENDING_ATTEMPT를 받고 PG는 호출되지 않는다', async () => {
      const { summary } = await checkFailedWith(
        PaymentCancelFailureCode.PG_NOT_REACHED,
        { result: 'NOT_FOUND', authoritative: true },
      );

      expect(summary).toEqual({
        checkStatus: 'NO_PENDING_ATTEMPT',
        inquiryResult: null,
        resendResult: null,
        attempts: [PaymentCancelStatus.FAILED],
        previousFailure: PaymentCancelFailureCode.PG_NOT_REACHED,
        inquiries: 0,
        sends: 0,
      });
    });

    it('실패한 요청의 재조회가 조회 오류이면 새 요청을 만들지 않고 기존 실패를 유지하며 결과 확인 불가를 안내한다', async () => {
      const failed = await createFailedRefund(
        PaymentCancelFailureCode.RETRY_EXHAUSTED,
      );
      pgGateway.inquireCancel.mockResolvedValueOnce({
        result: 'QUERY_ERROR',
        reason: 'PG 조회 지연',
      });

      const result = await app
        .get(RefundPgCheckService)
        .check(manager(), failed.refundId, new Date());

      const attempts = await prisma.paymentCancel.findMany({
        where: { refundId: failed.refundId },
      });
      const refund = await prisma.refund.findUniqueOrThrow({
        where: { id: failed.refundId },
      });
      expect({
        checkStatus: result.checkStatus,
        inquiryResult: result.inquiryResult,
        lastInquiryFailed: result.lastInquiryFailed,
        attempts: attempts.map((attempt) => [
          attempt.status,
          attempt.failureCode,
        ]),
        payoutStatus: refund.payoutStatus,
        sends: pgGateway.sendCancel.mock.calls.length,
      }).toEqual({
        checkStatus: 'CHECKED',
        inquiryResult: 'QUERY_ERROR',
        lastInquiryFailed: true,
        attempts: [
          [
            PaymentCancelStatus.FAILED,
            PaymentCancelFailureCode.RETRY_EXHAUSTED,
          ],
        ],
        payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
        sends: 0,
      });
    });

    /**
     * 실패한 요청의 재조회가 기존 실패와 모순될 때 저장 상태를 모은다
     * @param inquiry 모순되는 재조회 결과
     * @returns 모순 기록·알림·요청 수 요약
     */
    async function checkContradiction(inquiry: unknown) {
      const failed = await createFailedRefund(
        PaymentCancelFailureCode.RETRY_EXHAUSTED,
      );
      pgGateway.inquireCancel.mockResolvedValueOnce(inquiry);

      const result = await app
        .get(RefundPgCheckService)
        .check(manager(), failed.refundId, new Date());

      const refund = await prisma.refund.findUniqueOrThrow({
        where: { id: failed.refundId },
        include: { notifications: true, paymentCancels: true },
      });
      return {
        checkStatus: result.checkStatus,
        actionCode: refund.actionCode,
        reviewRequired: refund.reviewRequired,
        paidAmount: refund.paidAmount,
        operatorConflicts: refund.notifications.filter(
          (notification) =>
            notification.audience === RefundNotificationAudience.OPERATOR &&
            notification.kind === 'PG_RESULT_CONFLICT',
        ).length,
        attempts: refund.paymentCancels.map((attempt) => attempt.status),
        sends: pgGateway.sendCancel.mock.calls.length,
      };
    }

    /** 모순 결과가 남기는 저장 상태 */
    const contradictionRecorded = {
      checkStatus: 'CHECKED',
      actionCode: 'PG_RESULT_CONFLICT',
      reviewRequired: true,
      paidAmount: 0,
      operatorConflicts: 1,
      attempts: [PaymentCancelStatus.FAILED],
      sends: 0,
    };

    it('실패한 요청의 재조회가 취소 성공이면 PG_RESULT_CONFLICT와 운영자 알림을 기록하고 새 요청을 만들지 않는다', async () => {
      expect(
        await checkContradiction({
          result: 'SUCCEEDED',
          pgTransactionId: `pg-cancel-${randomUUID()}`,
          cancelledAmount: refundAmount,
        }),
      ).toEqual(contradictionRecorded);
    });

    it('실패한 요청의 재조회가 처리 중이면 PG_RESULT_CONFLICT와 운영자 알림을 기록하고 새 요청을 만들지 않는다', async () => {
      expect(await checkContradiction({ result: 'IN_PROGRESS' })).toEqual(
        contradictionRecorded,
      );
    });

    it('지급 방식이 별도 지급(MANUAL)인 환불은 개별 확인으로 새 요청을 만들지 않고 PG를 호출하지 않는다', async () => {
      const failed = await createFailedRefund(
        PaymentCancelFailureCode.RETRY_EXHAUSTED,
      );
      // 별도 지급 예약을 실패로 종료해 지급 방식이 MANUAL로 남은 환불
      await prisma.refund.update({
        where: { id: failed.refundId },
        data: { payoutMethod: RefundPayoutMethod.MANUAL },
      });
      pgGateway.inquireCancel.mockResolvedValueOnce({
        result: 'NOT_FOUND',
        authoritative: true,
      });

      const result = await app
        .get(RefundPgCheckService)
        .check(manager(), failed.refundId, new Date());

      const attempts = await prisma.paymentCancel.count({
        where: { refundId: failed.refundId },
      });
      expect({
        checkStatus: result.checkStatus,
        attempts,
        inquiries: pgGateway.inquireCancel.mock.calls.length,
        sends: pgGateway.sendCancel.mock.calls.length,
      }).toEqual({
        checkStatus: 'NO_PENDING_ATTEMPT',
        attempts: 1,
        inquiries: 0,
        sends: 0,
      });
    });

    it('개별 확인으로 만든 새 요청은 실패한 요청의 최근 조회 시각을 승계하고 실행자·개별 확인 재시도임을 기록한다', async () => {
      const failed = await createFailedRefund(
        PaymentCancelFailureCode.RETRY_EXHAUSTED,
      );
      pgGateway.inquireCancel.mockResolvedValueOnce({
        result: 'NOT_FOUND',
        authoritative: true,
      });
      pgGateway.sendCancel.mockResolvedValueOnce({ result: 'ACCEPTED' });
      const now = new Date();

      await app
        .get(RefundPgCheckService)
        .check(manager(), failed.refundId, now);

      const created = await prisma.paymentCancel.findFirstOrThrow({
        where: { refundId: failed.refundId, attemptNumber: 2 },
      });
      expect({
        lastInquiryAt: created.lastInquiryAt?.getTime(),
        requestedById: created.requestedById,
        retryReason: created.retryReason,
        manualResendCount: created.manualResendCount,
      }).toEqual({
        lastInquiryAt: now.getTime(),
        requestedById: managerId,
        retryReason: '개별 확인에서 PG 미접수 확인 후 재시도',
        manualResendCount: 0,
      });
    });
  });

  describe('별도 환불금 지급', () => {
    /** 장기 미확인 알림 테스트마다 겹치지 않게 내려가는 예약 연도 */
    let manualAlertYear = 1975;
    const reserveReason = 'PG 원인 확인 후 계좌 이체로 지급';

    it('별도 지급 예약은 미지급액과 같은 금액을 RESERVED로 저장하고 환불 지급 방식을 MANUAL로 바꾼다', async () => {
      const failed = await createFailedRefund(
        PaymentCancelFailureCode.PG_REJECTED,
      );

      const response = await app
        .get(RefundOperationsService)
        .reserveManualPayout(manager(), failed.refundId, {
          amount: refundAmount,
          reason: reserveReason,
          idempotencyKey: `reserve-${randomUUID()}`,
        });

      const payouts = await prisma.manualRefundPayout.findMany({
        where: { refundId: failed.refundId },
      });
      const refund = await prisma.refund.findUniqueOrThrow({
        where: { id: failed.refundId },
      });
      expect({
        response: { status: response.status, body: response.body },
        payouts: payouts.map((payout) => ({
          status: payout.status,
          amount: payout.amount,
          reservedById: payout.reservedById,
          reason: payout.reason,
        })),
        refund: [refund.payoutStatus, refund.payoutMethod, refund.paidAmount],
      }).toEqual({
        response: {
          status: 201,
          body: {
            refundId: failed.refundId,
            payoutId: payouts[0]?.id,
            status: ManualRefundPayoutStatus.RESERVED,
            amount: refundAmount,
          },
        },
        payouts: [
          {
            status: ManualRefundPayoutStatus.RESERVED,
            amount: refundAmount,
            reservedById: managerId,
            reason: reserveReason,
          },
        ],
        refund: [
          RefundPayoutStatus.ACTION_REQUIRED,
          RefundPayoutMethod.MANUAL,
          0,
        ],
      });
    });

    /**
     * PG 거절로 실패한 환불에 별도 지급을 예약한다
     * @returns 환불·예약 ID
     */
    async function reservedPayout() {
      const failed = await createFailedRefund(
        PaymentCancelFailureCode.PG_REJECTED,
      );
      const reserved = await app
        .get(RefundOperationsService)
        .reserveManualPayout(manager(), failed.refundId, {
          amount: refundAmount,
          reason: reserveReason,
          idempotencyKey: `reserve-${randomUUID()}`,
        });
      return { ...failed, payoutId: reserved.body.payoutId };
    }

    /**
     * 예약한 별도 지급의 실제 지급 결과를 등록한다
     * @param target 환불·예약
     * @param overrides 바꿀 입력
     * @returns 응답
     */
    function confirm(
      target: { refundId: string; payoutId: string },
      overrides: Partial<{
        amount: number;
        externalTransactionId: string;
        evidenceReference: string | undefined;
        idempotencyKey: string;
      }> = {},
    ) {
      return app
        .get(RefundOperationsService)
        .confirmManualPayout(manager(), target.refundId, target.payoutId, {
          amount: refundAmount,
          paidAt: new Date(Date.now() - 60_000),
          externalTransactionId: `bank-${randomUUID()}`,
          evidenceReference: '이체 확인증 2026-10-29',
          idempotencyKey: `confirm-${randomUUID()}`,
          ...overrides,
        });
    }

    it('지급 결과 등록은 예약과 같은 금액·거래 ID·증빙이 있으면 지급 성공·지급액 합산·원장을 함께 저장하고 환불을 지급 완료로 바꾼다', async () => {
      const reserved = await reservedPayout();
      const externalTransactionId = `bank-${randomUUID()}`;

      const response = await confirm(reserved, { externalTransactionId });

      const payout = await prisma.manualRefundPayout.findUniqueOrThrow({
        where: { id: reserved.payoutId },
      });
      const refund = await prisma.refund.findUniqueOrThrow({
        where: { id: reserved.refundId },
      });
      const ledgers = await prisma.ledger.findMany({
        where: { refundId: reserved.refundId },
      });
      expect({
        status: response.status,
        payout: [
          payout.status,
          payout.externalTransactionId,
          payout.confirmedById,
        ],
        refund: [refund.paidAmount, refund.payoutStatus],
        ledgers: ledgers.map((ledger) => [
          ledger.amount,
          ledger.manualRefundPayoutId,
        ]),
      }).toEqual({
        status: 200,
        payout: [
          ManualRefundPayoutStatus.SUCCEEDED,
          externalTransactionId,
          managerId,
        ],
        refund: [refundAmount, RefundPayoutStatus.PAID],
        ledgers: [[-refundAmount, reserved.payoutId]],
      });
    });

    it('지급 증빙이 없으면 MANUAL_PAYOUT_EVIDENCE_REQUIRED로 거절되고 예약은 그대로다', async () => {
      const reserved = await reservedPayout();

      const rejected = await confirm(reserved, {
        evidenceReference: undefined,
      }).catch((error: { code?: string }) => error.code);

      const payout = await prisma.manualRefundPayout.findUniqueOrThrow({
        where: { id: reserved.payoutId },
      });
      expect({ rejected, status: payout.status }).toEqual({
        rejected: 'MANUAL_PAYOUT_EVIDENCE_REQUIRED',
        status: ManualRefundPayoutStatus.RESERVED,
      });
    });

    it('같은 지급 결과를 다른 멱등 키로 다시 등록하면 최초 결과를 받고 지급액·원장은 더해지지 않는다', async () => {
      const reserved = await reservedPayout();
      const externalTransactionId = `bank-${randomUUID()}`;
      const first = await confirm(reserved, { externalTransactionId });

      const repeated = await confirm(reserved, { externalTransactionId });

      const refund = await prisma.refund.findUniqueOrThrow({
        where: { id: reserved.refundId },
      });
      const ledgers = await prisma.ledger.count({
        where: { refundId: reserved.refundId },
      });
      expect({
        repeated: { status: repeated.status, body: repeated.body },
        paidAmount: refund.paidAmount,
        ledgers,
      }).toEqual({
        repeated: { status: first.status, body: first.body },
        paidAmount: refundAmount,
        ledgers: 1,
      });
    });

    it('다른 환불의 별도 지급에서 이미 쓴 거래 ID로 등록하면 MANUAL_PAYOUT_REFERENCE_REUSED로 거절된다', async () => {
      const first = await reservedPayout();
      const second = await reservedPayout();
      const externalTransactionId = `bank-${randomUUID()}`;
      await confirm(first, { externalTransactionId });

      const rejected = await confirm(second, { externalTransactionId }).catch(
        (error: { code?: string }) => error.code,
      );

      expect(rejected).toBe('MANUAL_PAYOUT_REFERENCE_REUSED');
    });

    it('환불에 속하지 않는 별도 지급 예약 ID로 결과를 등록하면 MANUAL_PAYOUT_NOT_FOUND로 거절된다', async () => {
      const reserved = await reservedPayout();
      const other = await reservedPayout();

      const rejected = await confirm({
        refundId: reserved.refundId,
        payoutId: other.payoutId,
      }).catch((error: { code?: string }) => error.code);

      expect(rejected).toBe('MANUAL_PAYOUT_NOT_FOUND');
    });

    it('이미 실패로 종료된 예약의 결과 등록은 MANUAL_PAYOUT_STATE_CONFLICT로 거절된다', async () => {
      const reserved = await reservedPayout();
      await prisma.manualRefundPayout.update({
        where: { id: reserved.payoutId },
        data: { status: ManualRefundPayoutStatus.FAILED },
      });

      const rejected = await confirm(reserved).catch(
        (error: { code?: string }) => error.code,
      );

      expect(rejected).toBe('MANUAL_PAYOUT_STATE_CONFLICT');
    });

    it('결과 등록 금액이 예약 금액과 다르면 REFUND_OUTSTANDING_AMOUNT_MISMATCH로 거절되고 예약은 그대로다', async () => {
      const reserved = await reservedPayout();

      const rejected = await confirm(reserved, {
        amount: refundAmount - 1,
      }).catch((error: { code?: string }) => error.code);

      const payout = await prisma.manualRefundPayout.findUniqueOrThrow({
        where: { id: reserved.payoutId },
      });
      expect({ rejected, status: payout.status }).toEqual({
        rejected: 'REFUND_OUTSTANDING_AMOUNT_MISMATCH',
        status: ManualRefundPayoutStatus.RESERVED,
      });
    });

    it('PG가 적게 취소한 환불의 부족액 지급 결과를 등록하면 부족 지급 검토도 함께 완료하고 지급 완료가 된다', async () => {
      const shortfall = 3000;
      const pending = await createPendingRefund();
      await succeed(pending.paymentCancelId, refundAmount - shortfall);
      const reserved = await app
        .get(RefundOperationsService)
        .reserveManualPayout(manager(), pending.refundId, {
          amount: shortfall,
          reason: reserveReason,
          idempotencyKey: `reserve-${randomUUID()}`,
        });
      const evidenceReference = '부족액 이체 확인증';

      await confirm(
        { refundId: pending.refundId, payoutId: reserved.body.payoutId },
        { amount: shortfall, evidenceReference },
      );

      const refund = await prisma.refund.findUniqueOrThrow({
        where: { id: pending.refundId },
      });
      const ledgers = await prisma.ledger.findMany({
        where: { refundId: pending.refundId },
        orderBy: { amount: 'asc' },
      });
      expect({
        refund: {
          paidAmount: refund.paidAmount,
          payoutStatus: refund.payoutStatus,
          reviewRequired: refund.reviewRequired,
          reviewedById: refund.reviewedById,
          reviewEvidenceReference: refund.reviewEvidenceReference,
          reviewedAt: refund.reviewedAt instanceof Date,
        },
        ledgers: ledgers.map((ledger) => ledger.amount),
      }).toEqual({
        refund: {
          paidAmount: refundAmount,
          payoutStatus: RefundPayoutStatus.PAID,
          reviewRequired: false,
          reviewedById: managerId,
          reviewEvidenceReference: evidenceReference,
          reviewedAt: true,
        },
        ledgers: [-(refundAmount - shortfall), -shortfall],
      });
    });

    /**
     * 예약한 별도 지급을 실제로 지급하지 않았다고 확인한다
     * @param target 환불·예약
     * @param evidenceReference 미지급 확인 근거(없으면 생략)
     * @returns 응답
     */
    function notPaid(
      target: { refundId: string; payoutId: string },
      evidenceReference: string | undefined,
    ) {
      return app
        .get(RefundOperationsService)
        .markManualPayoutNotPaid(manager(), target.refundId, target.payoutId, {
          reason: '은행 이체를 실행하지 않았음을 확인',
          evidenceReference,
          idempotencyKey: `not-paid-${randomUUID()}`,
        });
    }

    it('미지급 확인은 증빙·사유가 있으면 예약을 실패로 종료하고 환불은 조치 필요로 남기며 지급액은 그대로다', async () => {
      const reserved = await reservedPayout();
      const evidence = '은행 거래 내역에 출금 없음';

      const response = await notPaid(reserved, evidence);

      const payout = await prisma.manualRefundPayout.findUniqueOrThrow({
        where: { id: reserved.payoutId },
      });
      const refund = await prisma.refund.findUniqueOrThrow({
        where: { id: reserved.refundId },
      });
      expect({
        status: response.status,
        payout: [payout.status, payout.notPaidEvidence, payout.failureReason],
        refund: [refund.payoutStatus, refund.paidAmount, refund.payoutMethod],
      }).toEqual({
        status: 200,
        payout: [
          ManualRefundPayoutStatus.FAILED,
          evidence,
          '은행 이체를 실행하지 않았음을 확인',
        ],
        refund: [
          RefundPayoutStatus.ACTION_REQUIRED,
          0,
          RefundPayoutMethod.MANUAL,
        ],
      });
    });

    it('미지급 확인에 증빙이 없으면 MANUAL_PAYOUT_EVIDENCE_REQUIRED로 거절되고 예약은 그대로다', async () => {
      const reserved = await reservedPayout();

      const rejected = await notPaid(reserved, undefined).catch(
        (error: { code?: string }) => error.code,
      );

      const payout = await prisma.manualRefundPayout.findUniqueOrThrow({
        where: { id: reserved.payoutId },
      });
      expect({ rejected, status: payout.status }).toEqual({
        rejected: 'MANUAL_PAYOUT_EVIDENCE_REQUIRED',
        status: ManualRefundPayoutStatus.RESERVED,
      });
    });

    /**
     * PG 실제 취소액이 확정 금액과 다른 환불을 만든다
     * @param actualAmount PG가 실제로 취소한 금액
     * @returns 환불 ID
     */
    async function mismatchedRefund(actualAmount: number) {
      const pending = await createPendingRefund();
      await succeed(pending.paymentCancelId, actualAmount);
      return pending.refundId;
    }

    /**
     * 초과 취소 검토 결과를 등록한다
     * @param refundId 환불
     * @returns 응답
     */
    function reviewAmount(refundId: string) {
      return app
        .get(RefundOperationsService)
        .reviewRefundAmount(manager(), refundId, {
          reason: 'PG 초과 취소 확인, 회수는 후속 처리',
          evidenceReference: 'PG 정산 내역 2026-10-29',
          idempotencyKey: `review-${randomUUID()}`,
        });
    }

    it('초과 취소 검토 등록은 미지급액이 0이면 검토 기록을 남기고 지급 완료로 바꾸며 확정 금액·실제액·원장은 그대로 둔다', async () => {
      const overpaid = refundAmount + 2000;
      const refundId = await mismatchedRefund(overpaid);

      const response = await reviewAmount(refundId);

      const refund = await prisma.refund.findUniqueOrThrow({
        where: { id: refundId },
      });
      const ledgers = await prisma.ledger.findMany({ where: { refundId } });
      expect({
        status: response.status,
        refund: {
          amount: refund.amount,
          paidAmount: refund.paidAmount,
          payoutStatus: refund.payoutStatus,
          reviewRequired: refund.reviewRequired,
          reviewedById: refund.reviewedById,
          reviewReason: refund.reviewReason,
          reviewEvidenceReference: refund.reviewEvidenceReference,
        },
        ledgers: ledgers.map((ledger) => ledger.amount),
      }).toEqual({
        status: 200,
        refund: {
          amount: refundAmount,
          paidAmount: overpaid,
          payoutStatus: RefundPayoutStatus.PAID,
          reviewRequired: false,
          reviewedById: managerId,
          reviewReason: 'PG 초과 취소 확인, 회수는 후속 처리',
          reviewEvidenceReference: 'PG 정산 내역 2026-10-29',
        },
        ledgers: [-overpaid],
      });
    });

    it('부족액이 남은 환불의 검토 등록은 REFUND_AMOUNT_REVIEW_INCOMPLETE로 거절된다', async () => {
      const refundId = await mismatchedRefund(refundAmount - 3000);

      const rejected = await reviewAmount(refundId).catch(
        (error: { code?: string }) => error.code,
      );

      expect(rejected).toBe('REFUND_AMOUNT_REVIEW_INCOMPLETE');
    });

    /** 별도 지급 장기 미확인 알림 기준(초, 설정 기본값) */
    const manualConfirmAlertSeconds = 3600;

    /**
     * 예약 시각을 과거로 옮긴 별도 지급 예약을 만든다(다른 테스트의 예약과 겹치지 않는 시각)
     * @returns 환불·예약 ID와 예약 시각
     */
    async function oldReservation() {
      const reserved = await reservedPayout();
      const reservedAt = new Date(Date.UTC(manualAlertYear--, 0, 1));
      await prisma.manualRefundPayout.update({
        where: { id: reserved.payoutId },
        data: { reservedAt },
      });
      return { ...reserved, reservedAt };
    }

    /**
     * 예약의 장기 미확인 알림 수를 센다
     * @param payoutId 예약
     * @returns 알림 수
     */
    function unconfirmedAlerts(payoutId: string) {
      return prisma.refundNotification.count({
        where: {
          manualRefundPayoutId: payoutId,
          kind: 'MANUAL_CONFIRMATION_REQUIRED',
          audience: RefundNotificationAudience.OPERATOR,
        },
      });
    }

    it('별도 지급 예약 후 3600초가 지나면 운영자에게 미확인 알림 1건을 남기고 예약은 유지한다', async () => {
      const reserved = await oldReservation();

      await app
        .get(RefundOperationsService)
        .alertUnconfirmedManualPayouts(
          new Date(
            reserved.reservedAt.getTime() + manualConfirmAlertSeconds * 1000,
          ),
        );

      const payout = await prisma.manualRefundPayout.findUniqueOrThrow({
        where: { id: reserved.payoutId },
      });
      expect({
        alerts: await unconfirmedAlerts(reserved.payoutId),
        status: payout.status,
      }).toEqual({ alerts: 1, status: ManualRefundPayoutStatus.RESERVED });
    });

    it('별도 지급 예약 후 3599초에는 미확인 알림을 남기지 않는다', async () => {
      const reserved = await oldReservation();

      await app
        .get(RefundOperationsService)
        .alertUnconfirmedManualPayouts(
          new Date(
            reserved.reservedAt.getTime() +
              (manualConfirmAlertSeconds - 1) * 1000,
          ),
        );

      expect(await unconfirmedAlerts(reserved.payoutId)).toBe(0);
    });

    it('정기 탐색이 기준 시간 뒤 반복돼도 별도 지급 미확인 알림은 1건이고 예약은 유지된다', async () => {
      const reserved = await oldReservation();
      // 같은 시각 이전에 조회 예정인 다른 테스트 데이터가 있어도 조회가 끝나도록 처리 중으로 응답한다
      pgGateway.inquireCancel.mockResolvedValue({ result: 'IN_PROGRESS' });
      const after = new Date(
        reserved.reservedAt.getTime() + manualConfirmAlertSeconds * 1000,
      );
      const recovery = app.get(RefundRecoveryService);

      await recovery.sweep(after);
      await recovery.sweep(new Date(after.getTime() + 600_000));

      const payout = await prisma.manualRefundPayout.findUniqueOrThrow({
        where: { id: reserved.payoutId },
      });
      expect({
        alerts: await unconfirmedAlerts(reserved.payoutId),
        status: payout.status,
      }).toEqual({ alerts: 1, status: ManualRefundPayoutStatus.RESERVED });
    });
  });
});
