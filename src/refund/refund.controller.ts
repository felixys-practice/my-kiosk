import {
  Body,
  Controller,
  Get,
  Headers,
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

@Controller('refund')
export class RefundController {
  constructor(
    private readonly refundService: RefundService,
    private readonly refundAcceptanceService: RefundAcceptanceService,
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

  @Post('callback')
  async callbackRefund(@Body() dto: PgRefundCallbackDto) {
    await this.refundService.callback(
      dto.success,
      dto.paymentCancelId,
      dto.orderItemId,
      dto.amount,
      dto.reason,
    );
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
