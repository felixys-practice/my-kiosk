import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * MANAGER의 PG 직접 재시도 요청 본문 (API 계약 §5: POST /refund/:refundId/payout-retries)
 */
export class RetryRefundDto {
  // 재시도 사유(필수). 앞뒤 공백을 지운 뒤 1~500자
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @ApiProperty({
    type: String,
    description: '처리 사유. 앞뒤 공백을 제거합니다.',
    minLength: 1,
    maxLength: 500,
    example: '고객 요청으로 환불 처리',
  })
  reason!: string;
}
