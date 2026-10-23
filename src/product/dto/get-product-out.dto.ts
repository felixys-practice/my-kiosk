import { ApiProperty } from '@nestjs/swagger';
import { SeatType, TicketType } from '@prisma/client';

export class GetProductOutDto {
  @ApiProperty({ description: '상품 아이디' })
  id!: string;

  @ApiProperty({ description: '상품 이름' })
  name!: string;

  @ApiProperty({
    description: '이용권 종류 (TIME: 시간권, PERIOD: 기간권)',
    enum: TicketType,
  })
  ticketType!: TicketType;

  @ApiProperty({ description: '상품 금액' })
  amount!: number;

  @ApiProperty({
    description: '시간권 구매 시간(분), 기간권은 null',
    required: false,
    nullable: true,
  })
  purchasedMinutes?: number | null;

  @ApiProperty({
    description: '기간권 구매 기간(일), 시간권은 null',
    required: false,
    nullable: true,
  })
  purchasedDurationDays?: number | null;

  @ApiProperty({ description: '구매 후 사용·활성화해야 하는 기한(일)' })
  usableDays!: number;

  @ApiProperty({ description: '판매 활성화 여부' })
  isActive!: boolean;

  @ApiProperty({
    description: '좌석 타입 (FIXED: 고정석, FREE: 자유석)',
    enum: SeatType,
  })
  seatType!: SeatType; // 좌석 타입(고정석·자유석)
}
