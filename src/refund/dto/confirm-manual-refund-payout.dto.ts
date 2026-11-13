import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

/** 날짜·시각과 명시적 시간대(Z 또는 ±hh:mm)가 모두 있는 ISO 시각 */
const isoInstantWithZone =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * 별도 환불금 지급 결과 등록 본문 (API 계약 §5: POST /refund/:refundId/manual-payouts/:payoutId/confirm)
 * - 증빙 누락은 서비스에서 MANUAL_PAYOUT_EVIDENCE_REQUIRED로 거절한다
 */
export class ConfirmManualPayoutDto {
  // 실제 지급액(원 단위 양의 정수, 예약 금액과 같은지는 서비스에서 확인)
  @IsInt()
  @IsPositive()
  @ApiProperty({
    type: Number,
    description: '실제 지급액(원 단위 양의 정수). 예약 금액과 같아야 합니다.',
    minimum: 1,
    example: 10000,
  })
  amount!: number;

  // 실제 지급 시각(날짜·시각·시간대가 모두 있는 ISO 문자열, 저장은 UTC), 미래 불가.
  // 형식이 맞지 않으면 날짜로 바꾸지 않아 형식 검증이 거절한다
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' &&
    isoInstantWithZone.test(value) &&
    isISO8601(value, { strict: true })
      ? new Date(value)
      : value,
  )
  @IsDate()
  @MaxDate(() => new Date())
  @ApiProperty({
    type: String,
    description:
      '실제 지급 시각. 시간대가 포함된 ISO 8601 문자열이며 미래 시각은 허용하지 않습니다.',
    format: 'date-time',
    example: '2026-11-11T10:00:00+09:00',
  })
  paidAt!: Date;

  // 실제 지급 거래 식별자 1~200자(지급 기관 범위를 포함해 전역으로 구별되는 값)
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @ApiProperty({
    type: String,
    description: '지급 기관 범위를 포함하는 전역 고유 거래 식별자',
    minLength: 1,
    maxLength: 200,
    example: 'bank:transfer:20261111:001',
  })
  externalTransactionId!: string;

  // 운영 증빙 참조 1~1000자
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
