/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';
import { RefundAcceptanceService } from '../src/refund/refund-acceptance.service';
import { RefundLockingRepository } from '../src/refund/refund-locking.repository';
import { RefundRepository } from '../src/refund/refund.repository';
import { RefundRecoveryService } from '../src/refund/refund-recovery.service';
import { RefundOperationsRepository } from '../src/refund/refund-operations.repository';
import { UsageSessionRepository } from '../src/usage-session/usage-session.repository';
import {
  PaymentCancelStatus,
  RefundPayoutStatus,
  SeatAssignmentStatus,
  TicketStatus,
  UsageSessionStatus,
} from '@prisma/client';
import { signedCallback } from './helpers/pg-callback';

/** 환불 경로 사이의 동시 실행에서 실제 DB 제약과 PG 호출 수를 확인한다. */
describe('환불 동시성 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'concurrency',
      configure: (builder) =>
        builder.overrideProvider(REFUND_PG_GATEWAY).useValue(pgStub),
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => pgStub.reset());

  it('U403 고객과 점주가 같은 이용권을 동시에 환불해도 확정 환불·활성 PG 요청·PG 전송은 각각 한 건이다', async () => {
    const issued = await ctx.issuePeriodTicket();
    const acceptance = ctx.app.get<RefundAcceptanceService>(
      RefundAcceptanceService,
    );
    const locking = ctx.app.get<RefundLockingRepository>(
      RefundLockingRepository,
    );
    const repository = ctx.app.get<RefundRepository>(RefundRepository);
    const original: RefundAcceptanceService['findLockedTarget'] =
      acceptance.findLockedTarget.bind(acceptance);
    let releaseCustomer!: () => void;
    const holdCustomer = new Promise<void>((resolve) => {
      releaseCustomer = resolve;
    });
    let customerLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      customerLocked = resolve;
    });
    let storeLockAttempted!: () => void;
    const lockAttempted = new Promise<void>((resolve) => {
      storeLockAttempted = resolve;
    });
    let calls = 0;
    let storeCallStarted = false;
    const spy = vi
      .spyOn(acceptance, 'findLockedTarget')
      .mockImplementation(async (...args) => {
        calls += 1;
        if (calls === 2) storeCallStarted = true;
        const target = await original(...args);
        if (calls === 1) {
          customerLocked();
          await holdCustomer;
        }
        return target;
      });
    const originalRead: RefundRepository['findCustomerRefundTarget'] =
      repository.findCustomerRefundTarget.bind(repository);
    let delayedStoreRead = false;
    let storeReadCompleted = false;
    const readSpy = vi
      .spyOn(repository, 'findCustomerRefundTarget')
      .mockImplementation(async (...args) => {
        if (storeCallStarted && !delayedStoreRead) {
          delayedStoreRead = true;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const result = await originalRead(...args);
        if (storeCallStarted) storeReadCompleted = true;
        return result;
      });
    const originalLock: RefundLockingRepository['lockForAcceptance'] =
      locking.lockForAcceptance.bind(locking);
    let lockCalls = 0;
    const lockSpy = vi
      .spyOn(locking, 'lockForAcceptance')
      .mockImplementation(async (...args) => {
        lockCalls += 1;
        if (lockCalls === 2) storeLockAttempted();
        return originalLock(...args);
      });

    try {
      const customerPromise = request(ctx.server)
        .post('/refund')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .then((response) => response);
      await locked;
      const storePromise = request(ctx.server)
        .post(`/refund/shop/${ctx.shop.id}`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          ticketId: issued.ticketId,
          amount: issued.amount,
          reason: '고객 요청',
          consentToTerminateTicket: true,
        })
        .then((response) => response);
      // 두 번째 요청은 최초 대상 읽기를 마치고 잠금 호출에 들어왔다.
      await lockAttempted;
      expect(storeReadCompleted).toBe(true);
      let storeFinished = false;
      void storePromise.then(() => {
        storeFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(storeFinished).toBe(false);
      releaseCustomer();
      const [customer, store] = await Promise.all([
        customerPromise,
        storePromise,
      ]);
      expect(customer.status).toBe(202);
      expect(store.status).toBe(409);
      expect(store.body.error.code).toBe('REFUND_IN_PROGRESS');
    } finally {
      releaseCustomer();
      spy.mockRestore();
      readSpy.mockRestore();
      lockSpy.mockRestore();
    }
    expect(
      await ctx.prisma.refund.count({
        where: { orderItemId: issued.orderItemId },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.paymentCancel.count({
        where: { orderItemId: issued.orderItemId },
      }),
    ).toBe(1);
    expect(pgStub.sendCalls).toHaveLength(1);
  });
  it('U404 입실이 이용권 잠금을 먼저 잡으면 고객 환불은 사용 이력을 확인해 거절된다', async () => {
    const issued = await ctx.issuePeriodTicket({ fixedSeat: true });
    const sessions = ctx.app.get<UsageSessionRepository>(
      UsageSessionRepository,
    );
    const locking = ctx.app.get<RefundLockingRepository>(
      RefundLockingRepository,
    );
    const originalCreate: UsageSessionRepository['createSession'] =
      sessions.createSession.bind(sessions);
    const originalLock: RefundLockingRepository['lockForAcceptance'] =
      locking.lockForAcceptance.bind(locking);
    let entryLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      entryLocked = resolve;
    });
    let releaseEntry!: () => void;
    const holdEntry = new Promise<void>((resolve) => {
      releaseEntry = resolve;
    });
    let refundLockAttempted!: () => void;
    const attempted = new Promise<void>((resolve) => {
      refundLockAttempted = resolve;
    });
    const createSpy = vi
      .spyOn(sessions, 'createSession')
      .mockImplementation(
        (
          ticketId,
          shopId,
          seatId,
          userId,
          plannedEndAt,
          startedAt,
          firstEntryUpdate,
          originalBeforeCreate,
        ) => {
          return originalCreate(
            ticketId,
            shopId,
            seatId,
            userId,
            plannedEndAt,
            startedAt,
            firstEntryUpdate,
            async (tx) => {
              if (originalBeforeCreate) await originalBeforeCreate(tx);
              entryLocked();
              await holdEntry;
            },
          );
        },
      );
    const lockSpy = vi
      .spyOn(locking, 'lockForAcceptance')
      .mockImplementation((...args) => {
        refundLockAttempted();
        return originalLock(...args);
      });
    try {
      const entryPromise = request(ctx.server)
        .post('/usage-sessions')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .send({
          ticketId: issued.ticketId,
          shopId: ctx.shop.id,
          seatId: issued.seatId,
          userId: ctx.customer.id,
        })
        .then((response) => response);
      await locked;
      const refundPromise = request(ctx.server)
        .post('/refund')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .then((response) => response);
      await attempted;
      releaseEntry();
      const [entry, refund] = await Promise.all([entryPromise, refundPromise]);
      expect(entry.status).toBe(201);
      expect(refund.status).toBe(409);
      expect(refund.body.error.code).toBe('USED_TICKET');
    } finally {
      releaseEntry();
      createSpy.mockRestore();
      lockSpy.mockRestore();
    }
    expect(
      await ctx.prisma.refund.count({
        where: { orderItemId: issued.orderItemId },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.usageSession.count({
        where: { ticketId: issued.ticketId, status: UsageSessionStatus.ACTIVE },
      }),
    ).toBe(1);
    expect(
      (
        await ctx.prisma.ticket.findUniqueOrThrow({
          where: { id: issued.ticketId },
        })
      ).status,
    ).toBe(TicketStatus.ACTIVE);
    expect(pgStub.sendCalls).toHaveLength(0);
  });
  it('U405 개별 PG 조회 중 성공 콜백이 먼저 확정되면 오래된 조회 결과가 지급 완료를 덮어쓰지 않는다', async () => {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'UNKNOWN', reason: '응답 시간 초과' });
    const accepted = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    const refundId = accepted.body.data.refundId as string;
    const paymentCancelId = accepted.body.data.paymentCancelId as string;
    pgStub.reset();

    let releaseInquiry!: () => void;
    const holdInquiry = new Promise<void>((resolve) => {
      releaseInquiry = resolve;
    });
    let inquiryReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      inquiryReady = resolve;
    });
    const originalInquire: RefundPgStub['inquireCancel'] =
      pgStub.inquireCancel.bind(pgStub);
    const inquirySpy = vi
      .spyOn(pgStub, 'inquireCancel')
      .mockImplementation(async (input) => {
        const result = await originalInquire(input);
        inquiryReady();
        await holdInquiry;
        return result;
      });
    try {
      const checkPromise = request(ctx.server)
        .post(`/refund/${refundId}/pg-check`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({})
        .then((response) => response);
      await ready;
      await signedCallback(ctx.server, '/refund/callback', {
        success: true,
        paymentCancelId,
        pgTransactionId: `pg-cancel-${paymentCancelId}`,
        orderItemId: issued.orderItemId,
        amount: issued.amount,
        reason: null,
      }).expect(200);
      releaseInquiry();
      const check = await checkPromise;
      expect(check.status).toBe(200);
    } finally {
      releaseInquiry();
      inquirySpy.mockRestore();
    }
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { paymentCancels: true, ledgers: true },
    });
    expect(refund.payoutStatus).toBe(RefundPayoutStatus.PAID);
    expect(refund.paidAmount).toBe(issued.amount);
    expect(refund.paymentCancels[0].status).toBe(PaymentCancelStatus.SUCCEEDED);
    expect(refund.ledgers).toHaveLength(1);
    expect(pgStub.inquiryCalls).toHaveLength(1);
  });
  it('U406 점주 개별 조회가 PG 응답을 기다리는 동안 자동 조회가 같은 시도를 다시 조회하지 않는다', async () => {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'UNKNOWN', reason: '응답 시간 초과' });
    const accepted = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    const refundId = accepted.body.data.refundId as string;
    const paymentCancelId = accepted.body.data.paymentCancelId as string;
    const recovery = ctx.app.get<RefundRecoveryService>(RefundRecoveryService);
    pgStub.reset();

    let releaseInquiry!: () => void;
    const holdInquiry = new Promise<void>((resolve) => {
      releaseInquiry = resolve;
    });
    let inquiryReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      inquiryReady = resolve;
    });
    const originalInquire: RefundPgStub['inquireCancel'] =
      pgStub.inquireCancel.bind(pgStub);
    let inquiryCalls = 0;
    const inquirySpy = vi
      .spyOn(pgStub, 'inquireCancel')
      .mockImplementation(async (input) => {
        const result = await originalInquire(input);
        inquiryCalls += 1;
        if (inquiryCalls === 1) {
          inquiryReady();
          await holdInquiry;
        }
        return result;
      });
    try {
      const checkPromise = request(ctx.server)
        .post(`/refund/${refundId}/pg-check`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({})
        .then((response) => response);
      await ready;
      const automaticResult = await recovery.inquireAttempt(
        paymentCancelId,
        new Date(),
      );
      const inquiriesBeforeRelease = pgStub.inquiryCalls.length;
      releaseInquiry();
      const check = await checkPromise;
      expect(automaticResult).toBeNull();
      expect(inquiriesBeforeRelease).toBe(1);
      expect(check.status).toBe(200);
      expect(check.body.data.checkStatus).toBe('CHECKED');
      expect(check.body.data.inquiryResult).toBe('IN_PROGRESS');
    } finally {
      releaseInquiry();
      inquirySpy.mockRestore();
    }
    const attempt = await ctx.prisma.paymentCancel.findUniqueOrThrow({
      where: { id: paymentCancelId },
    });
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { ledgers: true },
    });
    expect(attempt.inquiryCount).toBe(1);
    expect(attempt.status).toBe(PaymentCancelStatus.REQUESTED);
    expect(refund.payoutStatus).toBe(RefundPayoutStatus.PENDING);
    expect(refund.ledgers).toHaveLength(0);
  });
  it('U407 자동 조회가 PG 응답을 기다리는 동안 점주 개별 확인은 진행 중 상태를 안내한다', async () => {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'UNKNOWN', reason: '응답 시간 초과' });
    const accepted = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    const refundId = accepted.body.data.refundId as string;
    const paymentCancelId = accepted.body.data.paymentCancelId as string;
    const recovery = ctx.app.get<RefundRecoveryService>(RefundRecoveryService);
    pgStub.reset();

    let releaseInquiry!: () => void;
    const holdInquiry = new Promise<void>((resolve) => {
      releaseInquiry = resolve;
    });
    let inquiryReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      inquiryReady = resolve;
    });
    const originalInquire: RefundPgStub['inquireCancel'] =
      pgStub.inquireCancel.bind(pgStub);
    let inquiryCalls = 0;
    const inquirySpy = vi
      .spyOn(pgStub, 'inquireCancel')
      .mockImplementation(async (input) => {
        const result = await originalInquire(input);
        inquiryCalls += 1;
        if (inquiryCalls === 1) {
          inquiryReady();
          await holdInquiry;
        }
        return result;
      });
    try {
      const automaticPromise = recovery.inquireAttempt(
        paymentCancelId,
        new Date(),
      );
      await ready;
      const check = await request(ctx.server)
        .post(`/refund/${refundId}/pg-check`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({});
      const inquiriesBeforeRelease = pgStub.inquiryCalls.length;
      releaseInquiry();
      const automaticResult = await automaticPromise;
      expect(inquiriesBeforeRelease).toBe(1);
      expect(check.status).toBe(202);
      expect(check.body.data.checkStatus).toBe('ALREADY_RUNNING');
      expect(check.body.data.inquiryResult).toBeNull();
      expect(automaticResult).toBe('IN_PROGRESS');
    } finally {
      releaseInquiry();
      inquirySpy.mockRestore();
    }
    const attempt = await ctx.prisma.paymentCancel.findUniqueOrThrow({
      where: { id: paymentCancelId },
    });
    expect(attempt.inquiryCount).toBe(1);
    expect(attempt.status).toBe(PaymentCancelStatus.REQUESTED);
  });
  it.each([
    ['PG 재요청 먼저', true],
    ['별도 지급 예약 먼저', false],
  ] as const)(
    'U408 실패한 PG 요청을 점주가 조회하는 동안 운영자는 새 PG 요청과 별도 지급을 시작할 수 없다 (%s)',
    async (_order, retryFirst) => {
      const issued = await ctx.issuePeriodTicket();
      pgStub.respondToSend({ result: 'REJECTED', reason: 'PG 취소 거절' });
      const accepted = await request(ctx.server)
        .post('/refund')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .expect(202);
      const refundId = accepted.body.data.refundId as string;
      pgStub.reset();
      pgStub.respondToInquiry({
        result: 'QUERY_ERROR',
        reason: '조회 응답 없음',
      });

      let releaseInquiry!: () => void;
      const holdInquiry = new Promise<void>((resolve) => {
        releaseInquiry = resolve;
      });
      let inquiryReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        inquiryReady = resolve;
      });
      const originalInquire: RefundPgStub['inquireCancel'] =
        pgStub.inquireCancel.bind(pgStub);
      const inquirySpy = vi
        .spyOn(pgStub, 'inquireCancel')
        .mockImplementation(async (input) => {
          const result = await originalInquire(input);
          inquiryReady();
          await holdInquiry;
          return result;
        });
      try {
        const checkPromise = request(ctx.server)
          .post(`/refund/${refundId}/pg-check`)
          .set('Authorization', `Bearer ${ctx.owner.token}`)
          .send({})
          .then((response) => response);
        await ready;
        const retryRequest = () =>
          request(ctx.server)
            .post(`/refund/${refundId}/payout-retries`)
            .set('Authorization', `Bearer ${ctx.manager.token}`)
            .set('Idempotency-Key', randomUUID())
            .send({ reason: 'PG 재요청' });
        const reserveRequest = () =>
          request(ctx.server)
            .post(`/refund/${refundId}/manual-payouts`)
            .set('Authorization', `Bearer ${ctx.manager.token}`)
            .set('Idempotency-Key', randomUUID())
            .send({ amount: issued.amount, reason: '별도 지급' });
        const first = retryFirst
          ? await retryRequest()
          : await reserveRequest();
        const second = retryFirst
          ? await reserveRequest()
          : await retryRequest();
        const retry = retryFirst ? first : second;
        const reserve = retryFirst ? second : first;
        const inquiriesBeforeRelease = pgStub.inquiryCalls.length;
        const sendsBeforeRelease = pgStub.sendCalls.length;
        releaseInquiry();
        const check = await checkPromise;
        expect(retry.status).toBe(409);
        expect(retry.body.error.code).toBe('REFUND_PAYOUT_UNRESOLVED');
        expect(reserve.status).toBe(409);
        expect(reserve.body.error.code).toBe('REFUND_PAYOUT_UNRESOLVED');
        expect(inquiriesBeforeRelease).toBe(1);
        expect(sendsBeforeRelease).toBe(0);
        expect(check.status).toBe(200);
        expect(check.body.data.checkStatus).toBe('CHECKED');
        expect(check.body.data.inquiryResult).toBe('QUERY_ERROR');
      } finally {
        releaseInquiry();
        inquirySpy.mockRestore();
      }
      expect(
        await ctx.prisma.paymentCancel.count({ where: { refundId } }),
      ).toBe(1);
      expect(
        await ctx.prisma.manualRefundPayout.count({ where: { refundId } }),
      ).toBe(0);
      expect(pgStub.sendCalls).toHaveLength(0);
    },
  );
  it('U409 같은 별도 지급 증빙을 서로 다른 키로 동시에 등록해도 지급액과 원장은 한 번만 반영한다', async () => {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'REJECTED', reason: 'PG 취소 거절' });
    const accepted = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    const refundId = accepted.body.data.refundId as string;
    const reserved = await request(ctx.server)
      .post(`/refund/${refundId}/manual-payouts`)
      .set('Authorization', `Bearer ${ctx.manager.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: issued.amount, reason: '계좌 이체' })
      .expect(201);
    const payoutId = reserved.body.data.payoutId as string;
    pgStub.reset();

    const operations = ctx.app.get<RefundOperationsRepository>(
      RefundOperationsRepository,
    );
    const locking = ctx.app.get<RefundLockingRepository>(
      RefundLockingRepository,
    );
    const originalMark: RefundOperationsRepository['markPayoutSucceeded'] =
      operations.markPayoutSucceeded.bind(operations);
    const originalLock: RefundLockingRepository['lockForPayout'] =
      locking.lockForPayout.bind(locking);
    let firstLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      firstLocked = resolve;
    });
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondLockAttempted!: () => void;
    const secondAttempted = new Promise<void>((resolve) => {
      secondLockAttempted = resolve;
    });
    let lockCalls = 0;
    let markCalls = 0;
    const lockSpy = vi
      .spyOn(locking, 'lockForPayout')
      .mockImplementation((...args) => {
        lockCalls += 1;
        if (lockCalls === 2) secondLockAttempted();
        return originalLock(...args);
      });
    const markSpy = vi
      .spyOn(operations, 'markPayoutSucceeded')
      .mockImplementation(async (...args) => {
        markCalls += 1;
        if (markCalls === 1) {
          firstLocked();
          await holdFirst;
        }
        return originalMark(...args);
      });
    const body = {
      amount: issued.amount,
      paidAt: new Date(Date.now() - 60_000).toISOString(),
      externalTransactionId: `bank-${randomUUID()}`,
      evidenceReference: '이체 확인증',
    };
    const confirm = () =>
      request(ctx.server)
        .post(`/refund/${refundId}/manual-payouts/${payoutId}/confirm`)
        .set('Authorization', `Bearer ${ctx.manager.token}`)
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .then((response) => response);
    try {
      const firstPromise = confirm();
      await locked;
      const secondPromise = confirm();
      await secondAttempted;
      releaseFirst();
      const [first, second] = await Promise.all([firstPromise, secondPromise]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.data).toEqual(second.body.data);
    } finally {
      releaseFirst();
      markSpy.mockRestore();
      lockSpy.mockRestore();
    }
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { manualPayouts: true, ledgers: true },
    });
    expect(refund.payoutStatus).toBe(RefundPayoutStatus.PAID);
    expect(refund.paidAmount).toBe(issued.amount);
    expect(refund.manualPayouts).toHaveLength(1);
    expect(refund.manualPayouts[0].status).toBe('SUCCEEDED');
    expect(refund.ledgers).toHaveLength(1);
    expect(refund.ledgers[0].amount).toBe(-issued.amount);
    expect(pgStub.sendCalls).toHaveLength(0);
  });
  it.each([
    ['점주 선행', true],
    ['운영자 선행', false],
  ] as const)(
    'U410 실패한 PG 시도의 개별 조회를 점주와 운영자가 동시에 요청해도 PG 조회는 한 번이다 (%s)',
    async (_order, ownerFirst) => {
      const issued = await ctx.issuePeriodTicket();
      pgStub.respondToSend({ result: 'REJECTED', reason: 'PG 취소 거절' });
      const accepted = await request(ctx.server)
        .post('/refund')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .expect(202);
      const refundId = accepted.body.data.refundId as string;
      const paymentCancelId = accepted.body.data.paymentCancelId as string;
      pgStub.reset();
      pgStub.respondToInquiry({
        result: 'QUERY_ERROR',
        reason: '조회 응답 없음',
      });

      let releaseInquiry!: () => void;
      const holdInquiry = new Promise<void>((resolve) => {
        releaseInquiry = resolve;
      });
      let inquiryReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        inquiryReady = resolve;
      });
      const originalInquire: RefundPgStub['inquireCancel'] =
        pgStub.inquireCancel.bind(pgStub);
      let calls = 0;
      const inquirySpy = vi
        .spyOn(pgStub, 'inquireCancel')
        .mockImplementation(async (input) => {
          const result = await originalInquire(input);
          calls += 1;
          if (calls === 1) {
            inquiryReady();
            await holdInquiry;
          }
          return result;
        });
      const check = (token: string) =>
        request(ctx.server)
          .post(`/refund/${refundId}/pg-check`)
          .set('Authorization', `Bearer ${token}`)
          .send({})
          .then((response) => response);
      try {
        const firstPromise = check(
          ownerFirst ? ctx.owner.token : ctx.manager.token,
        );
        await ready;
        const second = await check(
          ownerFirst ? ctx.manager.token : ctx.owner.token,
        );
        const inquiriesBeforeRelease = pgStub.inquiryCalls.length;
        releaseInquiry();
        const first = await firstPromise;
        expect(inquiriesBeforeRelease).toBe(1);
        expect(second.status).toBe(202);
        expect(second.body.data.checkStatus).toBe('ALREADY_RUNNING');
        expect(second.body.data.inquiryResult).toBeNull();
        expect(first.status).toBe(200);
        expect(first.body.data.checkStatus).toBe('CHECKED');
        expect(first.body.data.inquiryResult).toBe('QUERY_ERROR');
      } finally {
        releaseInquiry();
        inquirySpy.mockRestore();
      }
      const attempt = await ctx.prisma.paymentCancel.findUniqueOrThrow({
        where: { id: paymentCancelId },
      });
      expect(attempt.inquiryCount).toBe(1);
      expect(attempt.status).toBe(PaymentCancelStatus.FAILED);
      expect(
        await ctx.prisma.paymentCancel.count({ where: { refundId } }),
      ).toBe(1);
      expect(pgStub.sendCalls).toHaveLength(0);
    },
  );
  it.each([
    ['PG 재요청 선행', true],
    ['별도 지급 예약 선행', false],
  ] as const)(
    'U411 PG 재요청과 별도 지급 예약이 동시에 허용될 때 한 경로만 새 지급을 만든다 (%s)',
    async (_order, retryFirst) => {
      const issued = await ctx.issuePeriodTicket();
      pgStub.respondToSend({ result: 'REJECTED', reason: 'PG 취소 거절' });
      const accepted = await request(ctx.server)
        .post('/refund')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .expect(202);
      const refundId = accepted.body.data.refundId as string;
      pgStub.reset();

      const locking = ctx.app.get<RefundLockingRepository>(
        RefundLockingRepository,
      );
      const refunds = ctx.app.get<RefundRepository>(RefundRepository);
      const operations = ctx.app.get<RefundOperationsRepository>(
        RefundOperationsRepository,
      );
      const originalLock: RefundLockingRepository['lockForPayout'] =
        locking.lockForPayout.bind(locking);
      const originalRetry: RefundRepository['createRetryAttempt'] =
        refunds.createRetryAttempt.bind(refunds);
      const originalReserve: RefundOperationsRepository['createReservation'] =
        operations.createReservation.bind(operations);
      let firstReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        firstReady = resolve;
      });
      let releaseFirst!: () => void;
      const holdFirst = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let secondLockAttempted!: () => void;
      const attempted = new Promise<void>((resolve) => {
        secondLockAttempted = resolve;
      });
      let lockCalls = 0;
      const lockSpy = vi
        .spyOn(locking, 'lockForPayout')
        .mockImplementation((...args) => {
          lockCalls += 1;
          if (lockCalls === 2) secondLockAttempted();
          return originalLock(...args);
        });
      const retrySpy = vi
        .spyOn(refunds, 'createRetryAttempt')
        .mockImplementation(async (...args) => {
          if (retryFirst) {
            firstReady();
            await holdFirst;
          }
          return originalRetry(...args);
        });
      const reserveSpy = vi
        .spyOn(operations, 'createReservation')
        .mockImplementation(async (...args) => {
          if (!retryFirst) {
            firstReady();
            await holdFirst;
          }
          return originalReserve(...args);
        });
      const retry = () =>
        request(ctx.server)
          .post(`/refund/${refundId}/payout-retries`)
          .set('Authorization', `Bearer ${ctx.manager.token}`)
          .set('Idempotency-Key', randomUUID())
          .send({ reason: 'PG 재요청' })
          .then((response) => response);
      const reserve = () =>
        request(ctx.server)
          .post(`/refund/${refundId}/manual-payouts`)
          .set('Authorization', `Bearer ${ctx.manager.token}`)
          .set('Idempotency-Key', randomUUID())
          .send({ amount: issued.amount, reason: '계좌 이체' })
          .then((response) => response);
      try {
        const firstPromise = retryFirst ? retry() : reserve();
        await ready;
        const secondPromise = retryFirst ? reserve() : retry();
        await attempted;
        releaseFirst();
        const [first, second] = await Promise.all([
          firstPromise,
          secondPromise,
        ]);
        const retryResponse = retryFirst ? first : second;
        const reserveResponse = retryFirst ? second : first;
        expect(retryResponse.status).toBe(retryFirst ? 202 : 409);
        expect(reserveResponse.status).toBe(retryFirst ? 409 : 201);
        expect(
          (retryFirst ? reserveResponse : retryResponse).body.error.code,
        ).toBe('REFUND_PAYOUT_UNRESOLVED');
      } finally {
        releaseFirst();
        retrySpy.mockRestore();
        reserveSpy.mockRestore();
        lockSpy.mockRestore();
      }
      const activeAttempts = await ctx.prisma.paymentCancel.count({
        where: {
          refundId,
          status: {
            in: [
              PaymentCancelStatus.REQUESTED,
              PaymentCancelStatus.QUERY_FAILED,
            ],
          },
        },
      });
      const reservedPayouts = await ctx.prisma.manualRefundPayout.count({
        where: { refundId, status: 'RESERVED' },
      });
      const ledgers = await ctx.prisma.ledger.count({ where: { refundId } });
      expect(activeAttempts).toBe(retryFirst ? 1 : 0);
      expect(reservedPayouts).toBe(retryFirst ? 0 : 1);
      expect(ledgers).toBe(0);
      expect(pgStub.sendCalls).toHaveLength(retryFirst ? 1 : 0);
    },
  );
  it('U412 PG 조회와 성공 콜백이 같은 결과를 동시에 반영해도 지급액과 원장은 한 번만 기록된다', async () => {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'UNKNOWN', reason: '응답 시간 초과' });
    const accepted = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    const refundId = accepted.body.data.refundId as string;
    const paymentCancelId = accepted.body.data.paymentCancelId as string;
    const pgTransactionId = `pg-cancel-${paymentCancelId}`;
    pgStub.reset();
    pgStub.respondToInquiry({
      result: 'SUCCEEDED',
      pgTransactionId,
      cancelledAmount: issued.amount,
    });

    const refunds = ctx.app.get<RefundRepository>(RefundRepository);
    const locking = ctx.app.get<RefundLockingRepository>(
      RefundLockingRepository,
    );
    const originalSucceeded: RefundRepository['markAttemptSucceeded'] =
      refunds.markAttemptSucceeded.bind(refunds);
    const originalLock: RefundLockingRepository['lockForPayout'] =
      locking.lockForPayout.bind(locking);
    let inquiryLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      inquiryLocked = resolve;
    });
    let releaseInquiry!: () => void;
    const holdInquiry = new Promise<void>((resolve) => {
      releaseInquiry = resolve;
    });
    let callbackLockAttempted!: () => void;
    const attempted = new Promise<void>((resolve) => {
      callbackLockAttempted = resolve;
    });
    const succeededSpy = vi
      .spyOn(refunds, 'markAttemptSucceeded')
      .mockImplementation(async (...args) => {
        inquiryLocked();
        await holdInquiry;
        return originalSucceeded(...args);
      });
    try {
      const checkPromise = request(ctx.server)
        .post(`/refund/${refundId}/pg-check`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({})
        .then((response) => response);
      await locked;
      const lockSpy = vi
        .spyOn(locking, 'lockForPayout')
        .mockImplementation((...args) => {
          callbackLockAttempted();
          return originalLock(...args);
        });
      try {
        const callbackPromise = signedCallback(ctx.server, '/refund/callback', {
          success: true,
          paymentCancelId,
          pgTransactionId,
          orderItemId: issued.orderItemId,
          amount: issued.amount,
          reason: null,
        }).then((response) => response);
        await attempted;
        releaseInquiry();
        const [check, callback] = await Promise.all([
          checkPromise,
          callbackPromise,
        ]);
        expect(check.status).toBe(200);
        expect(check.body.data.checkStatus).toBe('CHECKED');
        expect(check.body.data.inquiryResult).toBe('SUCCEEDED');
        expect(callback.status).toBe(200);
      } finally {
        releaseInquiry();
        lockSpy.mockRestore();
      }
    } finally {
      releaseInquiry();
      succeededSpy.mockRestore();
    }

    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { paymentCancels: true, ledgers: true },
    });
    expect(refund.payoutStatus).toBe(RefundPayoutStatus.PAID);
    expect(refund.paidAmount).toBe(issued.amount);
    expect(refund.paymentCancels).toHaveLength(1);
    expect(refund.paymentCancels[0].status).toBe(PaymentCancelStatus.SUCCEEDED);
    expect(refund.paymentCancels[0].actualAmount).toBe(issued.amount);
    expect(refund.paymentCancels[0].pgTransactionId).toBe(pgTransactionId);
    expect(refund.ledgers).toHaveLength(1);
    expect(refund.ledgers[0].paymentCancelId).toBe(paymentCancelId);
    expect(pgStub.inquiryCalls).toHaveLength(1);
    expect(pgStub.sendCalls).toHaveLength(0);
  });
  it('U413 환불이 이용권을 먼저 잠그면 사전 조회를 마친 입실도 잠금 뒤 종료 상태를 다시 확인한다', async () => {
    const issued = await ctx.issuePeriodTicket({ fixedSeat: true });
    const acceptance = ctx.app.get<RefundAcceptanceService>(
      RefundAcceptanceService,
    );
    const sessions = ctx.app.get<UsageSessionRepository>(
      UsageSessionRepository,
    );
    const originalFind: RefundAcceptanceService['findLockedTarget'] =
      acceptance.findLockedTarget.bind(acceptance);
    const originalCreate: UsageSessionRepository['createSession'] =
      sessions.createSession.bind(sessions);
    let refundLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      refundLocked = resolve;
    });
    let releaseRefund!: () => void;
    const holdRefund = new Promise<void>((resolve) => {
      releaseRefund = resolve;
    });
    let entryReadCompleted!: () => void;
    const readCompleted = new Promise<void>((resolve) => {
      entryReadCompleted = resolve;
    });
    const findSpy = vi
      .spyOn(acceptance, 'findLockedTarget')
      .mockImplementation(async (...args) => {
        const target = await originalFind(...args);
        refundLocked();
        await holdRefund;
        return target;
      });
    const createSpy = vi
      .spyOn(sessions, 'createSession')
      .mockImplementation((...args) => {
        entryReadCompleted();
        return originalCreate(...args);
      });
    try {
      const refundPromise = request(ctx.server)
        .post('/refund')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .then((response) => response);
      await locked;
      const entryPromise = request(ctx.server)
        .post('/usage-sessions')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .send({
          ticketId: issued.ticketId,
          shopId: ctx.shop.id,
          seatId: issued.seatId,
          userId: ctx.customer.id,
        })
        .then((response) => response);
      await readCompleted;
      let waitingForTicket = false;
      for (let i = 0; i < 100; i += 1) {
        const [activity] = await ctx.prisma.$queryRaw<
          { waiting: number }[]
        >`SELECT COUNT(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%SELECT status FROM tickets WHERE id%FOR UPDATE%'`;
        if (activity.waiting > 0) {
          waitingForTicket = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waitingForTicket).toBe(true);
      releaseRefund();
      const [refund, entry] = await Promise.all([refundPromise, entryPromise]);
      expect(refund.status).toBe(202);
      expect(entry.status).toBe(409);
      expect(entry.body.error.code).toBe('TICKET_TERMINATED');
    } finally {
      releaseRefund();
      findSpy.mockRestore();
      createSpy.mockRestore();
    }
    expect(
      await ctx.prisma.refund.count({
        where: { orderItemId: issued.orderItemId },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.paymentCancel.count({
        where: { orderItemId: issued.orderItemId },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.usageSession.count({
        where: { ticketId: issued.ticketId, status: UsageSessionStatus.ACTIVE },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.seatAssignment.count({
        where: {
          ticketId: issued.ticketId,
          status: SeatAssignmentStatus.ACTIVE,
        },
      }),
    ).toBe(0);
    expect(
      (
        await ctx.prisma.ticket.findUniqueOrThrow({
          where: { id: issued.ticketId },
        })
      ).status,
    ).toBe(TicketStatus.REVOKED);
    expect(pgStub.sendCalls).toHaveLength(1);
  });
});
