import {
  PaymentCancelStatus,
  RefundDecisionStatus,
  RefundPayoutStatus,
} from '@prisma/client';
import { evaluatePayoutRetry, PayoutRetryState } from './refund-retry.policy';

describe('evaluatePayoutRetry', () => {
  const now = new Date('2026-10-29T00:00:00.000Z');
  /** 확정된 환불 금액 */
  const refundAmount = 12000;

  /**
   * 재시도할 수 있는 기본 상태(전송 전 실패로 조치 필요, 지급 없음)에 일부만 바꾼 상태를 만든다
   * @param override 바꿀 값
   * @returns 판정 입력
   */
  function stateWith(
    override: Partial<PayoutRetryState> = {},
  ): PayoutRetryState {
    return {
      decisionStatus: RefundDecisionStatus.ACCEPTED,
      payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
      amount: refundAmount,
      paidAmount: 0,
      actionCode: 'SEND_FAILED',
      attempts: [{ status: PaymentCancelStatus.FAILED, claimUntil: null }],
      activeManualPayout: false,
      ...override,
    };
  }

  it('미확정 PG 취소 요청이 있으면 REFUND_PAYOUT_UNRESOLVED로 거절한다', () => {
    const state = stateWith({
      payoutStatus: RefundPayoutStatus.PENDING,
      actionCode: null,
      attempts: [
        { status: PaymentCancelStatus.FAILED, claimUntil: null },
        { status: PaymentCancelStatus.REQUESTED, claimUntil: null },
      ],
    });

    expect(evaluatePayoutRetry(state, now)).toEqual({
      allowed: false,
      code: 'REFUND_PAYOUT_UNRESOLVED',
    });
  });

  it('활성 별도 환불금 지급 예약이 있으면 REFUND_PAYOUT_UNRESOLVED로 거절한다', () => {
    expect(
      evaluatePayoutRetry(stateWith({ activeManualPayout: true }), now),
    ).toEqual({ allowed: false, code: 'REFUND_PAYOUT_UNRESOLVED' });
  });

  it('실패한 요청에 유효한 개별 조회 담당이 있으면 REFUND_PAYOUT_UNRESOLVED로 거절하고, 담당 기한이 지났으면 허용한다', () => {
    const claimedUntil = (offsetMs: number) =>
      stateWith({
        attempts: [
          {
            status: PaymentCancelStatus.FAILED,
            claimUntil: new Date(now.getTime() + offsetMs),
          },
        ],
      });

    expect({
      valid: evaluatePayoutRetry(claimedUntil(1_000), now),
      expired: evaluatePayoutRetry(claimedUntil(0), now),
    }).toEqual({
      valid: { allowed: false, code: 'REFUND_PAYOUT_UNRESOLVED' },
      expired: { allowed: true },
    });
  });

  it('PG 결과 모순(PG_RESULT_CONFLICT)이 기록돼 있으면 REFUND_PAYOUT_UNRESOLVED로 거절한다', () => {
    expect(
      evaluatePayoutRetry(stateWith({ actionCode: 'PG_RESULT_CONFLICT' }), now),
    ).toEqual({ allowed: false, code: 'REFUND_PAYOUT_UNRESOLVED' });
  });

  it('실제 지급액이 있고 미지급액이 남으면 REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL로 거절한다', () => {
    expect(
      evaluatePayoutRetry(
        stateWith({ paidAmount: 5000, actionCode: 'AMOUNT_MISMATCH' }),
        now,
      ),
    ).toEqual({
      allowed: false,
      code: 'REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL',
    });
  });

  it('지급 완료 환불은 REFUND_PAYOUT_NOT_ACTIONABLE로 거절한다', () => {
    const paid = stateWith({
      payoutStatus: RefundPayoutStatus.PAID,
      paidAmount: refundAmount,
      actionCode: null,
      attempts: [{ status: PaymentCancelStatus.SUCCEEDED, claimUntil: null }],
    });

    expect(evaluatePayoutRetry(paid, now)).toEqual({
      allowed: false,
      code: 'REFUND_PAYOUT_NOT_ACTIONABLE',
    });
  });

  it('실제 지급액이 확정 금액 이상(초과 취소 검토 대상)이거나 확정되지 않은 환불은 REFUND_PAYOUT_NOT_ACTIONABLE로 거절한다', () => {
    const notActionable = {
      allowed: false,
      code: 'REFUND_PAYOUT_NOT_ACTIONABLE',
    };

    expect({
      overpaid: evaluatePayoutRetry(
        stateWith({
          paidAmount: refundAmount + 1,
          actionCode: 'AMOUNT_MISMATCH',
        }),
        now,
      ),
      legacy: evaluatePayoutRetry(
        stateWith({
          decisionStatus: RefundDecisionStatus.LEGACY_REJECTED,
          payoutStatus: RefundPayoutStatus.NOT_APPLICABLE,
          actionCode: null,
        }),
        now,
      ),
    }).toEqual({ overpaid: notActionable, legacy: notActionable });
  });

  it('조치 필요이고 결과가 모두 확정됐으며 지급액이 0원이면 허용한다', () => {
    expect(evaluatePayoutRetry(stateWith(), now)).toEqual({ allowed: true });
  });
});
