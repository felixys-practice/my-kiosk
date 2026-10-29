import { IsEnum, IsInt, IsOptional } from 'class-validator';
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
  limit = 20;

  @IsOptional()
  @IsEnum(PaymentCancelStatus)
  status?: PaymentCancelStatus;
}
