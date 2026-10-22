import { ApiProperty } from '@nestjs/swagger';
import { SeatType } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** 점주의 이용권 좌석 변경 요청(타입 변경·고정석 이동) */
export class ChangeTicketSeatDto {
  @ApiProperty({
    description: '바꿀 좌석 타입 (FIXED: 고정석, FREE: 자유석)',
    enum: SeatType,
  })
  @IsEnum(SeatType, { message: '좌석 타입은 FIXED 또는 FREE여야 합니다' })
  seatType!: SeatType;

  @ApiProperty({
    description: '배정할 고정석 아이디(고정석으로 바꾸거나 옮길 때 필수)',
    required: false,
  })
  @ValidateIf((dto: ChangeTicketSeatDto) => dto.seatType === SeatType.FIXED)
  @IsUUID('4', { message: '좌석 아이디는 유효한 UUID 형식이어야 합니다' })
  seatId?: string;

  @ApiProperty({ description: '변경 사유(필수, 500자 이하, FR-020)' })
  @IsNotEmpty({ message: '변경 사유는 필수입니다' })
  @IsString()
  @MaxLength(500, { message: '변경 사유는 500자 이하여야 합니다' })
  reason!: string;
}
