// src/prisma/refund-constraints.integration.spec.ts
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  LedgerStatus,
  RefundIdempotencyStatus,
  RefundNotificationAudience,
  ManualRefundPayoutStatus,
  PaymentCancelStatus,
  PaymentType,
  Prisma,
  RefundDecisionStatus,
  RefundPayoutStatus,
  RefundSource,
  RefundTargetKind,
  TicketType,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';
import { PrismaModule } from './prisma.module';

/**
 * 환불 저장 모델의 DB 제약 통합 테스트 (specs/002-refund-completion data-model §6·§8)
 * - 서비스 검증과 별개로 DB가 중복·음수 기록을 거부하는지 실제 PostgreSQL에서 확인한다
 * - 테스트마다 새 주문 항목·결제를 만들어 서로 간섭하지 않게 하고, afterAll에서 자기 데이터만 지운다
 */
describe('환불 저장 모델 DB 제약', () => {
  let prisma: PrismaService;

  // 정리 대상 식별자
  let userId: string;
  let shopId: string;
  let productId: string;
  const orderIds: string[] = [];

  /** 고유 위반 오류 코드 (Prisma) */
  const uniqueViolation = 'P2002';

  /**
   * 새 주문·주문 항목·결제를 만든다
   * @returns 주문·주문 항목·결제 ID
   */
  async function createPaidItem(): Promise<{
    orderId: string;
    orderItemId: string;
    paymentId: string;
  }> {
    // 주문과 상품 1건
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
        ticketType: TicketType.PERIOD,
        originalAmount: 10000,
        discountAmount: 0,
        amount: 10000,
        purchasedDurationDays: 30,
        usableDays: 30,
      },
    });

    // 결제
    const payment = await prisma.payment.create({
      data: { orderId: order.id, type: PaymentType.CARD, amount: 10000 },
    });
    return {
      orderId: order.id,
      orderItemId: orderItem.id,
      paymentId: payment.id,
    };
  }

  /**
   * 유효한 신규 고객 환불(상품 대상, 확정) 저장 값을 만든다
   * @param target 결제·주문 항목
   * @param overrides 바꿀 필드
   * @returns Refund 생성 데이터
   */
  function acceptedRefund(
    target: { paymentId: string; orderItemId: string | null },
    overrides: Partial<Prisma.RefundUncheckedCreateInput> = {},
  ): Prisma.RefundUncheckedCreateInput {
    const now = new Date();
    return {
      paymentId: target.paymentId,
      orderItemId: target.orderItemId,
      targetKind: RefundTargetKind.ORDER_ITEM,
      source: RefundSource.CUSTOMER,
      decisionStatus: RefundDecisionStatus.ACCEPTED,
      policyVersion: 'v0.4',
      amount: 10000,
      payoutStatus: RefundPayoutStatus.PENDING,
      requestedAt: now,
      acceptedAt: now,
      terminatedAt: now,
      requestedById: userId,
      terminationConsentedAt: now,
      ...overrides,
    };
  }

  /**
   * 새 결제·주문 항목에 확정된 상품 대상 환불을 만든다
   * @returns 환불과 그 주문·결제·주문 항목 ID
   */
  async function createAcceptedRefund(): Promise<{
    refundId: string;
    orderId: string;
    paymentId: string;
    orderItemId: string;
  }> {
    const target = await createPaidItem();
    const refund = await prisma.refund.create({ data: acceptedRefund(target) });
    return { refundId: refund.id, ...target };
  }

  /**
   * 환불 아래의 PG 취소 요청 저장 값을 만든다
   * @param refund 소속 환불과 그 결제·주문 항목
   * @param overrides 바꿀 필드
   * @returns PaymentCancel 생성 데이터
   */
  function paymentCancelAttempt(
    refund: { refundId: string; paymentId: string; orderItemId: string },
    overrides: Partial<Prisma.PaymentCancelUncheckedCreateInput> = {},
  ): Prisma.PaymentCancelUncheckedCreateInput {
    return {
      refundId: refund.refundId,
      paymentId: refund.paymentId,
      orderItemId: refund.orderItemId,
      attemptNumber: 1,
      amount: 10000,
      status: PaymentCancelStatus.REQUESTED,
      requestedAt: new Date(),
      ...overrides,
    };
  }

  /**
   * 환불의 별도 환불금 지급 예약 저장 값을 만든다
   * @param refundId 소속 환불
   * @param overrides 바꿀 필드
   * @returns ManualRefundPayout 생성 데이터
   */
  function manualPayout(
    refundId: string,
    overrides: Partial<Prisma.ManualRefundPayoutUncheckedCreateInput> = {},
  ): Prisma.ManualRefundPayoutUncheckedCreateInput {
    return {
      refundId,
      status: ManualRefundPayoutStatus.RESERVED,
      amount: 10000,
      reservedById: userId,
      reservedAt: new Date(),
      reason: 'PG 결제 취소 실패로 별도 지급',
      ...overrides,
    };
  }

  /**
   * 환불 원장 저장 값을 만든다(기본: 지급 연결 없는 0원 원장)
   * @param refund 소속 환불과 그 주문
   * @param overrides 바꿀 필드
   * @returns Ledger 생성 데이터
   */
  function refundLedger(
    refund: { refundId: string; orderId: string },
    overrides: Partial<Prisma.LedgerUncheckedCreateInput> = {},
  ): Prisma.LedgerUncheckedCreateInput {
    return {
      shopId,
      orderId: refund.orderId,
      refundId: refund.refundId,
      amount: 0,
      status: LedgerStatus.RELEASABLE,
      ...overrides,
    };
  }

  /**
   * 환불 알림 저장 값을 만든다(기본: 매장 범위 알림)
   * @param refundId 소속 환불
   * @param overrides 바꿀 필드
   * @returns RefundNotification 생성 데이터
   */
  function refundNotification(
    refundId: string,
    overrides: Partial<Prisma.RefundNotificationUncheckedCreateInput> = {},
  ): Prisma.RefundNotificationUncheckedCreateInput {
    return {
      refundId,
      kind: 'REFUND_ACCEPTED',
      audience: RefundNotificationAudience.SHOP,
      shopId,
      eventKey: `refund-accepted:${refundId}`,
      ...overrides,
    };
  }

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();
    prisma = module.get<PrismaService>(PrismaService);

    // 사용자·매장·상품 준비
    const suffix = randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: {
        email: `refund-constraints-${suffix}@test.com`,
        role: UserRole.USER,
        password: 'hashed',
      },
    });
    userId = user.id;
    const shop = await prisma.shop.create({
      data: { name: `환불제약검증매장-${suffix}` },
    });
    shopId = shop.id;
    const product = await prisma.product.create({
      data: {
        name: `환불제약검증상품-${suffix}`,
        ticketType: TicketType.PERIOD,
        amount: 10000,
        shopId,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    // FK 역순으로 자기 데이터만 지운다
    const byOrder = { orderId: { in: orderIds } };
    const byRefund = { refund: { payment: byOrder } };
    await prisma.ledger.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.refundNotificationReceipt.deleteMany({
      where: { notification: byRefund },
    });
    await prisma.refundNotification.deleteMany({ where: byRefund });
    await prisma.refundIdempotencyRecord.deleteMany({
      where: { requesterId: userId },
    });
    await prisma.manualRefundPayout.deleteMany({
      where: { refund: { payment: byOrder } },
    });
    await prisma.paymentCancel.deleteMany({ where: { payment: byOrder } });
    await prisma.refund.deleteMany({ where: { payment: byOrder } });
    await prisma.payment.deleteMany({ where: byOrder });
    await prisma.orderItem.deleteMany({ where: byOrder });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe('Refund', () => {
    it('같은 주문 항목에 확정된 상품 대상 환불을 두 번째로 저장하면 고유 위반으로 실패한다', async () => {
      const target = await createPaidItem();
      await prisma.refund.create({ data: acceptedRefund(target) });

      await expect(
        prisma.refund.create({ data: acceptedRefund(target) }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });

    it('같은 주문 항목이라도 과거 거절 이력은 확정된 환불과 함께 저장된다', async () => {
      const target = await createPaidItem();
      await prisma.refund.create({ data: acceptedRefund(target) });

      const legacy = await prisma.refund.create({
        data: acceptedRefund(target, {
          source: RefundSource.LEGACY_UNKNOWN,
          decisionStatus: RefundDecisionStatus.LEGACY_REJECTED,
          policyVersion: 'LEGACY',
          payoutStatus: RefundPayoutStatus.NOT_APPLICABLE,
          acceptedAt: null,
          requestedById: null,
          terminationConsentedAt: null,
        }),
      });

      expect(legacy.decisionStatus).toBe(RefundDecisionStatus.LEGACY_REJECTED);
    });

    it('같은 결제에 확정된 결제 전체 대상 환불을 두 번째로 저장하면 고유 위반으로 실패한다', async () => {
      const { paymentId } = await createPaidItem();
      const paymentRefund = acceptedRefund(
        { paymentId, orderItemId: null },
        {
          targetKind: RefundTargetKind.PAYMENT,
          source: RefundSource.SYSTEM,
          requestedById: null,
          terminatedAt: null,
          terminationConsentedAt: null,
        },
      );
      await prisma.refund.create({ data: paymentRefund });

      await expect(
        prisma.refund.create({ data: paymentRefund }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });

    it('확정된 환불 금액이 -1이면 저장이 실패한다', async () => {
      const target = await createPaidItem();

      await expect(
        prisma.refund.create({ data: acceptedRefund(target, { amount: -1 }) }),
      ).rejects.toThrow(/refunds_amount_check/);
    });

    it('확정된 환불 금액이 0이면 저장된다', async () => {
      const target = await createPaidItem();

      const refund = await prisma.refund.create({
        data: acceptedRefund(target, {
          amount: 0,
          payoutStatus: RefundPayoutStatus.PAID,
        }),
      });

      expect(refund.amount).toBe(0);
    });

    it('환불금 지급 합계가 -1이면 저장이 실패한다', async () => {
      const target = await createPaidItem();

      await expect(
        prisma.refund.create({
          data: acceptedRefund(target, { paidAmount: -1 }),
        }),
      ).rejects.toThrow(/refunds_paid_amount_check/);
    });

    it('확정된 환불의 지급 상태가 NOT_APPLICABLE이면 저장이 실패한다', async () => {
      const target = await createPaidItem();

      await expect(
        prisma.refund.create({
          data: acceptedRefund(target, {
            payoutStatus: RefundPayoutStatus.NOT_APPLICABLE,
          }),
        }),
      ).rejects.toThrow(/refunds_not_applicable_legacy_check/);
    });

    it('상품 대상 환불의 주문 항목 ID가 없으면 저장이 실패한다', async () => {
      const { paymentId } = await createPaidItem();

      await expect(
        prisma.refund.create({
          data: acceptedRefund({ paymentId, orderItemId: null }),
        }),
      ).rejects.toThrow(/refunds_order_item_target_check/);
    });

    it('결제 전체 대상 환불에 주문 항목 ID가 있으면 저장이 실패한다', async () => {
      const target = await createPaidItem();

      await expect(
        prisma.refund.create({
          data: acceptedRefund(target, {
            targetKind: RefundTargetKind.PAYMENT,
            source: RefundSource.SYSTEM,
            requestedById: null,
            terminatedAt: null,
            terminationConsentedAt: null,
          }),
        }),
      ).rejects.toThrow(/refunds_payment_target_item_check/);
    });

    it('결제 전체 대상 환불의 경로가 SYSTEM이 아니면 저장이 실패한다', async () => {
      const { paymentId } = await createPaidItem();

      await expect(
        prisma.refund.create({
          data: acceptedRefund(
            { paymentId, orderItemId: null },
            { targetKind: RefundTargetKind.PAYMENT, terminatedAt: null },
          ),
        }),
      ).rejects.toThrow(/refunds_payment_target_source_check/);
    });

    it('확정된 고객 환불의 실행자가 없으면 저장이 실패한다', async () => {
      const target = await createPaidItem();

      await expect(
        prisma.refund.create({
          data: acceptedRefund(target, { requestedById: null }),
        }),
      ).rejects.toThrow(/refunds_accepted_actor_check/);
    });

    it('확정된 매장 환불의 이용 종료 동의 시각이 없으면 저장이 실패한다', async () => {
      const target = await createPaidItem();

      await expect(
        prisma.refund.create({
          data: acceptedRefund(target, {
            source: RefundSource.STORE,
            terminationConsentedAt: null,
          }),
        }),
      ).rejects.toThrow(/refunds_accepted_consent_check/);
    });

    it('확정된 환불의 확정 시각이 없으면 저장이 실패한다', async () => {
      const target = await createPaidItem();

      await expect(
        prisma.refund.create({
          data: acceptedRefund(target, { acceptedAt: null }),
        }),
      ).rejects.toThrow(/refunds_accepted_at_check/);
    });
  });

  describe('PaymentCancel', () => {
    it('U400 시도 번호가 없는 PG 취소 요청은 DB가 거절한다', async () => {
      const target = await createAcceptedRefund();
      const id = randomUUID();
      await expect(
        prisma.$executeRaw`
          INSERT INTO payment_cancels
            (id, payment_id, order_item_id, refund_id, amount, requested_at, updated_at)
          VALUES (${id}, ${target.paymentId}, ${target.orderItemId}, ${target.refundId}, 10000, NOW(), NOW())
        `,
      ).rejects.toThrow(/attempt_number/);
    });

    it('U399 환불 연결이 없는 PG 취소 요청은 DB가 거절한다', async () => {
      const target = await createPaidItem();
      const id = randomUUID();
      await expect(
        prisma.$executeRaw`
          INSERT INTO payment_cancels
            (id, payment_id, order_item_id, amount, requested_at, updated_at, attempt_number)
          VALUES (${id}, ${target.paymentId}, ${target.orderItemId}, 10000, NOW(), NOW(), 1)
        `,
      ).rejects.toThrow(/refund_id/);
    });

    it('한 환불에 미확정 PG 취소 요청을 두 번째로 저장하면 고유 위반으로 실패한다', async () => {
      const refund = await createAcceptedRefund();
      await prisma.paymentCancel.create({
        data: paymentCancelAttempt(refund),
      });

      await expect(
        prisma.paymentCancel.create({
          data: paymentCancelAttempt(refund, {
            attemptNumber: 2,
            status: PaymentCancelStatus.QUERY_FAILED,
          }),
        }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });

    it('한 환불에 실패 확정된 PG 취소 요청이 있어도 새 미확정 요청 하나는 저장된다', async () => {
      const refund = await createAcceptedRefund();
      await prisma.paymentCancel.create({
        data: paymentCancelAttempt(refund, {
          status: PaymentCancelStatus.FAILED,
        }),
      });

      const retry = await prisma.paymentCancel.create({
        data: paymentCancelAttempt(refund, { attemptNumber: 2 }),
      });

      expect(retry.status).toBe(PaymentCancelStatus.REQUESTED);
    });

    it('한 환불에 같은 시도 번호의 PG 취소 요청을 두 번째로 저장하면 고유 위반으로 실패한다', async () => {
      const refund = await createAcceptedRefund();
      const failedAttempt = paymentCancelAttempt(refund, {
        status: PaymentCancelStatus.FAILED,
      });
      await prisma.paymentCancel.create({ data: failedAttempt });

      await expect(
        prisma.paymentCancel.create({ data: failedAttempt }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });

    it('같은 PG 취소 거래 ID를 가진 PG 취소 요청을 두 번째로 저장하면 고유 위반으로 실패한다', async () => {
      const pgTransactionId = `pg-cancel-${randomUUID()}`;
      const first = await createAcceptedRefund();
      const second = await createAcceptedRefund();
      await prisma.paymentCancel.create({
        data: paymentCancelAttempt(first, { pgTransactionId }),
      });

      await expect(
        prisma.paymentCancel.create({
          data: paymentCancelAttempt(second, { pgTransactionId }),
        }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });

    it('결제 전체 대상 환불 아래 PG 취소 요청은 주문 항목 없이 저장된다', async () => {
      const target = await createPaidItem();
      const refund = await prisma.refund.create({
        data: acceptedRefund(
          { paymentId: target.paymentId, orderItemId: null },
          {
            targetKind: RefundTargetKind.PAYMENT,
            source: RefundSource.SYSTEM,
            requestedById: null,
            terminatedAt: null,
            terminationConsentedAt: null,
          },
        ),
      });

      const attempt = await prisma.paymentCancel.create({
        data: {
          refundId: refund.id,
          paymentId: target.paymentId,
          orderItemId: null,
          attemptNumber: 1,
          amount: 10000,
          status: PaymentCancelStatus.REQUESTED,
          requestedAt: new Date(),
        },
      });

      expect(attempt.orderItemId).toBeNull();
    });

    it('환불에 연결된 PG 취소 요청의 주문 항목이 환불의 주문 항목과 다르면 저장이 실패한다', async () => {
      const refund = await createAcceptedRefund();
      const other = await createPaidItem();

      await expect(
        prisma.paymentCancel.create({
          data: paymentCancelAttempt(refund, {
            orderItemId: other.orderItemId,
          }),
        }),
      ).rejects.toThrow(/payment_cancels_refund_target_check/);
    });

    it('PG가 확인한 실제 취소액이 -1이면 저장이 실패한다', async () => {
      const refund = await createAcceptedRefund();

      await expect(
        prisma.paymentCancel.create({
          data: paymentCancelAttempt(refund, { actualAmount: -1 }),
        }),
      ).rejects.toThrow(/payment_cancels_actual_amount_check/);
    });

    it.each([
      'resendCount',
      'manualResendCount',
      'inquiryCount',
      'inquiryFailureCount',
      'sendAttemptCount',
    ] as const)('PG 취소 요청의 %s가 -1이면 저장이 실패한다', async (field) => {
      const refund = await createAcceptedRefund();

      await expect(
        prisma.paymentCancel.create({
          data: paymentCancelAttempt(refund, { [field]: -1 }),
        }),
      ).rejects.toThrow(/payment_cancels_counts_check/);
    });

    it('실패가 아닌 갱신(담당 토큰 지정)은 실패 시각(failedAt)을 바꾸지 않는다', async () => {
      const refund = await createAcceptedRefund();
      const attempt = await prisma.paymentCancel.create({
        data: paymentCancelAttempt(refund),
      });

      const claimed = await prisma.paymentCancel.update({
        where: { id: attempt.id },
        data: { claimToken: 'worker-1', claimUntil: new Date() },
      });

      expect(claimed.failedAt).toBeNull();
    });
  });

  describe('ManualRefundPayout', () => {
    it('한 환불에 별도 환불금 지급 예약을 두 번째로 저장하면 고유 위반으로 실패한다', async () => {
      const { refundId } = await createAcceptedRefund();
      await prisma.manualRefundPayout.create({ data: manualPayout(refundId) });

      await expect(
        prisma.manualRefundPayout.create({ data: manualPayout(refundId) }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });

    it('다른 환불에서 같은 실제 지급 거래 식별자로 별도 환불금 지급을 저장하면 고유 위반으로 실패한다', async () => {
      const externalTransactionId = `bank-${randomUUID()}`;
      const first = await createAcceptedRefund();
      const second = await createAcceptedRefund();
      const succeeded = {
        status: ManualRefundPayoutStatus.SUCCEEDED,
        externalTransactionId,
        confirmedById: userId,
        confirmedAt: new Date(),
        paidAt: new Date(),
        evidenceReference: '이체 확인증 E2E',
      };
      await prisma.manualRefundPayout.create({
        data: manualPayout(first.refundId, succeeded),
      });

      await expect(
        prisma.manualRefundPayout.create({
          data: manualPayout(second.refundId, succeeded),
        }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });

    it('별도 환불금 지급 금액이 0이면 저장이 실패한다', async () => {
      const { refundId } = await createAcceptedRefund();

      await expect(
        prisma.manualRefundPayout.create({
          data: manualPayout(refundId, { amount: 0 }),
        }),
      ).rejects.toThrow(/manual_refund_payouts_amount_check/);
    });
  });

  describe('Ledger', () => {
    it('같은 PG 취소 요청을 가리키는 원장을 두 번째로 저장하면 고유 위반으로 실패한다', async () => {
      const refund = await createAcceptedRefund();
      const attempt = await prisma.paymentCancel.create({
        data: paymentCancelAttempt(refund, {
          status: PaymentCancelStatus.SUCCEEDED,
        }),
      });
      const pgLedger = refundLedger(refund, {
        paymentCancelId: attempt.id,
        amount: -10000,
      });
      await prisma.ledger.create({ data: pgLedger });

      await expect(
        prisma.ledger.create({ data: pgLedger }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });

    it('같은 별도 환불금 지급을 가리키는 원장을 두 번째로 저장하면 고유 위반으로 실패한다', async () => {
      const refund = await createAcceptedRefund();
      const payout = await prisma.manualRefundPayout.create({
        data: manualPayout(refund.refundId),
      });
      const manualLedger = refundLedger(refund, {
        manualRefundPayoutId: payout.id,
        amount: -10000,
      });
      await prisma.ledger.create({ data: manualLedger });

      await expect(
        prisma.ledger.create({ data: manualLedger }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });

    it('PG 취소 요청과 별도 환불금 지급을 둘 다 가리키는 원장은 저장이 실패한다', async () => {
      const refund = await createAcceptedRefund();
      const attempt = await prisma.paymentCancel.create({
        data: paymentCancelAttempt(refund, {
          status: PaymentCancelStatus.SUCCEEDED,
        }),
      });
      const payout = await prisma.manualRefundPayout.create({
        data: manualPayout(refund.refundId),
      });

      await expect(
        prisma.ledger.create({
          data: refundLedger(refund, {
            paymentCancelId: attempt.id,
            manualRefundPayoutId: payout.id,
            amount: -10000,
          }),
        }),
      ).rejects.toThrow(/ledger_single_payout_check/);
    });

    it('같은 환불의 0원 원장을 두 번째로 저장하면 고유 위반으로 실패한다', async () => {
      const refund = await createAcceptedRefund();
      await prisma.ledger.create({ data: refundLedger(refund) });

      await expect(
        prisma.ledger.create({ data: refundLedger(refund) }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });

    it('환불에 연결되고 두 지급 ID가 모두 없는 원장의 금액이 0이 아니면 저장이 실패한다', async () => {
      const refund = await createAcceptedRefund();

      await expect(
        prisma.ledger.create({
          data: refundLedger(refund, { amount: -10000 }),
        }),
      ).rejects.toThrow(/ledger_zero_payout_amount_check/);
    });
  });

  describe('RefundNotification', () => {
    it('같은 알림의 같은 사용자 읽음 기록을 두 번째로 저장하면 고유 위반으로 실패한다', async () => {
      const { refundId } = await createAcceptedRefund();
      const notification = await prisma.refundNotification.create({
        data: refundNotification(refundId),
      });
      const receipt = {
        notificationId: notification.id,
        userId,
        readAt: new Date(),
      };
      await prisma.refundNotificationReceipt.create({ data: receipt });

      await expect(
        prisma.refundNotificationReceipt.create({ data: receipt }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });

    it('같은 사건·수신 범위의 수신자 없는 알림을 두 번째로 저장하면 고유 위반으로 실패한다', async () => {
      const { refundId } = await createAcceptedRefund();
      await prisma.refundNotification.create({
        data: refundNotification(refundId),
      });

      await expect(
        prisma.refundNotification.create({
          data: refundNotification(refundId),
        }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });

    it('같은 사건·수신 범위·수신자 알림을 두 번째로 저장하면 고유 위반으로 실패한다', async () => {
      const { refundId } = await createAcceptedRefund();
      const personal = refundNotification(refundId, {
        audience: RefundNotificationAudience.CUSTOMER,
        recipientUserId: userId,
      });
      await prisma.refundNotification.create({ data: personal });

      await expect(
        prisma.refundNotification.create({ data: personal }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });
  });

  describe('RefundIdempotencyRecord', () => {
    it('같은 요청자·기능·키의 멱등 요청 기록을 두 번째로 저장하면 고유 위반으로 실패한다', async () => {
      const record = {
        requesterId: userId,
        operation: 'CUSTOMER_REFUND',
        key: `key-${randomUUID()}`,
        requestFingerprint: 'fingerprint',
        status: RefundIdempotencyStatus.IN_PROGRESS,
      };
      await prisma.refundIdempotencyRecord.create({ data: record });

      await expect(
        prisma.refundIdempotencyRecord.create({ data: record }),
      ).rejects.toMatchObject({ code: uniqueViolation });
    });
  });
});
