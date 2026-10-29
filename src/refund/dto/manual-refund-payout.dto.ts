import {
  IsInt,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * 별도 환불금 지급 예약 본문 (API 계약 §5: POST /refund/:refundId/manual-payouts)
 */
export class ReserveManualPayoutDto {
  // 예약 금액(원 단위 양의 정수, 현재 미지급액과 같은지는 서비스에서 확인)
  @IsInt()
  @IsPositive()
  amount!: number;

  // 예약 사유(필수). 앞뒤 공백을 지운 뒤 1~500자
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
