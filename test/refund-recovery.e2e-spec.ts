/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import {
  PaymentCancelFailureCode,
  PaymentCancelStatus,
  RefundDecisionStatus,
  RefundNotificationAudience,
  RefundPayoutStatus,
  TicketStatus,
} from '@prisma/client';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';

/**
 * 사용자 스토리 5: PG 결과 조회·재전송·장애 복구 (E2E)
 * - 테스트 이름 끝의 (QS-n-m)은 specs/002-refund-completion/spec.md 사용자 스토리 n의 인수 시나리오 m
 */
describe('PG 결과 조회·재전송·장애 복구 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'recovery',
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

  it('PG 취소 요청이 보내기 전에 실패하면 실패·지급 조치 필요를 기록해 운영자에게 알리고 이용 종료는 유지하며 응답에서 이용 종료와 미지급을 구분한다 (QS-5-1)', async () => {
    const issued = await ctx.issuePeriodTicket();
    pgStub.respondToSend({ result: 'NOT_SENT', reason: 'PG 연결 설정 누락' });

    const res = await request(ctx.server)
      .post('/refund')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);

    expect(res.body.data).toMatchObject({
      decisionStatus: RefundDecisionStatus.ACCEPTED,
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
    });
    expect(res.body.data.terminatedAt).toEqual(expect.any(String));
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: res.body.data.refundId as string },
      include: { paymentCancels: true, notifications: true },
    });
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect({
      attempt: refund.paymentCancels[0].status,
      failureCode: refund.paymentCancels[0].failureCode,
      payoutStatus: refund.payoutStatus,
      operatorNotified: refund.notifications.some(
        (n) => n.audience === RefundNotificationAudience.OPERATOR,
      ),
      ticket: ticket.status,
    }).toEqual({
      attempt: PaymentCancelStatus.FAILED,
      failureCode: PaymentCancelFailureCode.SEND_FAILED,
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      operatorNotified: true,
      ticket: TicketStatus.REVOKED,
    });
  });
});
