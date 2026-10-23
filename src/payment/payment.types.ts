import {
  PaymentStatus,
  SeatType,
  PaymentType,
  TicketStatus,
  TicketType,
} from '@prisma/client';

export interface PgPayload {
  success: boolean;
  pgTransactionId: string;
  amount: number;
  reason: string | null;
}

export interface PaymentOutData {
  type: PaymentType;
  status: PaymentStatus;
  amount: number;
}

export interface BasePaymentData {
  id: string; // 선점 확정과 연결하려고 서비스에서 미리 만든 이용권 ID
  userId: string;
  type: TicketType;
  status: TicketStatus;
  orderItemId: string;
  seatType: SeatType; // 주문 항목의 좌석 타입 스냅샷을 따른다
}

export interface TimePaymentData extends BasePaymentData {
  purchasedMinutes: number;
  remainingMinutes: number;
  minuteExpireDeadline: Date;
}

export interface PeriodPaymentData extends BasePaymentData {
  purchasedDurationDays: number;
  activationDeadline: Date;
}
