import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({
    type: Number,
    description:
      '예약할 금액(원 단위 양의 정수). 현재 미지급액과 같아야 합니다.',
    minimum: 1,
    example: 10000,
  })
  amount!: number;

  // 예약 사유(필수). 앞뒤 공백을 지운 뒤 1~500자
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
