import {
  PaymentStatus,
  RefundDecisionStatus,
  RefundPayoutStatus,
  TicketType,
} from '@prisma/client';

/** 고객 환불 판정에 필요한 이용권·결제·기존 환불 정보 */
export type CustomerRefundCandidate = {
  ownerId: string; // 이용권 소유 고객
  paymentStatus: PaymentStatus; // 원래 결제 상태
  paidAmount: number; // 상품 실결제액
  existingRefunds: {
    decisionStatus: RefundDecisionStatus;
    payoutStatus: RefundPayoutStatus;
  }[]; // 같은 상품의 기존 환불 기록
  ticket: {
    type: TicketType;
    inUse: boolean; // 지금 좌석을 이용 중인지(진행 중 이용 세션 있음)
    activatedAt: Date | null; // 정기권 활성화 시각
    activationDeadline: Date | null; // 정기권 활성화 기한
    purchasedMinutes: number | null; // 시간권 구매 시간
    remainingMinutes: number | null; // 시간권 남은 시간
    minuteExpireDeadline: Date | null; // 시간권 소진 기한
  };
};

/** 고객 환불 판정 결과 */
export type CustomerRefundDecision =
  | { eligible: true; amount: number }
  | {
      eligible: false;
      code: string; // 대표 거절 코드(API 계약 §10)
      violations?: string[]; // 가능 조건 위반 사유 전체
      action?: 'CONTACT_SHOP'; // 매장 문의 안내
    };

/**
 * 고객 환불 가능 여부를 판정한다 (API 계약 §4 고객 환불의 확인 순서)
 * @param candidate 이용권·결제·기존 환불 정보, 이용권이 없으면 null
 * @param requesterId 신청한 고객
 * @param now 신청 시각
 * @returns 판정 결과
 */
export function evaluateCustomerRefund(
  candidate: CustomerRefundCandidate | null,
  requesterId: string,
  now: Date,
): CustomerRefundDecision {
  // 1. 본인 이용권 범위: 없거나 다른 고객의 이용권은 존재를 드러내지 않고 찾을 수 없음으로 판정한다
  if (!candidate || candidate.ownerId !== requesterId) {
    return { eligible: false, code: 'TICKET_NOT_FOUND' };
  }

  // 2. 결제가 성공 상태여야 한다
  if (candidate.paymentStatus !== PaymentStatus.SUCCESS) {
    return { eligible: false, code: 'PAYMENT_NOT_COMPLETED' };
  }

  // 3. 같은 상품의 확정 환불: 지급까지 끝났으면 이미 환불됨
  const accepted = candidate.existingRefunds.filter(
    (refund) => refund.decisionStatus === RefundDecisionStatus.ACCEPTED,
  );
  if (
    accepted.some((refund) => refund.payoutStatus === RefundPayoutStatus.PAID)
  ) {
    return { eligible: false, code: 'ALREADY_REFUNDED' };
  }
  void now;
  return { eligible: true, amount: 0 };
}
