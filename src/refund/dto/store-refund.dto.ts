import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * 매장 환불 요청 본문 (API 계약 §4 매장: POST /refund/shop/:shopId)
 * - 금액 상한·사유 필수 여부·전액 원칙은 대상 판정 뒤 서비스에서 확인한다
 */
export class StoreRefundDto {
  @IsUUID('4', { message: '티켓 아이디는 유효한 UUID 형식이어야 합니다' })
  @ApiProperty({
    type: String,
    description: '환불할 이용권 ID',
    format: 'uuid',
    example: '123e4567-e89b-42d3-a456-426614174000',
  })
  ticketId!: string;

  // 확정할 환불 금액(원 단위 정수). 0 이상(상한은 실결제액으로 서비스에서 확인)
  @IsInt()
  @Min(0)
  @ApiProperty({
    type: Number,
    description:
      '확정할 환불 금액(원 단위 정수). 실결제액 이하인지 서비스에서 확인합니다.',
    minimum: 0,
    example: 10000,
  })
  amount!: number;

  // 점주 사유(선택). 보낸 경우 앞뒤 공백을 지운 뒤 1~500자(API 계약 §4). 공백만 보내면 형식 오류다
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @ApiPropertyOptional({
    type: String,
    description: '처리 사유. 앞뒤 공백을 제거합니다.',
    minLength: 1,
    maxLength: 500,
    example: '고객 요청으로 환불 처리',
  })
  reason?: string;

  // 이용 종료와 환불 금액에 대한 동의(누락·false 거절은 서비스에서)
  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    type: Boolean,
    description:
      '이용권 종료 및 환불 금액 동의. 누락하거나 false이면 서비스에서 거절합니다.',
    example: true,
  })
  consentToTerminateTicket?: boolean;

  // 이용 중일 때 퇴실 동의(누락·false 거절은 서비스에서 TICKET_IN_USE)
  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    type: Boolean,
    description: '이용 중인 세션의 퇴실 동의. 이용 중이면 true가 필요합니다.',
    example: true,
  })
  consentToEndSession?: boolean;
}
