import { ApiPropertyOptional } from '@nestjs/swagger';
import { RefundNotificationAudience } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class GetRefundNotificationQueryDto {
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
  @Min(1)
  @Max(100)
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
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  @ApiPropertyOptional({
    type: Boolean,
    description: '읽지 않은 알림만 조회',
    default: false,
    example: false,
  })
  unreadOnly = false;

  @IsOptional()
  @IsEnum(RefundNotificationAudience)
  @ApiPropertyOptional({
    enum: RefundNotificationAudience,
    enumName: 'RefundNotificationAudience',
    description: '알림 수신 대상 필터',
  })
  audience?: RefundNotificationAudience;
}
