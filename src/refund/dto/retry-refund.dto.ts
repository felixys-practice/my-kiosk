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
  reason!: string;
}
