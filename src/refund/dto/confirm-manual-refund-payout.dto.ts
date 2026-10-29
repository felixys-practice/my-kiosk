import {
  isISO8601,
  IsDate,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxDate,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * 앞뒤 공백을 지운 문자열로 바꾼다(문자열이 아니면 그대로 두어 형식 검증이 거절하게 한다)
 * @param params 변환 대상 값
 * @returns 공백을 지운 값
 */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * 별도 환불금 지급 결과 등록 본문 (API 계약 §5: POST /refund/:refundId/manual-payouts/:payoutId/confirm)
 * - 증빙 누락은 서비스에서 MANUAL_PAYOUT_EVIDENCE_REQUIRED로 거절한다
 */
export class ConfirmManualPayoutDto {
  // 실제 지급액(원 단위 양의 정수, 예약 금액과 같은지는 서비스에서 확인)
  @IsInt()
  @IsPositive()
  amount!: number;

  // 실제 지급 시각(UTC ISO 문자열), 미래 불가. ISO 문자열이 아니면 날짜로 바꾸지 않아 형식 검증이 거절한다
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && isISO8601(value, { strict: true })
      ? new Date(value)
      : value,
  )
  @IsDate()
  @MaxDate(() => new Date())
  paidAt!: Date;

  // 실제 지급 거래 식별자 1~200자(지급 기관 범위를 포함해 전역으로 구별되는 값)
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalTransactionId!: string;

  // 운영 증빙 참조 1~1000자
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1000)
  evidenceReference?: string;
}
