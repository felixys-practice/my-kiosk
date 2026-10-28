/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import {
  RefundDecisionStatus,
  RefundPayoutStatus,
  RefundSource,
  SeatAssignmentStatus,
  TicketStatus,
} from '@prisma/client';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import {
  createRefundTestContext,
  IssuedTicket,
  RefundTestContext,
  TestActor,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';

/**
 * 사용자 스토리 2: 점주의 매장 환불 (E2E)
 * - 테스트 이름 끝의 (QS-n-m)은 specs/002-refund-completion/spec.md 사용자 스토리 n의 인수 시나리오 m
 */
describe('매장 환불 (E2E)', () => {
  const pgStub = new RefundPgStub();
  let ctx: RefundTestContext;

  beforeAll(async () => {
    ctx = await createRefundTestContext({
      label: 'store',
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
   * 점주 권한으로 매장 환불을 요청한다
   * @param body 요청 본문
   * @param actor 요청자(기본: 주 매장 점주)
   * @param shopId 대상 매장(기본: 주 매장)
   * @returns supertest 요청
   */
  function requestStoreRefund(
    body: object,
    actor: TestActor = ctx.owner,
    shopId: string = ctx.shop.id,
  ) {
    return request(ctx.server)
      .post(`/refund/shop/${shopId}`)
      .set('Authorization', `Bearer ${actor.token}`)
      .send(body);
  }

  /**
   * 사용 이력이 있는(이미 활성화된) 고정석 정기권을 만든다
   * @returns 발급 정보
   */
  async function usedPeriodTicket(): Promise<IssuedTicket> {
    const issued = await ctx.issuePeriodTicket({ fixedSeat: true });
    await ctx.prisma.ticket.update({
      where: { id: issued.ticketId },
      data: {
        status: TicketStatus.ACTIVE,
        activatedAt: new Date(Date.now() - 86_400_000),
      },
    });
    return issued;
  }

  it('사용 이력이 있는 이용권을 점주가 실결제액 이하 금액과 사유로 환불하면 이용 종료·고정석 해제·그 금액의 환불이 확정되고 점주·시각·사유·금액이 기록되며 지급 처리 중으로 응답한다 (QS-2-1)', async () => {
    const issued = await usedPeriodTicket();
    const amount = issued.amount - 3000;

    const res = await requestStoreRefund({
      ticketId: issued.ticketId,
      amount,
      reason: '서비스 불만 보상',
      consentToTerminateTicket: true,
    }).expect(202);

    // 응답: 이용 종료 완료·환불금 지급 처리 중
    expect(res.body.data).toMatchObject({
      decisionStatus: RefundDecisionStatus.ACCEPTED,
      ticketId: issued.ticketId,
      amount,
      payoutStatus: RefundPayoutStatus.PENDING,
    });

    // 저장 결과: 점주·시각·사유·금액, 이용 종료, 고정석 해제, PG 결제 취소 시작
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: res.body.data.refundId as string },
    });
    expect({
      source: refund.source,
      amount: refund.amount,
      reason: refund.reason,
      requestedById: refund.requestedById,
      acceptedAt: refund.acceptedAt instanceof Date,
    }).toEqual({
      source: RefundSource.STORE,
      amount,
      reason: '서비스 불만 보상',
      requestedById: ctx.owner.id,
      acceptedAt: true,
    });
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    expect(ticket.status).toBe(TicketStatus.REVOKED);
    const activeAssignment = await ctx.prisma.seatAssignment.findFirst({
      where: {
        ticketId: issued.ticketId,
        status: SeatAssignmentStatus.ACTIVE,
      },
    });
    expect(activeAssignment).toBeNull();
    expect(pgStub.sendCalls).toEqual([expect.objectContaining({ amount })]);
  });
});
