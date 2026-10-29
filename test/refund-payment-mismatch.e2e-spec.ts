/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { signedCallback } from './helpers/pg-callback';
import {
  PaymentCancelStatus,
  PaymentStatus,
  RefundDecisionStatus,
  RefundPayoutStatus,
  RefundSource,
  RefundTargetKind,
  SeatAssignmentStatus,
} from '@prisma/client';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import { RefundRecoveryService } from '../src/refund/refund-recovery.service';
import { RefundSystemService } from '../src/refund/refund-system.service';
import {
  AwaitingPayment,
  createRefundTestContext,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';

/**
 * 사용자 스토리 6: 결제 승인 금액이 맞지 않으면 승인을 취소한다 (E2E)
 * - 테스트 이름 끝의 (QS-n-m)은 specs/002-refund-completion/spec.md 사용자 스토리 n의 인수 시나리오 m
 */
describe('승인 금액 불일치의 자동 취소 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;
  /** 요청액보다 적게 승인된 금액과의 차이(원) */
  const shortfall = 1000;

  /**
   * PG가 결제 금액과 다른 금액으로 승인했다는 콜백을 보낸다
   * @param awaiting 승인 콜백을 기다리는 결제
   * @param approvedAmount PG가 승인했다고 알린 금액
   * @returns 응답
   */
  function sendApprovalCallback(
    awaiting: AwaitingPayment,
    approvedAmount: number,
  ) {
    return signedCallback(ctx.server, '/payments/callback', {
      success: true,
      pgTransactionId: awaiting.pgTransactionId,
      amount: approvedAmount,
      reason: null,
    });
  }

  /**
   * 결제의 자동 취소 환불과 PG 취소 요청을 읽는다
   * @param paymentId 결제 ID
   * @returns 환불(없으면 null)
   */
  function findSystemRefund(paymentId: string) {
    return ctx.prisma.refund.findFirst({
      where: { paymentId },
      include: { paymentCancels: { orderBy: { attemptNumber: 'asc' } } },
    });
  }

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'mismatch',
      configure: (builder) =>
        builder.overrideProvider(REFUND_PG_GATEWAY).useValue(pgStub),
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    pgStub.reset();
  });

  it('PG가 결제 금액과 다른 금액으로 승인했다고 알리면 결제는 실패, 이용권은 미발행, 좌석 선점은 해제되고 PG가 승인한 금액 전액의 환불과 최초 PG 취소 요청을 함께 저장해 지급을 시작한다 (QS-6-1)', async () => {
    const awaiting = await ctx.orderPeriodAwaitingApproval({ fixedSeat: true });
    const approvedAmount = awaiting.amount - shortfall;
    pgStub.respondToSend({ result: 'ACCEPTED' });

    await sendApprovalCallback(awaiting, approvedAmount).expect(200);

    const payment = await ctx.prisma.payment.findUniqueOrThrow({
      where: { id: awaiting.paymentId },
    });
    const tickets = await ctx.prisma.ticket.count({
      where: { orderItem: { orderId: awaiting.orderId } },
    });
    const holds = await ctx.prisma.seatAssignment.findMany({
      where: { seatId: awaiting.seatId },
    });
    const refund = await findSystemRefund(awaiting.paymentId);
    expect({
      payment: [payment.status, payment.amount, payment.approvedAmount],
      tickets,
      holds: holds.map((hold) => hold.status),
      refund: refund && [
        refund.targetKind,
        refund.source,
        refund.decisionStatus,
        refund.amount,
        refund.payoutStatus,
        refund.orderItemId,
      ],
      attempts: refund?.paymentCancels.map((attempt) => [
        attempt.status,
        attempt.amount,
        attempt.orderItemId,
      ]),
      sent: pgStub.sendCalls.map((call) => [call.paymentCancelId, call.amount]),
    }).toEqual({
      payment: [PaymentStatus.FAILED, awaiting.amount, approvedAmount],
      tickets: 0,
      holds: [SeatAssignmentStatus.RELEASED],
      refund: [
        RefundTargetKind.PAYMENT,
        RefundSource.SYSTEM,
        RefundDecisionStatus.ACCEPTED,
        approvedAmount,
        RefundPayoutStatus.PENDING,
        null,
      ],
      attempts: [[PaymentCancelStatus.REQUESTED, approvedAmount, null]],
      sent: [[refund?.paymentCancels[0]?.id, approvedAmount]],
    });
  });

  it('자동 취소 환불이 확정된 뒤 PG가 확정된 환불 금액의 취소를 확정하면 환불금 지급 완료가 되고 실패 결제는 성공으로 복구하지 않는다 (QS-6-2)', async () => {
    const awaiting = await ctx.orderPeriodAwaitingApproval();
    const approvedAmount = awaiting.amount - shortfall;
    pgStub.respondToSend({ result: 'ACCEPTED' });
    await sendApprovalCallback(awaiting, approvedAmount).expect(200);
    const attempt = (await findSystemRefund(awaiting.paymentId))!
      .paymentCancels[0];

    await signedCallback(ctx.server, '/refund/callback', {
      success: true,
      paymentCancelId: attempt.id,
      pgTransactionId: `pg-cancel-${attempt.id}`,
      orderItemId: null,
      amount: approvedAmount,
    }).expect(200);

    const refund = await findSystemRefund(awaiting.paymentId);
    const payment = await ctx.prisma.payment.findUniqueOrThrow({
      where: { id: awaiting.paymentId },
    });
    expect({
      payoutStatus: refund?.payoutStatus,
      paidAmount: refund?.paidAmount,
      payment: payment.status,
    }).toEqual({
      payoutStatus: RefundPayoutStatus.PAID,
      paidAmount: approvedAmount,
      payment: PaymentStatus.FAILED,
    });
  });

  it('자동 취소의 PG 응답이 없으면 정해진 시간 뒤 거래조회로 사용자 스토리 5와 같이 처리한다(미접수면 같은 금액으로 다시 보낸다) (QS-6-3)', async () => {
    const awaiting = await ctx.orderPeriodAwaitingApproval();
    const approvedAmount = awaiting.amount - shortfall;
    pgStub.respondToSend({ result: 'UNKNOWN', reason: '응답 시간 초과' });
    await sendApprovalCallback(awaiting, approvedAmount).expect(200);
    const attempt = (await findSystemRefund(awaiting.paymentId))!
      .paymentCancels[0];
    pgStub
      .respondToInquiry({ result: 'NOT_FOUND', authoritative: true })
      .respondToSend({ result: 'ACCEPTED' });

    await ctx.app
      .get(RefundRecoveryService)
      .inquireAttempt(attempt.id, new Date(Date.now() + 61_000));

    const after = await ctx.prisma.paymentCancel.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect({
      sent: pgStub.sendCalls.map((call) => [call.paymentCancelId, call.amount]),
      resendCount: after.resendCount,
      status: after.status,
    }).toEqual({
      sent: [
        [attempt.id, approvedAmount],
        [attempt.id, approvedAmount],
      ],
      resendCount: 1,
      status: PaymentCancelStatus.REQUESTED,
    });
  });

  it('결제 금액과 같은 금액으로 승인되면 기존처럼 이용권이 발행되고 자동 취소 환불은 없다 (QS-6-4)', async () => {
    const issued = await ctx.issuePeriodTicket();

    const ticket = await ctx.prisma.ticket.findUnique({
      where: { id: issued.ticketId },
    });
    const refund = await findSystemRefund(issued.paymentId);
    expect({ ticket: ticket !== null, refund }).toEqual({
      ticket: true,
      refund: null,
    });
  });

  it('자동 취소 환불 저장 중 오류로 중단되면 결제·좌석 선점·환불 어느 것도 바뀌지 않는다', async () => {
    const awaiting = await ctx.orderPeriodAwaitingApproval({ fixedSeat: true });
    const failing = jest
      .spyOn(ctx.app.get(RefundSystemService), 'acceptPaymentMismatch')
      .mockRejectedValueOnce(new Error('저장 중단'));

    const res = await sendApprovalCallback(awaiting, awaiting.amount - 1);
    failing.mockRestore();

    const payment = await ctx.prisma.payment.findUniqueOrThrow({
      where: { id: awaiting.paymentId },
    });
    const holds = await ctx.prisma.seatAssignment.findMany({
      where: { seatId: awaiting.seatId },
    });
    const refund = await findSystemRefund(awaiting.paymentId);
    expect({
      failed: res.status >= 500,
      payment: [payment.status, payment.approvedAmount],
      holds: holds.map((hold) => hold.status),
      refund,
      sends: pgStub.sendCalls.length,
    }).toEqual({
      failed: true,
      payment: [PaymentStatus.REQUESTED, null],
      holds: [SeatAssignmentStatus.HELD],
      refund: null,
      sends: 0,
    });
  });
});
