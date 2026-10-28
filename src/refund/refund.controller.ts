import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtValidationResult } from 'src/auth/interfaces/jwt-payload.interface';
import { RefundService } from './refund.service';
import { GetRefundQueryDto, RefundDto, PgRefundCallbackDto } from './dto';
import { RefundAcceptanceService } from './refund-acceptance.service';
import { RefundResultService } from './refund-result.service';
import { RefundRepository } from './refund.repository';
import { PgCallbackTargetMismatchError } from './errors';

@Controller('refund')
export class RefundController {
  constructor(
    private readonly refundService: RefundService,
    private readonly refundAcceptanceService: RefundAcceptanceService,
    private readonly refundResultService: RefundResultService,
    private readonly refundRepository: RefundRepository,
  ) {}

  /**
   * 고객 본인 이용권의 환불을 확정한다 (API 계약 §4 고객: POST /refund)
   * - 같은 Idempotency-Key 재요청은 DB 멱등 기록의 최초 응답을 돌려준다
   * @param user 신청한 고객(JWT)
   * @param dto 이용권·종료 동의
   * @param res 응답 상태 지정용(양수 접수 202)
   * @param idempotencyKey 선택 멱등 키
   * @returns 접수 응답 본문
   */
  @Post()
  async refund(
    @CurrentUser() user: JwtValidationResult,
    @Body() dto: RefundDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.refundAcceptanceService.acceptCustomerRefund(
      { userId: user.userId, role: user.role },
      {
        ticketId: dto.ticketId,
        consentToTerminateTicket: dto.consentToTerminateTicket,
        idempotencyKey,
      },
    );
    res.status(result.status);
    return result.body;
  }

  /**
   * PG 취소 결과 콜백을 받는다 (API 계약 §7 POST /refund/callback, 200 수신 확인)
   * - 환불 기록에 연결된 PG 취소 요청은 환불금 지급 결과 공통 처리로 반영한다
   * - 기존 경로가 만든 PG 취소 요청(refundId 없음)은 US6·Phase 13 전환 전까지 기존 처리를 유지한다
   * @param dto 콜백 본문
   */
  @Post('callback')
  @HttpCode(HttpStatus.OK)
  async callbackRefund(@Body() dto: PgRefundCallbackDto) {
    if (await this.refundRepository.isLegacyAttempt(dto.paymentCancelId)) {
      // 기존 경로의 PG 취소 요청은 항상 주문 상품 대상이다. 결제 전체(null) 콜백은 연결 불일치다
      if (dto.orderItemId === null || dto.orderItemId === undefined) {
        throw new PgCallbackTargetMismatchError();
      }
      await this.refundService.callback(
        dto.success,
        dto.paymentCancelId,
        dto.orderItemId,
        dto.amount,
        dto.reason,
      );
      return;
    }
    await this.refundResultService.applyCallback({
      success: dto.success,
      paymentCancelId: dto.paymentCancelId,
      pgTransactionId: dto.pgTransactionId,
      orderItemId: dto.orderItemId,
      amount: dto.amount,
      reason: dto.reason,
    });
  }

  // 매장의 환불 내역 (status 미지정 시 전체 상태 조회)
  @Get('/shop/:shopId')
  async getRefundHistoryByShop(
    @Param('shopId') shopId: string,
    @Query() query?: GetRefundQueryDto,
  ) {
    return this.refundService.getRefundHistoryByShop(shopId, query?.status);
  }

  // 사용자의 환불 내역
  @Get('/user/:userId')
  async getRefundHistoryByUser(
    @Param('userId') userId: string,
    @Query() query?: GetRefundQueryDto,
  ) {
    return this.refundService.getRefundHistoryByUser(userId, query?.status);
  }
}
