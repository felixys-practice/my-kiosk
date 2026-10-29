import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentCancelStatus } from '../refund.types';

export class GetRefundQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Max(100)
  @Min(1)
  limit = 20;

  @IsOptional()
  @IsEnum(PaymentCancelStatus)
  status?: PaymentCancelStatus;
}
