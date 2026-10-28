import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtValidationResult } from 'src/auth/interfaces/jwt-payload.interface';
import { RefundService } from './refund.service';
import {
  GetRefundQueryDto,
  RefundDto,
  PgRefundCallbackDto,
  StoreRefundDto,
} from './dto';
import { RefundStoreService } from './refund-store.service';
import { RefundAcceptanceService } from './refund-acceptance.service';
import { RefundResultService } from './refund-result.service';

@Controller('refund')
export class RefundController {
  constructor(
    private readonly refundService: RefundService,
    private readonly refundAcceptanceService: RefundAcceptanceService,
    private readonly refundResultService: RefundResultService,
    private readonly refundStoreService: RefundStoreService,
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
   * 점주가 자기 매장 이용권의 환불을 확정한다 (API 계약 §4 매장: POST /refund/shop/:shopId)
   * - 같은 Idempotency-Key 재요청은 DB 멱등 기록의 최초 응답을 돌려준다
   * @param user 요청한 점주(JWT)
   * @param shopId 요청 매장
   * @param dto 이용권·금액·사유·종료/퇴실 동의
   * @param res 응답 상태 지정용(양수 접수 202, 0원 200)
   * @param idempotencyKey 선택 멱등 키
   * @returns 접수 응답 본문
   */
  @Post('shop/:shopId')
  async storeRefund(
    @CurrentUser() user: JwtValidationResult,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: StoreRefundDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.refundStoreService.acceptStoreRefund(
      { userId: user.userId, role: user.role },
      shopId,
      {
        ticketId: dto.ticketId,
        amount: dto.amount,
        reason: dto.reason,
        consentToTerminateTicket: dto.consentToTerminateTicket,
        consentToEndSession: dto.consentToEndSession,
        idempotencyKey,
      },
    );
    res.status(result.status);
    return result.body;
  }

  /**
   * PG 취소 결과 콜백을 받는다 (API 계약 §7 POST /refund/callback, 200 수신 확인)
   * @param dto 콜백 본문
   */
  @Post('callback')
  @HttpCode(HttpStatus.OK)
  async callbackRefund(@Body() dto: PgRefundCallbackDto) {
    await this.refundResultService.receiveCallback({
      success: dto.success,
      paymentCancelId: dto.paymentCancelId,
      pgTransactionId: dto.pgTransactionId,
      orderItemId: dto.orderItemId ?? null,
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
