import {
  PaymentCancelStatus,
  RefundDecisionStatus,
  RefundPayoutStatus,
} from '@prisma/client';
import { evaluateManualReservation } from './refund-manual-payout.policy';
import { PayoutRetryState } from './refund-retry.policy';

describe('evaluateManualReservation', () => {
  const now = new Date('2026-10-29T00:00:00.000Z');
  /** 확정된 환불 금액 */
  const refundAmount = 12000;

  /**
   * 예약할 수 있는 기본 상태(PG 거절로 조치 필요, 지급 없음)에 일부만 바꾼 상태를 만든다
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
      actionCode: 'PG_REJECTED',
      attempts: [{ status: PaymentCancelStatus.FAILED, claimUntil: null }],
      activeManualPayout: false,
      ...override,
    };
  }

  it('결과가 확정되지 않은 PG 취소 요청이 있으면 REFUND_PAYOUT_UNRESOLVED로 거절한다', () => {
    const state = stateWith({
      attempts: [
        { status: PaymentCancelStatus.QUERY_FAILED, claimUntil: null },
      ],
    });

    expect(evaluateManualReservation(state, refundAmount, now)).toEqual({
      allowed: false,
      code: 'REFUND_PAYOUT_UNRESOLVED',
    });
  });

  it('예약 금액이 미지급액과 다르면 REFUND_OUTSTANDING_AMOUNT_MISMATCH로 거절한다', () => {
    expect(
      evaluateManualReservation(stateWith(), refundAmount - 1, now),
    ).toEqual({ allowed: false, code: 'REFUND_OUTSTANDING_AMOUNT_MISMATCH' });
  });

  it('지급 완료이거나 실제 지급액이 확정 금액 이상(초과 취소 검토 대상)이면 REFUND_PAYOUT_NOT_ACTIONABLE로 거절한다', () => {
    const notActionable = {
      allowed: false,
      code: 'REFUND_PAYOUT_NOT_ACTIONABLE',
    };

    expect({
      paid: evaluateManualReservation(
        stateWith({
          payoutStatus: RefundPayoutStatus.PAID,
          paidAmount: refundAmount,
          actionCode: null,
          attempts: [
            { status: PaymentCancelStatus.SUCCEEDED, claimUntil: null },
          ],
        }),
        0,
        now,
      ),
      overpaid: evaluateManualReservation(
        stateWith({
          paidAmount: refundAmount + 1000,
          actionCode: 'AMOUNT_MISMATCH',
          attempts: [
            { status: PaymentCancelStatus.SUCCEEDED, claimUntil: null },
          ],
        }),
        -1000,
        now,
      ),
    }).toEqual({ paid: notActionable, overpaid: notActionable });
  });

  it('PG가 적게 취소한 환불은 부족액(확정 금액 - 실제 지급액)만 예약할 수 있다', () => {
    const underpaid = stateWith({
      paidAmount: 9000,
      actionCode: 'AMOUNT_MISMATCH',
      attempts: [{ status: PaymentCancelStatus.SUCCEEDED, claimUntil: null }],
    });

    expect(evaluateManualReservation(underpaid, 3000, now)).toEqual({
      allowed: true,
      outstandingAmount: 3000,
    });
  });

  it('지급 처리 중(PENDING)이고 결과가 확정되지 않은 PG 취소 요청이 있으면 재처리 불가가 아니라 REFUND_PAYOUT_UNRESOLVED로 거절한다', () => {
    const inProgress = stateWith({
      payoutStatus: RefundPayoutStatus.PENDING,
      actionCode: null,
      attempts: [{ status: PaymentCancelStatus.REQUESTED, claimUntil: null }],
    });

    expect(evaluateManualReservation(inProgress, refundAmount, now)).toEqual({
      allowed: false,
      code: 'REFUND_PAYOUT_UNRESOLVED',
    });
  });
});
