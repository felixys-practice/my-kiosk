/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import {
  PaymentCancelStatus,
  RefundPayoutStatus,
  SeatAssignmentStatus,
  TicketStatus,
} from '@prisma/client';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  IssuedTicket,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';

/**
 * 사용자 스토리 3: 종료된 이용권의 입실 차단 (E2E)
 * - 테스트 이름 끝의 (QS-n-m)은 specs/002-refund-completion/spec.md 사용자 스토리 n의 인수 시나리오 m
 */
describe('종료된 이용권의 입실 차단 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'entry',
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

  /**
   * 고정석 정기권을 발급해 고객 환불로 이용을 종료한다
   * @returns 발급 정보와 환불·PG 취소 요청 ID
   */
  async function refundedFixedTicket(): Promise<
    IssuedTicket & { refundId: string; paymentCancelId: string }
  > {
    const issued = await ctx.issuePeriodTicket({ fixedSeat: true });
    const { body } = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    return {
      ...issued,
      refundId: body.data.refundId as string,
      paymentCancelId: body.data.paymentCancelId as string,
    };
  }

  /**
   * 고객이 이용권으로 입실한다
   * @param issued 이용권(고정석이면 배정됐던 좌석으로 입실)
   * @returns supertest 요청
   */
  function enter(issued: IssuedTicket) {
    return request(ctx.server)
      .post('/usage-sessions')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({
        ticketId: issued.ticketId,
        shopId: ctx.shop.id,
        seatId: issued.seatId,
        userId: ctx.customer.id,
      });
  }

  it('환불로 이용이 종료되고 지급도 완료된 이용권으로 입실하면 이용 종료 오류로 거부된다 (QS-3-1)', async () => {
    const refunded = await refundedFixedTicket();
    await request(ctx.server)
      .post('/refund/callback')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({
        success: true,
        paymentCancelId: refunded.paymentCancelId,
        pgTransactionId: `pg-cancel-${refunded.paymentCancelId}`,
        orderItemId: refunded.orderItemId,
        amount: refunded.amount,
        reason: null,
      })
      .expect(200);
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: refunded.refundId },
    });
    expect(refund.payoutStatus).toBe(RefundPayoutStatus.PAID);

    const res = await enter(refunded).expect(409);

    expect(res.body.error.code).toBe('TICKET_TERMINATED');
  });

  it.each([
    [
      '환불금 지급 처리 중',
      PaymentCancelStatus.REQUESTED,
      RefundPayoutStatus.PENDING,
    ],
    [
      'PG 취소 결과 확인 실패',
      PaymentCancelStatus.QUERY_FAILED,
      RefundPayoutStatus.PENDING,
    ],
  ])(
    '%s인 종료 이용권으로 입실하면 지급 완료 여부와 관계없이 이용 종료 오류로 거부된다 (QS-3-2)',
    async (_label, attemptStatus, payoutStatus) => {
      const refunded = await refundedFixedTicket();
      await ctx.prisma.paymentCancel.update({
        where: { id: refunded.paymentCancelId },
        data: { status: attemptStatus },
      });
      const refund = await ctx.prisma.refund.findUniqueOrThrow({
        where: { id: refunded.refundId },
      });
      expect(refund.payoutStatus).toBe(payoutStatus);

      const res = await enter(refunded).expect(409);

      expect(res.body.error.code).toBe('TICKET_TERMINATED');
    },
  );

  it('환불 확정 뒤 PG 취소 요청이 실패한 이용권으로 입실하면 이용 종료 오류로 거부되고 이용권·고정석은 복구되지 않는다 (QS-3-3)', async () => {
    const refunded = await refundedFixedTicket();
    await request(ctx.server)
      .post('/refund/callback')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({
        success: false,
        paymentCancelId: refunded.paymentCancelId,
        pgTransactionId: `pg-cancel-${refunded.paymentCancelId}`,
        orderItemId: refunded.orderItemId,
        amount: refunded.amount,
        reason: '취소 가능 기간 경과',
      })
      .expect(200);

    const res = await enter(refunded).expect(409);

    expect(res.body.error.code).toBe('TICKET_TERMINATED');
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: refunded.ticketId },
    });
    const activeAssignment = await ctx.prisma.seatAssignment.findFirst({
      where: {
        ticketId: refunded.ticketId,
        status: SeatAssignmentStatus.ACTIVE,
      },
    });
    expect({ ticket: ticket.status, activeAssignment }).toEqual({
      ticket: TicketStatus.REVOKED,
      activeAssignment: null,
    });
  });

  it('입실을 먼저 하면 뒤이은 고객 환불은 사용 이력이 있는 이용권으로 거절된다 (입실 먼저 순서)', async () => {
    const issued = await ctx.issuePeriodTicket({ fixedSeat: true });
    await enter(issued).expect(201);

    const res = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(409);

    expect(res.body.error.code).toBe('USED_TICKET');
  });
});
