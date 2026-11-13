import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class PgRefundCallbackDto {
  @IsBoolean()
  @ApiProperty({
    type: Boolean,
    description: 'PG 취소 성공 여부',
    example: true,
  })
  success!: boolean;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    type: String,
    description: 'PG 거래 식별자',
    minLength: 1,
    example: 'pg-transaction-001',
  })
  pgTransactionId!: string;

  // 상품 대상이면 그 주문 상품, 결제 전체(PAYMENT) 대상이면 null(API 계약 §7)
  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({
    type: String,
    description: '주문 상품 ID. 결제 전체 대상이면 null입니다.',
    format: 'uuid',
    nullable: true,
    example: '123e4567-e89b-42d3-a456-426614174000',
  })
  orderItemId!: string | null;

  @IsUUID()
  @ApiProperty({
    type: String,
    description: 'PG 취소 요청 ID',
    format: 'uuid',
    example: '123e4567-e89b-42d3-a456-426614174000',
  })
  paymentCancelId!: string;

  // 성공이면 PG가 확인한 실제 취소액(원 단위 정수, API 계약 §7)
  @IsInt()
  @IsPositive()
  @ApiProperty({
    type: Number,
    description:
      'PG가 보고한 취소 금액(원 단위 양의 정수). 성공 시 실제 취소액입니다.',
    minimum: 1,
    example: 10000,
  })
  amount!: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    type: String,
    description: 'PG 취소 결과 사유',
    nullable: true,
    example: '취소 완료',
  })
  reason?: string | null;
}
