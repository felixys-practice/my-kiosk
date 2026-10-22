import { SeatType, TicketType } from '@prisma/client';

export class GetProductOutDto {
  id!: string;
  name!: string;
  ticketType!: TicketType;
  amount!: number;
  purchasedMinutes?: number | null;
  purchasedDurationDays?: number | null;
  usableDays!: number;
  isActive!: boolean;
  seatType!: SeatType; // 좌석 타입(고정석·자유석)
}
