import { ApiProperty } from '@nestjs/swagger';
import { SeatType } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateSeatDto {
  @ApiProperty({ description: '좌석 이름', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '이름은 100자 이하여야 합니다' })
  name?: string;

  @ApiProperty({ description: '좌석 번호', required: false })
  @IsOptional()
  @IsNumber()
  number?: number;

  @ApiProperty({
    description: '좌석 타입 (FIXED: 고정석, FREE: 자유석)',
    enum: SeatType,
  })
  @IsEnum(SeatType, { message: '좌석 타입은 FIXED 또는 FREE여야 합니다' })
  type!: SeatType;
}
