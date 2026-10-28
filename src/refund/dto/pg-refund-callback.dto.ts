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
  success!: boolean;

  @IsString()
  @IsNotEmpty()
  pgTransactionId!: string;

  @IsUUID()
  orderItemId!: string;

  @IsUUID()
  paymentCancelId!: string;

  // 성공이면 PG가 확인한 실제 취소액(원 단위 정수, API 계약 §7)
  @IsInt()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string | null;
}
