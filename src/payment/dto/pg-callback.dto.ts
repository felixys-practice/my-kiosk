import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class PgCallbackDto {
  @IsBoolean()
  success!: boolean;

  @IsString()
  @IsNotEmpty()
  pgTransactionId!: string;

  // PG가 승인했다고 알린 금액(원 단위 정수, approvedAmount·환불 금액으로 저장된다)
  @IsInt()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string | null;
}
