import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * 고객 환불 신청 본문 (API 계약 §4 고객: POST /refund)
 * - 실행자·매장·금액은 본문으로 받지 않는다(JWT와 정책이 정한다)
 */
export class RefundDto {
  @IsUUID('4', { message: '티켓 아이디는 유효한 UUID 형식이어야 합니다' })
  @ApiProperty({
    type: String,
    description: '환불할 이용권 ID',
    format: 'uuid',
    example: '123e4567-e89b-42d3-a456-426614174000',
  })
  ticketId!: string;

  /**
   * 이용 종료와 환불 금액에 대한 동의. 형식은 boolean만 허용하고,
   * false·누락의 거절(REFUND_TERMINATION_CONSENT_REQUIRED)은 대상 판정 뒤 서비스에서 한다
   */
  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    type: Boolean,
    description:
      '이용권 종료 및 환불 금액 동의. 누락하거나 false이면 서비스에서 거절합니다.',
    example: true,
  })
  consentToTerminateTicket?: boolean;
}
