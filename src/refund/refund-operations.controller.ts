import {
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtValidationResult } from 'src/auth/interfaces/jwt-payload.interface';
import { RetryRefundDto } from './dto';
import { RefundOperatorGuard } from './guards/refund-operator.guard';
import { RefundRetryService } from './refund-retry.service';

/**
 * 미지급 환불금 재처리 운영 API (API 계약 §5, MANAGER 전용)
 */
@Controller('refund')
export class RefundOperationsController {
  constructor(private readonly retryService: RefundRetryService) {}

  /**
   * MANAGER가 확정 실패의 원인을 조치한 뒤 PG 취소를 직접 다시 요청한다
   * @param user 요청한 운영자(JWT)
   * @param refundId 재시도할 환불
   * @param dto 재시도 사유
   * @param res 응답 상태 지정용(202 접수)
   * @param idempotencyKey 필수 멱등 키
   * @returns 접수 응답 본문(환불 ID·새 PG 취소 요청 ID·PENDING)
   */
  @Post(':refundId/payout-retries')
  @UseGuards(RefundOperatorGuard)
  async payoutRetry(
    @CurrentUser() user: JwtValidationResult,
    @Param('refundId', ParseUUIDPipe) refundId: string,
    @Body() dto: RetryRefundDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.retryService.retryByManager(
      { userId: user.userId, role: user.role },
      refundId,
      { reason: dto.reason, idempotencyKey },
    );
    res.status(result.status);
    return result.body;
  }
}
