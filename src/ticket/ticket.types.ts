import { SeatType, TicketStatus, TicketType } from '@prisma/client';

/** 이용권에 지정된 고정석 */
export interface AssignedSeatOutData {
  id: string;
  number: number;
  name: string;
}

interface BaseTicketData {
  userId: string;
  status?: TicketStatus;
  orderItemId: string;
}
export interface TimeTicketData extends BaseTicketData {
  type: 'TIME';
  purchasedMinutes: number;
  minuteExpireDeadline: Date;
  remainingMinutes: number;
}
export interface PeriodTicketData extends BaseTicketData {
  type: 'PERIOD';
  purchasedDurationDays: number;
  activationDeadline: Date;
  activatedAt?: Date; // 첫 입장 시 셋팅
  expiresAt?: Date; // 정기권 실제 만료 시각(activatedAt + orderItem.purchasedDurationDays)
}

// 시간권 응답 데이터
export interface TimeTicketOutData {
  type: 'TIME';
  userId: string;
  status: TicketStatus; // 상태(미사용, 사용중, 만료, 소진, 관리자 소멸, 정지)
  minuteExpireDeadline: Date | null; // 유효일
  remainingMinutes: number; // 잔여시간
  seatNumber?: number | null; // 좌석 번호
  lastEnteredAt?: Date; // 입실 시작 시간
  lastExitedAt?: Date; // 마지막 퇴실 시간
  seatType: SeatType; // 좌석 타입(고정석·자유석)
  assignedSeat: AssignedSeatOutData | null; // 지정 좌석(자유석이거나 지정이 없으면 null)
}
// 정기권 응답 데이터
export interface PeriodTicketOutData {
  type: 'PERIOD';
  userId: string;
  status: TicketStatus;
  activationDeadline: Date; // 유효일
  activatedAt: Date; // 시작일
  expiresAt: Date; // 만료일
  pausedAt?: Date; // 정지 시작일
  remainingDays: number; // 남은 날짜
  seatNumber?: number; // 좌석 번호
  lastEnteredAt?: Date; // 입실 시작 시간
  lastExitedAt?: Date; // 마지막 퇴실 시간
  seatType: SeatType; // 좌석 타입(고정석·자유석)
  assignedSeat: AssignedSeatOutData | null; // 지정 좌석(자유석이거나 지정이 없으면 null)
}

// order 도메인 등 금액/만료 상세 정보가 필요 없는 소비처를 위한 최소 요약 데이터
export interface TicketSummaryOutData {
  id: string;
  type: TicketType;
  status: TicketStatus;
  isPaused: boolean; // 현재 일시정지 중인지 여부(활성 pause 존재 여부)
  usingSeatNumber?: number; // 현재 이용 중인 좌석 번호(ACTIVE 세션이 있을 때만)
}

export type CreateTicketData = TimeTicketData | PeriodTicketData;
export type UpdateTicketData =
  | (Partial<TimeTicketData> & Pick<TimeTicketData, 'type'>)
  | (Partial<PeriodTicketData> & Pick<PeriodTicketData, 'type'>);

export type TicketSortField =
  | 'purchasedAt' // 구매일
  | 'updatedAt' // 변경일
  | 'expiredAt' // 정기권 만료일
  | 'remainingTime'; // 시간권 만료일
export type TicketSortOption = { field: TicketSortField; dir: 'asc' | 'desc' };
