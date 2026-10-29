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
  UseGuards,
} from '@nestjs/common';
import { Public } from 'src/auth/decorators/public.decorator';
import { PgSignatureGuard } from 'src/pg/guards/pg-signature.guard';
import type { Response } from 'express';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtValidationResult } from 'src/auth/interfaces/jwt-payload.interface';
import { RefundService } from './refund.service';
import {
  GetRefundQueryDto,
  RefundDto,
  PgRefundCallbackDto,
  StoreRefundDto,
  EmptyBodyDto,
} from './dto';
import { RefundStoreService } from './refund-store.service';
import { RefundPgCheckService } from './refund-pg-check.service';
import { RefundAcceptanceService } from './refund-acceptance.service';
import { RefundResultService } from './refund-result.service';
import { RefundQueryService } from './refund-query.service';

@Controller('refund')
export class RefundController {
  constructor(
    private readonly refundService: RefundService,
    private readonly refundAcceptanceService: RefundAcceptanceService,
    private readonly refundResultService: RefundResultService,
    private readonly refundStoreService: RefundStoreService,
    private readonly refundPgCheckService: RefundPgCheckService,
    private readonly refundQueryService: RefundQueryService,
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
   * 점주·운영자가 환불의 PG 결과를 개별 확인한다 (API 계약 §8 POST /refund/:refundId/pg-check)
   * @param user 요청한 사용자(JWT)
   * @param refundId 확인할 환불
   * @param _body 본문 없음/{}만 허용(금액·시도 ID·결과는 입력받지 않는다)
   * @param res 응답 상태 지정용(진행 중 202, 그 밖 200)
   * @returns 확인 결과와 최신 환불 정보
   */
  @Post(':refundId/pg-check')
  async pgCheck(
    @CurrentUser() user: JwtValidationResult,
    @Param('refundId', ParseUUIDPipe) refundId: string,
    @Body() _body: EmptyBodyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.refundPgCheckService.check(
      { userId: user.userId, role: user.role },
      refundId,
      new Date(),
    );
    res.status(result.checkStatus === 'ALREADY_RUNNING' ? 202 : 200);
    return result;
  }

  /**
   * PG 취소 결과 콜백을 받는다 (API 계약 §7 POST /refund/callback, 200 수신 확인)
   * @param dto 콜백 본문
   */
  @Post('callback')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(PgSignatureGuard)
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
    @CurrentUser() user: JwtValidationResult,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ) {
    return this.refundQueryService.byShop(user, shopId);
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
