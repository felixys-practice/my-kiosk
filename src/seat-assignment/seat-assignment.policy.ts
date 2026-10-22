import {
  SeatAssignmentStatus,
  SeatReleaseReason,
  TicketStatus,
  TicketType,
} from '@prisma/client';

/**
 * 좌석 배정 유효 판정 규칙(업무 규칙)
 * - DB 상태값(HELD·ACTIVE)이 남아 있어도, 기한이 지났으면 조회 시점에 "무효"로 본다(지연 해제, research R3)
 * - 판정이 필요한 모든 곳은 이 함수 하나를 쓴다
 */

/** 판정에 필요한 배정 필드 */
export type AssignmentForJudge = {
  status: SeatAssignmentStatus;
  heldUntil: Date | null;
};

/** 판정에 필요한 연결 이용권 필드 */
export type AssignmentTicketSnapshot = {
  type: TicketType;
  status: TicketStatus;
  expiresAt: Date | null;
  activationDeadline: Date | null;
  minuteExpireDeadline: Date | null;
};

// 배정이 살아 있을 수 있는 이용권 상태
const liveTicketStatuses: TicketStatus[] = [
  TicketStatus.UNUSED,
  TicketStatus.ACTIVE,
];

/**
 * 좌석 배정이 지금 시점에 유효한지 판정한다
 * @param assignment 판정할 배정
 * @param ticket 배정에 연결된 이용권(HELD이면 null)
 * @param now 판정 기준 시각
 * @returns 유효하면 true
 */
export function isValidAssignment(
  assignment: AssignmentForJudge,
  ticket: AssignmentTicketSnapshot | null,
  now: Date,
): boolean {
  // 선점: 유효시간이 남아 있어야 유효
  if (assignment.status === SeatAssignmentStatus.HELD) {
    return assignment.heldUntil !== null && assignment.heldUntil > now;
  }

  // 해제: 항상 무효
  if (assignment.status !== SeatAssignmentStatus.ACTIVE) return false;

  // 확정: 연결 이용권이 살아 있고 기한이 남아 있어야 유효
  if (!ticket || !liveTicketStatuses.includes(ticket.status)) return false;
  const deadline = getTicketDeadline(ticket);
  return deadline !== null && deadline > now;
}

/**
 * 무효로 판정된 배정을 해제할 때 기록할 사유를 고른다
 * @param assignment 무효로 판정된 배정
 * @returns 선점이면 HOLD_EXPIRED, 확정이면 TICKET_EXPIRED
 */
export function getInvalidReleaseReason(
  assignment: AssignmentForJudge,
): SeatReleaseReason {
  return assignment.status === SeatAssignmentStatus.HELD
    ? SeatReleaseReason.HOLD_EXPIRED
    : SeatReleaseReason.TICKET_EXPIRED;
}

/**
 * 이용권 종류별로 배정이 유지되는 마지막 시각을 구한다
 * @param ticket 이용권
 * @returns 기간권은 만료일(활성화 전이면 활성화 기한), 시간권은 소진 기한
 */
function getTicketDeadline(ticket: AssignmentTicketSnapshot): Date | null {
  if (ticket.type === TicketType.PERIOD) {
    return ticket.expiresAt ?? ticket.activationDeadline;
  }
  return ticket.minuteExpireDeadline;
}
