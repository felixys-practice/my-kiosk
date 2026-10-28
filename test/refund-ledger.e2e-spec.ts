/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { LedgerStatus } from '@prisma/client';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  IssuedTicket,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';

/**
 * 사용자 스토리 4: 실제 지급별 원장 기록 (E2E)
 * - 테스트 이름 끝의 (QS-n-m)은 specs/002-refund-completion/spec.md 사용자 스토리 n의 인수 시나리오 m
 * - PG 결과 콜백은 US7(서명 인증) 전까지 기존 JWT 인증 경로로 보낸다
 */
describe('실제 지급별 원장 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'ledger',
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
   * 미사용 정기권을 발급해 고객 환불로 확정한다(지급 처리 중)
   * @returns 발급 정보와 환불·PG 취소 요청 ID
   */
  async function acceptedRefund(): Promise<
    IssuedTicket & { refundId: string; paymentCancelId: string }
  > {
    const issued = await ctx.issuePeriodTicket();
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
   * PG 취소 결과 콜백을 보낸다
   * @param body 콜백 본문
   * @returns supertest 요청
   */
  function sendRefundCallback(body: object) {
    return request(ctx.server)
      .post('/refund/callback')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send(body);
  }

  it('환불금 지급 처리 중에 PG가 취소를 확정하면 그 매장·주문의 실제 취소 금액만큼 음수 원장 1건이 생긴다 (QS-4-1)', async () => {
    const accepted = await acceptedRefund();

    await sendRefundCallback({
      success: true,
      paymentCancelId: accepted.paymentCancelId,
      pgTransactionId: `pg-cancel-${accepted.paymentCancelId}`,
      orderItemId: accepted.orderItemId,
      amount: accepted.amount,
      reason: null,
    }).expect(200);

    const ledgers = await ctx.prisma.ledger.findMany({
      where: { refundId: accepted.refundId },
    });
    expect(ledgers).toEqual([
      expect.objectContaining({
        shopId: ctx.shop.id,
        orderId: accepted.orderId,
        amount: -accepted.amount,
        status: LedgerStatus.RELEASABLE,
        paymentCancelId: accepted.paymentCancelId,
      }),
    ]);
  });
});
