import { ApiProperty } from '@nestjs/swagger';
import { SeatType, TicketType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({
    enum: [TicketType.TIME, TicketType.PERIOD],
    description: 'TIME: 시간권, PERIOD: 정기권',
  })
  @IsIn([TicketType.TIME, TicketType.PERIOD])
  type!: TicketType;

  @ApiProperty({
    enum: SeatType,
    description: '좌석 타입 (FIXED: 고정석, FREE: 자유석)',
  })
  @IsEnum(SeatType, { message: '좌석 타입은 FIXED 또는 FREE여야 합니다' })
  seatType!: SeatType;

  @ApiProperty({ description: '상품 이름' })
  @IsNotEmpty({ message: '상품 이름은 필수 입니다' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: '상품 금액' })
  @IsNumber()
  @Min(0)
  @Max(10000000)
  amount!: number;

  @ApiProperty({ description: '유효기간' })
  @Min(1)
  @Max(365)
  usableDays!: number;

  @ApiProperty({ description: '판매 활성화 유무' })
  @IsBoolean()
  isActive: boolean = true;

  @ApiProperty({ description: '시간권-구매시간(분)', required: false })
  @ValidateIf((dto: CreateProductDto) => dto.type === TicketType.TIME)
  @IsNotEmpty({ message: '시간권은 purchasedMinutes가 필수입니다' })
  @IsNumber()
  @Min(10)
  @Max(60 * 24 * 365)
  purchasedMinutes?: number;

  @ApiProperty({ description: '기간권-구매기간(일)', required: false })
  @ValidateIf((dto: CreateProductDto) => dto.type === TicketType.PERIOD)
  @IsNotEmpty({ message: '기간권은 purchasedDurationDays가 필수입니다' })
  @IsNumber()
  @Min(1)
  @Max(365)
  purchasedDurationDays?: number;
}
