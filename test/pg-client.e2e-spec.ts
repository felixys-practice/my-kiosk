import { RefundDispatchService } from '../src/refund/refund-dispatch.service';
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { vi } from 'vitest';
import {
  PaymentCancelStatus,
  RefundPayoutStatus,
  TicketStatus,
} from '@prisma/client';
import { PG_CLIENT } from '../src/pg/pg.client';
import { PgService } from '../src/pg/pg.service';
import { SimulatedPgClient } from '../src/pg/simulated-pg.client';
import { ProductionPgClient } from '../src/pg/production-pg.client';
import { RefundRecoveryService } from '../src/refund/refund-recovery.service';
import {
  createRefundTestContext,
  type RefundTestContext,
} from './helpers/refund-test-context';
import { signedCallback } from './helpers/pg-callback';

describe('실제 모의 PG를 연결한 환불 (E2E)', () => {
  let ctx: RefundTestContext;
  beforeAll(async () => {
    ctx = await createRefundTestContext({ label: 'pg-client' });
  });
  afterAll(async () => {
    await ctx.close();
  });
  afterEach(() => vi.restoreAllMocks());

  async function refundTicket(context = ctx) {
    const issued = await context.issuePeriodTicket();
    const { body } = await request(context.server)
      .post('/refund')
      .set('Authorization', `Bearer ${context.customer.token}`)
      .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
      .expect(202);
    return {
      issued,
      refundId: body.data.refundId as string,
      paymentCancelId: body.data.paymentCancelId as string,
    };
  }

  it('모의 취소 즉시 성공을 지급액·원장에 반영하고 조회·중복 콜백에도 중복 지급하지 않는다 (QS-6, QS-7, QS-3)', async () => {
    const client = ctx.app.get<SimulatedPgClient>(PG_CLIENT);
    expect(client).toBeInstanceOf(SimulatedPgClient);
    expect(ctx.app.get(PgService)).toBeInstanceOf(PgService);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const productionSpy = vi.spyOn(
      ProductionPgClient.prototype,
      'requestPaymentCancel',
    );
    const { issued, refundId, paymentCancelId } = await refundTicket();
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
    });
    const attempt = await ctx.prisma.paymentCancel.findUniqueOrThrow({
      where: { id: paymentCancelId },
    });
    expect(refund.payoutStatus).toBe(RefundPayoutStatus.PAID);
    expect(attempt).toMatchObject({
      status: PaymentCancelStatus.SUCCEEDED,
      amount: issued.amount,
      actualAmount: issued.amount,
    });
    expect(
      (
        await ctx.prisma.ticket.findUniqueOrThrow({
          where: { id: issued.ticketId },
        })
      ).status,
    ).toBe(TicketStatus.REVOKED);
    const expected = {
      result: 'SUCCEEDED',
      paymentCancelId,
      pgTransactionId: attempt.pgTransactionId,
      cancelledAmount: issued.amount,
    };
    expect(
      await client.inquirePaymentCancel(
        { paymentCancelId },
        new AbortController().signal,
      ),
    ).toEqual(expected);
    expect(
      await ctx.app.get(PgService).inquirePaymentCancel({ paymentCancelId }),
    ).toEqual(expected);
    await signedCallback(ctx.server, '/refund/callback', {
      success: true,
      paymentCancelId,
      pgTransactionId: attempt.pgTransactionId,
      amount: issued.amount,
      reason: null,
    }).expect(200);
    await ctx.app
      .get(RefundRecoveryService)
      .inquireAttempt(paymentCancelId, new Date());
    const { body } = await request(ctx.server)
      .get(`/refund/${refundId}`)
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .expect(200);
    expect(body.data).toMatchObject({
      payoutStatus: 'PAID',
      paidAmount: issued.amount,
    });
    expect(await ctx.prisma.ledger.findMany({ where: { refundId } })).toEqual([
      expect.objectContaining({ paymentCancelId, amount: -issued.amount }),
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(productionSpy).not.toHaveBeenCalled();
  });
  it('앱을 종료하고 재생성해도 환불 조회는 유지되고 모의 처리 기록은 사라진다 (QS-8)', async () => {
    const first = await createRefundTestContext({ label: 'pg-restart-a' });
    let second: RefundTestContext | undefined;
    try {
      const { issued, refundId, paymentCancelId } = await refundTicket(first);
      await first.stopApplication();
      second = await createRefundTestContext({ label: 'pg-restart-b' });
      const { body } = await request(second.server)
        .get(`/refund/${refundId}`)
        .set('Authorization', `Bearer ${first.customer.token}`)
        .expect(200);
      expect(body.data).toMatchObject({
        payoutStatus: 'PAID',
        paidAmount: issued.amount,
      });
      const client = second.app.get<SimulatedPgClient>(PG_CLIENT);
      expect(
        await client.inquirePaymentCancel(
          { paymentCancelId },
          new AbortController().signal,
        ),
      ).toEqual({ result: 'QUERY_ERROR', reason: expect.any(String) });
      expect(await second.prisma.ledger.count({ where: { refundId } })).toBe(1);
    } finally {
      try {
        await first.close();
      } finally {
        await second?.close();
      }
    }
  });

  it('성공 반영 전 앱이 중단되어 모의 기록을 잃으면 조회 오류로 남기고 취소를 재전송하지 않는다 (QS-9)', async () => {
    const first = await createRefundTestContext({ label: 'pg-lost-a' });
    let second: RefundTestContext | undefined;
    try {
      const issued = await first.issuePeriodTicket();
      const interrupted = vi
        .spyOn(first.app.get(RefundDispatchService), 'recordSendResult')
        .mockRejectedValueOnce(
          new Error('테스트: PG 성공 후 업무 결과 저장 전 중단'),
        );
      await request(first.server)
        .post('/refund')
        .set('Authorization', `Bearer ${first.customer.token}`)
        .send({ ticketId: issued.ticketId, consentToTerminateTicket: true })
        .expect(500);
      interrupted.mockRestore();
      const refund = await first.prisma.refund.findFirstOrThrow({
        where: { orderItemId: issued.orderItemId },
        include: { paymentCancels: true },
      });
      const before = refund.paymentCancels[0];
      expect(
        await first.app
          .get<SimulatedPgClient>(PG_CLIENT)
          .inquirePaymentCancel(
            { paymentCancelId: before.id },
            new AbortController().signal,
          ),
      ).toMatchObject({ result: 'SUCCEEDED' });
      await first.stopApplication();
      second = await createRefundTestContext({ label: 'pg-lost-b' });
      const client = second.app.get<SimulatedPgClient>(PG_CLIENT);
      const send = vi.spyOn(client, 'requestPaymentCancel');
      expect(
        await client.inquirePaymentCancel(
          { paymentCancelId: 'unrecorded-id' },
          new AbortController().signal,
        ),
      ).toMatchObject({ result: 'QUERY_ERROR' });
      expect(
        await second.app
          .get(RefundRecoveryService)
          .inquireAttempt(before.id, new Date(Date.now() + 120000)),
      ).toBe('QUERY_ERROR');
      const after = await second.prisma.paymentCancel.findUniqueOrThrow({
        where: { id: before.id },
      });
      expect(after).toMatchObject({
        sendAttemptCount: before.sendAttemptCount,
        resendCount: before.resendCount,
        inquiryFailureCount: before.inquiryFailureCount + 1,
        actualAmount: null,
      });
      expect(send).not.toHaveBeenCalled();
      expect(
        await second.prisma.ledger.count({ where: { refundId: refund.id } }),
      ).toBe(0);
      const { body } = await request(second.server)
        .get(`/refund/${refund.id}`)
        .set('Authorization', `Bearer ${first.customer.token}`)
        .expect(200);
      expect(body.data).toMatchObject({
        payoutStatus: 'PENDING',
        paidAmount: 0,
      });
      send.mockRestore();
    } finally {
      try {
        await first.close();
      } finally {
        await second?.close();
      }
    }
  });
});
