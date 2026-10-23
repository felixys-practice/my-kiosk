import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ResumeTicketDto {
  @ApiProperty({ description: '재개 사유(선택, 500자 이하)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  // 고정석 이용권을 재개할 때 다시 배정할 좌석(FR-018)
  @ApiProperty({
    description: '다시 배정할 고정석 아이디(고정석 이용권이면 필수)',
    required: false,
  })
  @IsOptional()
  @IsUUID('4', { message: '좌석 아이디는 유효한 UUID 형식이어야 합니다' })
  seatId?: string;
}
