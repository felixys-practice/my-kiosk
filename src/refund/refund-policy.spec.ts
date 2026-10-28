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
});

void RefundDecisionStatus;
void RefundPayoutStatus;
