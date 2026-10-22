import { ApiProperty } from '@nestjs/swagger';
import { SeatStatus, SeatType } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateSeatDto {
  @ApiProperty({ description: '좌석 번호', required: false })
  @IsOptional()
  @IsNumber()
  number?: number;

  @ApiProperty({ description: '좌석 이름', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '좌석 이름은 100자 이하 여야 합니다' })
  name?: string;

  @ApiProperty({
    description:
      '좌석 타입 (FIXED: 고정석, FREE: 자유석). 이용 중인 좌석은 바꿀 수 없다',
    enum: SeatType,
    required: false,
  })
  @IsOptional()
  @IsEnum(SeatType, { message: '좌석 타입은 FIXED 또는 FREE여야 합니다' })
  type?: SeatType;

  @ApiProperty({
    description:
      '좌석 상태 (AVAILABLE: 사용 가능, UNAVAILABLE: 이용 불가). 이용 중인 좌석은 바꿀 수 없다',
    enum: SeatStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(SeatStatus, {
    message: '좌석 상태는 AVAILABLE 또는 UNAVAILABLE이어야 합니다',
  })
  status?: SeatStatus;
}
