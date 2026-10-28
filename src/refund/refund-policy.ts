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
  // 4. 확정됐지만 지급이 끝나지 않은 환불이 있으면 진행 중
  if (accepted.length > 0) {
    return { eligible: false, code: 'REFUND_IN_PROGRESS' };
  }

  // 5·6. 가능 조건(사용 여부 → 미사용 기한): 위반을 모두 모으고 대표 사유는 USED_TICKET을 우선한다
  const violations = unusedRuleViolations(candidate.ticket, now);
  if (violations.length > 0) {
    return {
      eligible: false,
      code: violations[0],
      violations,
      action: 'CONTACT_SHOP',
    };
  }
  // 고객 환불 금액은 실결제액 전액이다
  return { eligible: true, amount: candidate.paidAmount };
}

/**
 * 고객 환불 가능 조건(미사용·기한 안) 위반을 모두 모은다
 * @param ticket 이용권
 * @param now 신청 시각
 * @returns 위반 사유 목록(USED_TICKET → EXPIRED_TICKET 순), 위반이 없으면 빈 배열
 */
function unusedRuleViolations(
  ticket: CustomerRefundCandidate['ticket'],
  now: Date,
): string[] {
  const violations: string[] = [];
  if (ticket.inUse || !isUnused(ticket)) {
    violations.push('USED_TICKET');
  }
  // 신청 시각이 기한보다 늦어야 초과(기한과 같은 시각은 허용)
  const deadline = unusedDeadlineOf(ticket);
  if (deadline !== null && now.getTime() > deadline.getTime()) {
    violations.push('EXPIRED_TICKET');
  }
  return violations;
}

/**
 * 이용권이 미사용인지 판정한다(이용 중 여부는 호출하는 쪽에서 먼저 본다)
 * - 정기권: 활성화 전이면 미사용
 * - 시간권: 남은 시간이 구매 시간과 같으면 미사용
 * @param ticket 이용권
 * @returns 미사용이면 true
 */
function isUnused(ticket: CustomerRefundCandidate['ticket']): boolean {
  switch (ticket.type) {
    case TicketType.PERIOD:
      return ticket.activatedAt === null;
    case TicketType.TIME:
      // 남은 시간이 구매 시간과 같아야 미사용. 값이 비어 있으면 보수적으로 사용 이력 있음
      return (
        ticket.remainingMinutes !== null &&
        ticket.purchasedMinutes !== null &&
        ticket.remainingMinutes === ticket.purchasedMinutes
      );
  }
}

/**
 * 미사용 환불 기한을 고른다
 * - 정기권: 활성화 기한(activationDeadline)
 * - 시간권: 소진 기한(minuteExpireDeadline)
 * @param ticket 이용권
 * @returns 기한, 없으면 null
 */
function unusedDeadlineOf(
  ticket: CustomerRefundCandidate['ticket'],
): Date | null {
  switch (ticket.type) {
    case TicketType.PERIOD:
      return ticket.activationDeadline;
    case TicketType.TIME:
      return ticket.minuteExpireDeadline;
  }
}

/** 점주가 입력한 매장 환불 금액·사유 */
export type StoreRefundInput = {
  amount: number; // 원 단위 정수
  reason?: string; // 점주 사유(선택)
};

/** 매장 환불 판정 결과 */
export type StoreRefundDecision =
  | { eligible: true; amount: number; reason: string | null }
  | { eligible: false; code: string };

/**
 * 매장 환불 가능 여부와 확정 금액·사유를 판정한다 (API 계약 §4 매장 환불)
 * @param candidate 매장 범위에서 찾은 이용권·결제·기존 환불 정보, 없으면 null
 * @param input 점주 입력 금액·사유
 * @param now 요청 시각
 * @returns 판정 결과
 */
export function evaluateStoreRefund(
  candidate: CustomerRefundCandidate | null,
  input: StoreRefundInput,
  now: Date,
): StoreRefundDecision {
  // 금액 상한: 실결제액을 넘을 수 없다
  if (candidate && input.amount > candidate.paidAmount) {
    return { eligible: false, code: 'REFUND_AMOUNT_EXCEEDED' };
  }
  // 사유는 앞뒤 공백을 지운 값으로 본다. 공백만 있으면 사유가 없는 것이다
  const reason = input.reason?.trim() || null;
  // 어긴 규칙이 없는(기한 안 미사용) 이용권은 실결제액 전액만 환불할 수 있고 사유는 선택이다
  const unusedInDeadline =
    candidate !== null &&
    unusedRuleViolations(candidate.ticket, now).length === 0;
  if (unusedInDeadline) {
    if (input.amount !== candidate.paidAmount) {
      return { eligible: false, code: 'UNUSED_TICKET_FULL_REFUND_REQUIRED' };
    }
    return { eligible: true, amount: input.amount, reason };
  }
  // 사용 이력이 있거나 기한이 지났으면 사유가 필수다
  if (reason === null) {
    return { eligible: false, code: 'REFUND_REASON_REQUIRED' };
  }
  return { eligible: true, amount: input.amount, reason };
}
