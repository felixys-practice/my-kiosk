import { ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({
    type: Number,
    description: '페이지 번호',
    default: 1,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
    example: 1,
  })
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Max(100)
  @Min(1)
  @ApiPropertyOptional({
    type: Number,
    description: '페이지당 항목 수',
    default: 20,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  limit = 20;

  @IsOptional()
  @IsEnum(RefundPayoutStatus)
  @ApiPropertyOptional({
    enum: RefundPayoutStatus,
    enumName: 'RefundPayoutStatus',
    description: '환불금 지급 상태 필터',
  })
  payoutStatus?: RefundPayoutStatus;

  @IsOptional()
  @IsEnum(RefundDecisionStatus)
  @ApiPropertyOptional({
    enum: RefundDecisionStatus,
    enumName: 'RefundDecisionStatus',
    description: '환불 결정 상태 필터',
  })
  decisionStatus?: RefundDecisionStatus;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  @ApiPropertyOptional({
    type: Boolean,
    description: '조치가 필요한 환불만 조회',
    example: true,
  })
  actionRequiredOnly?: boolean;
}
