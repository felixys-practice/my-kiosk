import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ResumeTicketDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  // 고정석 이용권을 재개할 때 다시 배정할 좌석(FR-018)
  @IsOptional()
  @IsUUID('4', { message: '좌석 아이디는 유효한 UUID 형식이어야 합니다' })
  seatId?: string;
}
