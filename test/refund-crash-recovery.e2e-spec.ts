/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  PaymentCancelStatus,
  ManualRefundPayoutStatus,
  RefundPayoutStatus,
  SeatAssignmentStatus,
  TicketStatus,
} from '@prisma/client';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';
import { RefundRepository } from '../src/refund/refund.repository';
import { RefundRecoveryService } from '../src/refund/refund-recovery.service';
import { RefundDispatchService } from '../src/refund/refund-dispatch.service';
import { RefundAcceptanceService } from '../src/refund/refund-acceptance.service';

/** 중단된 요청의 DB 기록을 새 앱 인스턴스에서 이어받는 환불 E2E. */
describe('환불 중단 복구 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;
  const restarted: RefundTestContext[] = [];

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'crash-recovery',
      configure: (builder) =>
        builder.overrideProvider(REFUND_PG_GATEWAY).useValue(pgStub),
    });
  });

  afterAll(async () => {
    for (const app of restarted.reverse()) await app.close();
    await ctx.close();
  });

  beforeEach(() => pgStub.reset());

  async function newApp(): Promise<RefundTestContext> {
    const app = await createRefundTestContext({
      label: 'crash-recovery-new',
      configure: (builder) =>
        builder.overrideProvider(REFUND_PG_GATEWAY).useValue(pgStub),
    });
    restarted.push(app);
    return app;
  }

  it('U414 환불 확정 트랜잭션이 커밋 전에 실패하면 이용권과 PG 호출은 그대로다', async () => {
    const issued = await ctx.issuePeriodTicket({ fixedSeat: true });
    const refunds = ctx.app.get<RefundRepository>(RefundRepository);
    const createSpy = jest
      .spyOn(refunds, 'createAcceptedRefund')
      .mockRejectedValueOnce(new Error('확정 저장 중단'));
    try {
      await request(ctx.server)
        .post('/refund')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .expect(500);
    } finally {
      createSpy.mockRestore();
    }
    expect(
      (
        await ctx.prisma.ticket.findUniqueOrThrow({
          where: { id: issued.ticketId },
        })
      ).status,
    ).toBe(TicketStatus.UNUSED);
    expect(
      await ctx.prisma.refund.count({
        where: { orderItemId: issued.orderItemId },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.paymentCancel.count({
        where: { orderItemId: issued.orderItemId },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.seatAssignment.count({
        where: {
          ticketId: issued.ticketId,
          status: SeatAssignmentStatus.ACTIVE,
        },
      }),
    ).toBe(1);
    expect(pgStub.sendCalls).toHaveLength(0);
  });

  it.each([
    ['PG 전송 전', true],
    ['PG 전송 후 응답 전', false],
  ] as const)(
    'U415 확정 커밋 뒤 %s 중단되면 새 앱은 담당 만료 후 같은 시도를 조회부터 복구한다',
    async (_label, beforeSend) => {
      const issued = await ctx.issuePeriodTicket({ fixedSeat: true });
      const key = randomUUID();
      if (!beforeSend) pgStub.interruptNext('send');
      const acceptance = ctx.app.get<RefundAcceptanceService>(
        RefundAcceptanceService,
      );
      const sendSpy = beforeSend
        ? jest
            .spyOn(acceptance, 'sendAccepted')
            .mockRejectedValueOnce(new Error('PG 전송 전 중단'))
        : null;
      try {
        await request(ctx.server)
          .post('/refund')
          .set('Authorization', `Bearer ${ctx.customer.token}`)
          .set('Idempotency-Key', key)
          .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
          .expect(500);
      } finally {
        sendSpy?.mockRestore();
      }
      const refund = await ctx.prisma.refund.findFirstOrThrow({
        where: { orderItemId: issued.orderItemId },
        include: { paymentCancels: true },
      });
      const paymentCancelId = refund.paymentCancels[0].id;
      expect(refund.payoutStatus).toBe(RefundPayoutStatus.PENDING);
      expect(refund.paymentCancels[0].status).toBe(
        PaymentCancelStatus.REQUESTED,
      );
      expect(pgStub.sendCalls).toHaveLength(beforeSend ? 0 : 1);

      const app = await newApp();
      await ctx.prisma.paymentCancel.update({
        where: { id: paymentCancelId },
        data: { claimUntil: new Date(Date.now() - 1_000) },
      });
      await ctx.prisma.refundIdempotencyRecord.updateMany({
        where: { requesterId: ctx.customer.id, key },
        data: { claimUntil: new Date(Date.now() - 1_000) },
      });
      pgStub.reset();
      pgStub.respondToInquiry({
        result: 'SUCCEEDED',
        pgTransactionId: `pg-cancel-${paymentCancelId}`,
        cancelledAmount: issued.amount,
      });
      const replay = await request(app.server)
        .post('/refund')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .set('Idempotency-Key', key)
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .expect(202);
      expect(replay.body.data.refundId).toBe(refund.id);
      await app.app.get(RefundRecoveryService).sweep(new Date());
      const recovered = await app.prisma.refund.findUniqueOrThrow({
        where: { id: refund.id },
        include: { paymentCancels: true, ledgers: true },
      });
      expect(recovered.payoutStatus).toBe(RefundPayoutStatus.PAID);
      expect(recovered.paidAmount).toBe(issued.amount);
      expect(recovered.paymentCancels).toHaveLength(1);
      expect(recovered.paymentCancels[0].status).toBe(
        PaymentCancelStatus.SUCCEEDED,
      );
      expect(recovered.ledgers).toHaveLength(1);
      expect(pgStub.inquiryCalls).toHaveLength(1);
      expect(pgStub.sendCalls).toHaveLength(0);
      expect(
        (
          await app.prisma.ticket.findUniqueOrThrow({
            where: { id: issued.ticketId },
          })
        ).status,
      ).toBe(TicketStatus.REVOKED);
    },
  );

  it('U416 PG 전송 성공 뒤 결과 저장이 실패해도 새 앱은 조회로 실제 지급을 한 번만 확정한다', async () => {
    const issued = await ctx.issuePeriodTicket();
    const dispatch = ctx.app.get<RefundDispatchService>(RefundDispatchService);
    pgStub.respondToSend({
      result: 'SUCCEEDED',
      pgTransactionId: `pg-crash-${issued.ticketId}`,
      cancelledAmount: issued.amount,
    });
    const recordSpy = jest
      .spyOn(dispatch, 'recordSendResult')
      .mockRejectedValueOnce(new Error('결과 저장 중단'));
    try {
      await request(ctx.server)
        .post('/refund')
        .set('Authorization', `Bearer ${ctx.customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .expect(500);
    } finally {
      recordSpy.mockRestore();
    }
    const refund = await ctx.prisma.refund.findFirstOrThrow({
      where: { orderItemId: issued.orderItemId },
      include: { paymentCancels: true, ledgers: true },
    });
    const paymentCancelId = refund.paymentCancels[0].id;
    expect(refund.amount).toBe(issued.amount);
    expect(refund.payoutStatus).toBe(RefundPayoutStatus.PENDING);
    expect(refund.paymentCancels[0].status).toBe(PaymentCancelStatus.REQUESTED);
    expect(refund.ledgers).toHaveLength(0);
    expect(pgStub.sendCalls).toHaveLength(1);

    const app = await newApp();
    await ctx.prisma.paymentCancel.update({
      where: { id: paymentCancelId },
      data: { claimUntil: new Date(Date.now() - 1_000) },
    });
    pgStub.reset();
    pgStub.respondToInquiry({
      result: 'SUCCEEDED',
      pgTransactionId: `pg-crash-${issued.ticketId}`,
      cancelledAmount: issued.amount,
    });
    await app.app.get(RefundRecoveryService).sweep(new Date());
    await app.app.get(RefundRecoveryService).sweep(new Date());
    const recovered = await app.prisma.refund.findUniqueOrThrow({
      where: { id: refund.id },
      include: { paymentCancels: true, ledgers: true },
    });
    expect(recovered.payoutStatus).toBe(RefundPayoutStatus.PAID);
    expect(recovered.amount).toBe(issued.amount);
    expect(recovered.paidAmount).toBe(issued.amount);
    expect(recovered.paymentCancels).toHaveLength(1);
    expect(recovered.paymentCancels[0].status).toBe(
      PaymentCancelStatus.SUCCEEDED,
    );
    expect(recovered.ledgers).toHaveLength(1);
    expect(recovered.ledgers[0].paymentCancelId).toBe(paymentCancelId);
    expect(pgStub.inquiryCalls).toHaveLength(1);
    expect(pgStub.sendCalls).toHaveLength(0);
  });

  it('U417 별도 지급 예약 뒤 작업자가 중단돼도 새 앱의 탐색은 예약을 보존하고 PG 재요청을 막는다', async () => {
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
      .send({ amount: issued.amount, reason: '계좌 이체로 지급 예정' })
      .expect(201);
    const payoutId = reserved.body.data.payoutId as string;

    const app = await newApp();
    pgStub.reset();
    await app.app.get(RefundRecoveryService).sweep(new Date());
    const retry = await request(app.server)
      .post(`/refund/${refundId}/payout-retries`)
      .set('Authorization', `Bearer ${ctx.manager.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ reason: '작업자 재시작 후 PG 재요청' })
      .expect(409);
    expect(retry.body.error.code).toBe('REFUND_PAYOUT_UNRESOLVED');
    const payout = await app.prisma.manualRefundPayout.findUniqueOrThrow({
      where: { id: payoutId },
    });
    const refund = await app.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
    });
    expect(payout.status).toBe(ManualRefundPayoutStatus.RESERVED);
    expect(refund.payoutStatus).toBe(RefundPayoutStatus.ACTION_REQUIRED);
    expect(refund.paidAmount).toBe(0);
    expect(await app.prisma.paymentCancel.count({ where: { refundId } })).toBe(
      1,
    );
    expect(pgStub.sendCalls).toHaveLength(0);
    expect(pgStub.inquiryCalls).toHaveLength(0);
  });

  it('U418 예약 작업이 유실됐다가 중복 실행돼도 새 앱은 DB의 미확정 시도를 조회·반영 한 번으로 끝낸다', async () => {
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
    await ctx.prisma.paymentCancel.update({
      where: { id: paymentCancelId },
      data: { nextInquiryAt: new Date(Date.now() - 1_000) },
    });
    const app = await newApp();
    pgStub.reset();
    pgStub.respondToInquiry({
      result: 'SUCCEEDED',
      pgTransactionId: `pg-cancel-${paymentCancelId}`,
      cancelledAmount: issued.amount,
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const originalInquire: RefundPgStub['inquireCancel'] =
      pgStub.inquireCancel.bind(pgStub);
    let inquiryStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      inquiryStarted = resolve;
    });
    let releaseInquiry!: () => void;
    const holdInquiry = new Promise<void>((resolve) => {
      releaseInquiry = resolve;
    });
    let calls = 0;
    const inquirySpy = jest
      .spyOn(pgStub, 'inquireCancel')
      .mockImplementation(async (input) => {
        const result = await originalInquire(input);
        calls += 1;
        if (calls === 1) {
          inquiryStarted();
          await holdInquiry;
        }
        return result;
      });
    try {
      const recovery = app.app.get(RefundRecoveryService);
      const first = recovery.sweep(new Date());
      await started;
      await recovery.sweep(new Date());
      expect(pgStub.inquiryCalls).toHaveLength(1);
      releaseInquiry();
      await first;
      await recovery.sweep(new Date());
    } finally {
      releaseInquiry();
      inquirySpy.mockRestore();
    }
    const recovered = await app.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { paymentCancels: true, ledgers: true },
    });
    expect(recovered.payoutStatus).toBe(RefundPayoutStatus.PAID);
    expect(recovered.amount).toBe(issued.amount);
    expect(recovered.paidAmount).toBe(issued.amount);
    expect(recovered.paymentCancels).toHaveLength(1);
    expect(recovered.paymentCancels[0].status).toBe(
      PaymentCancelStatus.SUCCEEDED,
    );
    expect(recovered.ledgers).toHaveLength(1);
    expect(recovered.ledgers[0].paymentCancelId).toBe(paymentCancelId);
    expect(pgStub.inquiryCalls).toHaveLength(1);
    expect(pgStub.sendCalls).toHaveLength(0);
  });
});
