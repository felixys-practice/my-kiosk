import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
 * 별도 환불금 미지급 확인 본문 (API 계약 §5: POST /refund/:refundId/manual-payouts/:payoutId/not-paid)
 * - 근거 누락은 서비스에서 MANUAL_PAYOUT_EVIDENCE_REQUIRED로 거절한다
 */
export class CancelManualPayoutDto {
  // 미지급 확인 사유(필수). 앞뒤 공백을 지운 뒤 1~500자
  @Transform(trimmed)
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

  // 확실한 미지급 근거 1~1000자
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1000)
  @ApiPropertyOptional({
    type: String,
    description:
      '운영 증빙 참조. DTO에서는 생략할 수 있지만 서비스에서 증빙 누락을 거절합니다.',
    maxLength: 1000,
    example: 'evidence/refund/2026-11-12/001',
  })
  evidenceReference?: string;
}
