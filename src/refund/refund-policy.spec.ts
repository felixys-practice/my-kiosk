import {
  PaymentStatus,
  RefundDecisionStatus,
  RefundPayoutStatus,
  TicketType,
} from '@prisma/client';
import {
  CustomerRefundCandidate,
  evaluateCustomerRefund,
  evaluateStoreRefund,
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

    it('신청 시각이 시간권 소진 기한과 같으면 기한 안으로 허용된다', () => {
      const ticket = timeTicket(purchasedMinutes);

      const decision = evaluateCustomerRefund(
        ticket,
        customerId,
        new Date(ticket.ticket.minuteExpireDeadline!.getTime()),
      );

      expect(decision).toMatchObject({ eligible: true });
    });

    it('신청 시각이 시간권 소진 기한보다 1ms 늦으면 EXPIRED_TICKET으로 판정된다', () => {
      const ticket = timeTicket(purchasedMinutes);

      const decision = evaluateCustomerRefund(
        ticket,
        customerId,
        new Date(ticket.ticket.minuteExpireDeadline!.getTime() + 1),
      );

      expect(decision).toMatchObject({
        eligible: false,
        code: 'EXPIRED_TICKET',
      });
    });

    it('남은 시간이 구매 시간과 같은 시간권은 미사용으로 판정되어 환불 가능하다', () => {
      const decision = evaluateCustomerRefund(
        timeTicket(purchasedMinutes),
        customerId,
        now,
      );

      expect(decision).toMatchObject({ eligible: true });
    });

    it('남은 시간이 구매 시간보다 1분 적은 시간권은 USED_TICKET으로 판정된다', () => {
      const decision = evaluateCustomerRefund(
        timeTicket(purchasedMinutes - 1),
        customerId,
        now,
      );

      expect(decision).toMatchObject({ eligible: false, code: 'USED_TICKET' });
    });
  });
  it('결제 미완료와 사용 이력이 함께 있으면 PAYMENT_NOT_COMPLETED가 먼저 판정된다', () => {
    const decision = evaluateCustomerRefund(
      candidate({ paymentStatus: PaymentStatus.FAILED }, { inUse: true }),
      customerId,
      now,
    );

    expect(decision).toMatchObject({ code: 'PAYMENT_NOT_COMPLETED' });
  });

  it('미지급 확정 환불과 사용 이력이 함께 있으면 REFUND_IN_PROGRESS가 먼저 판정된다', () => {
    const decision = evaluateCustomerRefund(
      candidate(
        {
          existingRefunds: [
            {
              decisionStatus: RefundDecisionStatus.ACCEPTED,
              payoutStatus: RefundPayoutStatus.PENDING,
            },
          ],
        },
        { activatedAt: new Date('2026-10-20T09:00:00Z') },
      ),
      customerId,
      now,
    );

    expect(decision).toMatchObject({ code: 'REFUND_IN_PROGRESS' });
  });
  describe('정기권 활성화 기한', () => {
    const activationDeadline = new Date('2026-11-27T12:00:00.000Z');

    it('신청 시각이 활성화 기한과 같으면 기한 안으로 허용된다', () => {
      const decision = evaluateCustomerRefund(
        candidate({}, { activationDeadline }),
        customerId,
        new Date(activationDeadline.getTime()),
      );

      expect(decision).toMatchObject({ eligible: true });
    });

    it('신청 시각이 활성화 기한보다 1ms 늦으면 EXPIRED_TICKET으로 판정된다', () => {
      const decision = evaluateCustomerRefund(
        candidate({}, { activationDeadline }),
        customerId,
        new Date(activationDeadline.getTime() + 1),
      );

      expect(decision).toMatchObject({
        eligible: false,
        code: 'EXPIRED_TICKET',
      });
    });
  });
  it('사용 이력과 기한 초과가 함께 있으면 USED_TICKET이 먼저 판정된다', () => {
    const activationDeadline = new Date('2026-10-01T00:00:00Z');

    const decision = evaluateCustomerRefund(
      candidate(
        {},
        { activatedAt: new Date('2026-09-20T09:00:00Z'), activationDeadline },
      ),
      customerId,
      now,
    );

    expect(decision).toMatchObject({ eligible: false, code: 'USED_TICKET' });
  });
  it('가능 조건 거절 결과에 매장 문의 안내(CONTACT_SHOP)와 위반 사유 목록이 담긴다', () => {
    const decision = evaluateCustomerRefund(
      candidate(
        {},
        {
          activatedAt: new Date('2026-09-20T09:00:00Z'),
          activationDeadline: new Date('2026-10-01T00:00:00Z'),
        },
      ),
      customerId,
      now,
    );

    expect(decision).toEqual({
      eligible: false,
      code: 'USED_TICKET',
      action: 'CONTACT_SHOP',
      violations: ['USED_TICKET', 'EXPIRED_TICKET'],
    });
  });
  it('미사용·기한 안 이용권의 고객 환불 금액은 실결제액 전액으로 정해진다', () => {
    const decision = evaluateCustomerRefund(
      candidate({ paidAmount: 8700 }),
      customerId,
      now,
    );

    expect(decision).toEqual({ eligible: true, amount: 8700 });
  });
});

describe('evaluateStoreRefund', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const paidAmount = 10000;

  /**
   * 매장 환불 대상 기본 후보(결제 완료·사용 이력 있는 정기권)를 만든다
   * @param overrides 바꿀 필드
   * @param ticketOverrides 바꿀 이용권 필드
   * @returns 후보
   */
  function usedCandidate(
    overrides: Partial<CustomerRefundCandidate> = {},
    ticketOverrides: Partial<CustomerRefundCandidate['ticket']> = {},
  ): CustomerRefundCandidate {
    return {
      ownerId: 'customer-1',
      paymentStatus: PaymentStatus.SUCCESS,
      paidAmount,
      existingRefunds: [],
      ticket: {
        type: TicketType.PERIOD,
        inUse: false,
        activatedAt: new Date('2026-10-20T12:00:00Z'),
        activationDeadline: new Date('2026-11-27T12:00:00Z'),
        purchasedMinutes: null,
        remainingMinutes: null,
        minuteExpireDeadline: null,
        ...ticketOverrides,
      },
      ...overrides,
    };
  }

  it('사용 이력이 있는 이용권의 매장 환불 금액 0원은 사유와 함께 허용된다', () => {
    const decision = evaluateStoreRefund(
      usedCandidate(),
      { amount: 0, reason: '이용 불편 보상 없음 처리' },
      now,
    );

    expect(decision).toEqual({
      eligible: true,
      amount: 0,
      reason: '이용 불편 보상 없음 처리',
    });
  });
  it('매장 환불 금액이 실결제액보다 1원 많으면 REFUND_AMOUNT_EXCEEDED로 거절된다', () => {
    const decision = evaluateStoreRefund(
      usedCandidate(),
      { amount: paidAmount + 1, reason: '보상' },
      now,
    );

    expect(decision).toEqual({
      eligible: false,
      code: 'REFUND_AMOUNT_EXCEEDED',
    });
  });
  it('사용 이력이 있는 이용권의 매장 환불 금액이 실결제액과 같으면 허용된다', () => {
    const decision = evaluateStoreRefund(
      usedCandidate(),
      { amount: paidAmount, reason: '전액 보상' },
      now,
    );

    expect(decision).toEqual({
      eligible: true,
      amount: paidAmount,
      reason: '전액 보상',
    });
  });
  it('사용 이력이 있는 이용권에 사유가 없으면 REFUND_REASON_REQUIRED로 거절된다', () => {
    const decision = evaluateStoreRefund(
      usedCandidate(),
      { amount: paidAmount - 3000 },
      now,
    );

    expect(decision).toEqual({
      eligible: false,
      code: 'REFUND_REASON_REQUIRED',
    });
  });
  it('공백만 있는 사유는 사유 누락으로 처리된다', () => {
    const decision = evaluateStoreRefund(
      usedCandidate(),
      { amount: paidAmount - 3000, reason: '   ' },
      now,
    );

    expect(decision).toEqual({
      eligible: false,
      code: 'REFUND_REASON_REQUIRED',
    });
  });
  it('기한 안 미사용 이용권에 실결제액보다 1원 적은 금액이면 UNUSED_TICKET_FULL_REFUND_REQUIRED로 거절된다', () => {
    const decision = evaluateStoreRefund(
      usedCandidate({}, { activatedAt: null }),
      { amount: paidAmount - 1, reason: '부분 환불' },
      now,
    );

    expect(decision).toEqual({
      eligible: false,
      code: 'UNUSED_TICKET_FULL_REFUND_REQUIRED',
    });
  });
  it('기한 안 미사용 이용권은 전액이면 사유 없이 확정된다', () => {
    const decision = evaluateStoreRefund(
      usedCandidate({}, { activatedAt: null }),
      { amount: paidAmount },
      now,
    );

    expect(decision).toEqual({
      eligible: true,
      amount: paidAmount,
      reason: null,
    });
  });
  it('기한이 지난 미사용 이용권에 사유가 없으면', () => {
    const decision = evaluateStoreRefund(
      usedCandidate(
        {},
        {
          activatedAt: null,
          activationDeadline: new Date('2026-10-27T12:00:00Z'),
        },
      ),
      { amount: paidAmount - 3000 },
      now,
    );

    expect(decision).toEqual({
      eligible: false,
      code: 'REFUND_REASON_REQUIRED',
    });
  });
  it('기한이 지난 미사용 이용권은 실결제액보다 적은 입력 금액으로 확정된다', () => {
    const decision = evaluateStoreRefund(
      usedCandidate(
        {},
        {
          activatedAt: null,
          activationDeadline: new Date('2026-10-27T12:00:00Z'),
        },
      ),
      { amount: paidAmount - 3000, reason: '기한 경과 일부 환불' },
      now,
    );

    expect(decision).toEqual({
      eligible: true,
      amount: paidAmount - 3000,
      reason: '기한 경과 일부 환불',
    });
  });
  it('남은 시간이 0인 시간권도 금액과 사유로 매장 환불이 확정된다', () => {
    const decision = evaluateStoreRefund(
      usedCandidate(
        {},
        {
          type: TicketType.TIME,
          activatedAt: null,
          activationDeadline: null,
          purchasedMinutes: 600,
          remainingMinutes: 0,
          minuteExpireDeadline: new Date('2026-11-27T12:00:00Z'),
        },
      ),
      { amount: 2000, reason: '소진 후 불편 보상' },
      now,
    );

    expect(decision).toEqual({
      eligible: true,
      amount: 2000,
      reason: '소진 후 불편 보상',
    });
  });
  it('매장 범위에서 찾지 못한 이용권은 TICKET_NOT_FOUND로 판정된다', () => {
    const decision = evaluateStoreRefund(
      null,
      { amount: 1000, reason: '보상' },
      now,
    );

    expect(decision).toEqual({ eligible: false, code: 'TICKET_NOT_FOUND' });
  });
  it('지급 완료된 확정 환불이 있으면 매장 환불도 ALREADY_REFUNDED로 판정된다', () => {
    const decision = evaluateStoreRefund(
      usedCandidate({
        existingRefunds: [
          {
            decisionStatus: RefundDecisionStatus.ACCEPTED,
            payoutStatus: RefundPayoutStatus.PAID,
          },
        ],
      }),
      { amount: 1000, reason: '보상' },
      now,
    );

    expect(decision).toEqual({ eligible: false, code: 'ALREADY_REFUNDED' });
  });
  it('지급이 끝나지 않은 확정 환불이 있으면 매장 환불도 REFUND_IN_PROGRESS로 판정된다', () => {
    const decision = evaluateStoreRefund(
      usedCandidate({
        existingRefunds: [
          {
            decisionStatus: RefundDecisionStatus.ACCEPTED,
            payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
          },
        ],
      }),
      { amount: 1000, reason: '보상' },
      now,
    );

    expect(decision).toEqual({ eligible: false, code: 'REFUND_IN_PROGRESS' });
  });
  it('결제가 SUCCESS가 아니면 매장 환불도 PAYMENT_NOT_COMPLETED로 판정된다', () => {
    const decision = evaluateStoreRefund(
      usedCandidate({ paymentStatus: PaymentStatus.FAILED }),
      { amount: 1000, reason: '보상' },
      now,
    );

    expect(decision).toEqual({
      eligible: false,
      code: 'PAYMENT_NOT_COMPLETED',
    });
  });
});
