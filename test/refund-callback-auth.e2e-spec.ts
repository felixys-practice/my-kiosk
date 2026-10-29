/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { PaymentCancelStatus, RefundPayoutStatus } from '@prisma/client';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';

/**
 * 사용자 스토리 7: PG 콜백은 PG만 보낼 수 있다 (E2E)
 * - 테스트 이름 끝의 (QS-n-m)은 specs/002-refund-completion/spec.md 사용자 스토리 n의 인수 시나리오 m
 */
describe('PG 콜백 서명 인증 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;

  /**
   * 고객 환불을 접수해 지급 처리 중(PG가 접수만 한 상태)으로 둔다
   * @returns 환불·PG 취소 요청·주문 항목·금액
   */
  async function pendingRefund() {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'ACCEPTED' });
    const res = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    const refundId = res.body.data.refundId as string;
    const attempt = await ctx.prisma.paymentCancel.findFirstOrThrow({
      where: { refundId },
    });
    return {
      refundId,
      paymentCancelId: attempt.id,
      orderItemId: issued.orderItemId,
      amount: attempt.amount,
    };
  }

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'callback-auth',
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

  it('지급 처리 중인 환불에 로그인한 사용자가 서명 없이 환불 결과 콜백을 보내면 거부되고 지급 상태는 바뀌지 않는다 (QS-7-3)', async () => {
    const pending = await pendingRefund();

    const res = await request(ctx.server)
      .post('/refund/callback')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({
        success: true,
        paymentCancelId: pending.paymentCancelId,
        pgTransactionId: `pg-cancel-${pending.paymentCancelId}`,
        orderItemId: pending.orderItemId,
        amount: pending.amount,
      });

    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: pending.refundId },
      include: { paymentCancels: true },
    });
    expect({
      status: res.status,
      code: res.body.error?.code,
      payoutStatus: refund.payoutStatus,
      attempt: refund.paymentCancels[0].status,
    }).toEqual({
      status: 401,
      code: 'PG_CALLBACK_UNAUTHORIZED',
      payoutStatus: RefundPayoutStatus.PENDING,
      attempt: PaymentCancelStatus.REQUESTED,
    });
  });
});
