import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { RefundDecisionStatus, RefundPayoutStatus } from '@prisma/client';

export class GetRefundQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Max(100)
  @Min(1)
  limit = 20;

  @IsOptional()
  @IsEnum(RefundPayoutStatus)
  payoutStatus?: RefundPayoutStatus;

  @IsOptional()
  @IsEnum(RefundDecisionStatus)
  decisionStatus?: RefundDecisionStatus;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  actionRequiredOnly?: boolean;
}
