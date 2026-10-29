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
import {
  CancelManualPayoutDto,
  ConfirmManualPayoutDto,
  RetryRefundDto,
  ReserveManualPayoutDto,
  ReviewRefundAmountDto,
} from './dto';
import { RefundOperatorGuard } from './guards/refund-operator.guard';
import { RefundRetryService } from './refund-retry.service';
import { RefundOperationsService } from './refund-operations.service';

/**
 * 미지급 환불금 재처리 운영 API (API 계약 §5, MANAGER 전용)
 */
@Controller('refund')
export class RefundOperationsController {
  constructor(
    private readonly retryService: RefundRetryService,
    private readonly operationsService: RefundOperationsService,
  ) {}

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

  /**
   * MANAGER가 PG 외 수단으로 지급할 미지급 환불금을 예약한다(실제 송금은 하지 않는다)
   * @param user 요청한 운영자(JWT)
   * @param refundId 환불
   * @param dto 예약 금액·사유
   * @param res 응답 상태 지정용(201 예약)
   * @param idempotencyKey 필수 멱등 키
   * @returns 예약 응답 본문
   */
  @Post(':refundId/manual-payouts')
  @UseGuards(RefundOperatorGuard)
  async reserveManualPayout(
    @CurrentUser() user: JwtValidationResult,
    @Param('refundId', ParseUUIDPipe) refundId: string,
    @Body() dto: ReserveManualPayoutDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.operationsService.reserveManualPayout(
      { userId: user.userId, role: user.role },
      refundId,
      { amount: dto.amount, reason: dto.reason, idempotencyKey },
    );
    res.status(result.status);
    return result.body;
  }

  /**
   * MANAGER가 별도 환불금 지급의 실제 지급 결과를 등록한다
   * @param user 요청한 운영자(JWT)
   * @param refundId 환불
   * @param payoutId 예약
   * @param dto 금액·지급 시각·거래 식별자·증빙
   * @param res 응답 상태 지정용
   * @param idempotencyKey 필수 멱등 키
   * @returns 등록 응답 본문
   */
  @Post(':refundId/manual-payouts/:payoutId/confirm')
  @UseGuards(RefundOperatorGuard)
  async confirmManualPayout(
    @CurrentUser() user: JwtValidationResult,
    @Param('refundId', ParseUUIDPipe) refundId: string,
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
    @Body() dto: ConfirmManualPayoutDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.operationsService.confirmManualPayout(
      { userId: user.userId, role: user.role },
      refundId,
      payoutId,
      {
        amount: dto.amount,
        paidAt: dto.paidAt,
        externalTransactionId: dto.externalTransactionId,
        evidenceReference: dto.evidenceReference,
        idempotencyKey,
      },
    );
    res.status(result.status);
    return result.body;
  }

  /**
   * MANAGER가 별도 환불금 지급을 실제로 하지 않았음을 확인해 예약을 종료한다
   * @param user 요청한 운영자(JWT)
   * @param refundId 환불
   * @param payoutId 예약
   * @param dto 사유·근거
   * @param res 응답 상태 지정용
   * @param idempotencyKey 필수 멱등 키
   * @returns 종료 응답 본문
   */
  @Post(':refundId/manual-payouts/:payoutId/not-paid')
  @UseGuards(RefundOperatorGuard)
  async markManualPayoutNotPaid(
    @CurrentUser() user: JwtValidationResult,
    @Param('refundId', ParseUUIDPipe) refundId: string,
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
    @Body() dto: CancelManualPayoutDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.operationsService.markManualPayoutNotPaid(
      { userId: user.userId, role: user.role },
      refundId,
      payoutId,
      {
        reason: dto.reason,
        evidenceReference: dto.evidenceReference,
        idempotencyKey,
      },
    );
    res.status(result.status);
    return result.body;
  }

  /**
   * MANAGER가 PG 초과 취소의 검토 결과를 등록한다
   * @param user 요청한 운영자(JWT)
   * @param refundId 환불
   * @param dto 사유·근거
   * @param res 응답 상태 지정용
   * @param idempotencyKey 필수 멱등 키
   * @returns 등록 응답 본문
   */
  @Post(':refundId/amount-review')
  @UseGuards(RefundOperatorGuard)
  async reviewRefundAmount(
    @CurrentUser() user: JwtValidationResult,
    @Param('refundId', ParseUUIDPipe) refundId: string,
    @Body() dto: ReviewRefundAmountDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.operationsService.reviewRefundAmount(
      { userId: user.userId, role: user.role },
      refundId,
      {
        reason: dto.reason,
        evidenceReference: dto.evidenceReference,
        idempotencyKey,
      },
    );
    res.status(result.status);
    return result.body;
  }
}
