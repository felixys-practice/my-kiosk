import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * 앞뒤 공백을 지운 문자열로 바꾼다(문자열이 아니면 그대로 두어 형식 검증이 거절하게 한다)
 * @param params 변환 대상 값
 * @returns 공백을 지운 값
 */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * PG 초과 취소 검토 결과 등록 본문 (API 계약 §5: POST /refund/:refundId/amount-review)
 * - 근거 누락은 서비스에서 MANUAL_PAYOUT_EVIDENCE_REQUIRED로 거절한다
 */
export class ReviewRefundAmountDto {
  // 검토 결과 사유(필수). 앞뒤 공백을 지운 뒤 1~500자
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  // 확인 근거 1~1000자
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1000)
  evidenceReference?: string;
}
