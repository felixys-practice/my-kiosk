import {
  PaymentStatus,
  RefundDecisionStatus,
  RefundPayoutStatus,
  TicketType,
} from '@prisma/client';
import {
  CustomerRefundCandidate,
  evaluateCustomerRefund,
} from './refund-policy';

describe('evaluateCustomerRefund', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const customerId = 'customer-1';

  /**
   * 환불 가능한 기본 후보(본인의 결제 완료·미사용·기한 안 정기권)를 만든다
   * @param overrides 바꿀 필드
   * @param ticketOverrides 바꿀 이용권 필드
   * @returns 후보
   */
  function candidate(
    overrides: Partial<CustomerRefundCandidate> = {},
    ticketOverrides: Partial<CustomerRefundCandidate['ticket']> = {},
  ): CustomerRefundCandidate {
    return {
      ownerId: customerId,
      paymentStatus: PaymentStatus.SUCCESS,
      paidAmount: 10000,
      existingRefunds: [],
      ticket: {
        type: TicketType.PERIOD,
        inUse: false,
        activatedAt: null,
        activationDeadline: new Date('2026-11-27T12:00:00Z'),
        purchasedMinutes: null,
        remainingMinutes: null,
        minuteExpireDeadline: null,
        ...ticketOverrides,
      },
      ...overrides,
    };
  }

  it('본인 소유 범위 밖 이용권은 TICKET_NOT_FOUND로 판정된다', () => {
    const decision = evaluateCustomerRefund(
      candidate({ ownerId: 'other-customer' }),
      customerId,
      now,
    );

    expect(decision).toEqual({ eligible: false, code: 'TICKET_NOT_FOUND' });
  });
  it('결제가 SUCCESS가 아니면 PAYMENT_NOT_COMPLETED로 판정된다', () => {
    const decision = evaluateCustomerRefund(
      candidate({ paymentStatus: PaymentStatus.FAILED }),
      customerId,
      now,
    );

    expect(decision).toEqual({
      eligible: false,
      code: 'PAYMENT_NOT_COMPLETED',
    });
  });
  it('지급 완료(PAID) 환불이 있으면 ALREADY_REFUNDED로 판정된다', () => {
    const decision = evaluateCustomerRefund(
      candidate({
        existingRefunds: [
          {
            decisionStatus: RefundDecisionStatus.ACCEPTED,
            payoutStatus: RefundPayoutStatus.PAID,
          },
        ],
      }),
      customerId,
      now,
    );

    expect(decision).toEqual({ eligible: false, code: 'ALREADY_REFUNDED' });
  });
  it.each([RefundPayoutStatus.PENDING, RefundPayoutStatus.ACTION_REQUIRED])(
    '확정됐지만 미지급(%s)인 환불이 있으면 REFUND_IN_PROGRESS로 판정된다',
    (payoutStatus) => {
      const decision = evaluateCustomerRefund(
        candidate({
          existingRefunds: [
            { decisionStatus: RefundDecisionStatus.ACCEPTED, payoutStatus },
          ],
        }),
        customerId,
        now,
      );

      expect(decision).toEqual({ eligible: false, code: 'REFUND_IN_PROGRESS' });
    },
  );
  it('이용 중인 이용권은 USED_TICKET으로 판정된다', () => {
    const decision = evaluateCustomerRefund(
      candidate({}, { inUse: true }),
      customerId,
      now,
    );

    expect(decision).toMatchObject({ eligible: false, code: 'USED_TICKET' });
  });
  it('활성화된 정기권은 USED_TICKET으로 판정된다', () => {
    const decision = evaluateCustomerRefund(
      candidate({}, { activatedAt: new Date('2026-10-20T09:00:00Z') }),
      customerId,
      now,
    );

    expect(decision).toMatchObject({ eligible: false, code: 'USED_TICKET' });
  });
  it('활성화 전 정기권은 미사용으로 판정되어 환불 가능하다', () => {
    const decision = evaluateCustomerRefund(
      candidate({}, { activatedAt: null }),
      customerId,
      now,
    );

    expect(decision).toMatchObject({ eligible: true });
  });
  describe('시간권', () => {
    const purchasedMinutes = 600;

    /**
     * 시간권 후보를 만든다
     * @param remainingMinutes 남은 시간(분)
     * @returns 후보
     */
    function timeTicket(remainingMinutes: number): CustomerRefundCandidate {
      return candidate(
        {},
        {
          type: TicketType.TIME,
          activationDeadline: null,
          purchasedMinutes,
          remainingMinutes,
          minuteExpireDeadline: new Date('2026-11-27T12:00:00Z'),
        },
      );
    }

    it('남은 시간이 구매 시간보다 1분 적은 시간권은 USED_TICKET으로 판정된다', () => {
      const decision = evaluateCustomerRefund(
        timeTicket(purchasedMinutes - 1),
        customerId,
        now,
      );

      expect(decision).toMatchObject({ eligible: false, code: 'USED_TICKET' });
    });
  });
});

void RefundDecisionStatus;
void RefundPayoutStatus;
