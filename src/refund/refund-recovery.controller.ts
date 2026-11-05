import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtValidationResult } from 'src/auth/interfaces/jwt-payload.interface';
import { EmptyBodyDto } from './dto';
import { RefundAccessService } from './refund-access.service';
import { RefundRecoveryService } from './refund-recovery.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * 환불 PG 결과 장애 복구 운영 API (API 계약 §8, MANAGER 전용)
 */
@ApiTags('refund')
@Controller('refund/recovery')
export class RefundRecoveryController {
  constructor(
    private readonly accessService: RefundAccessService,
    private readonly recoveryService: RefundRecoveryService,
  ) {}

  /**
   * 복구 현황을 조회한다
   * @param user 요청한 사용자(JWT)
   * @returns 모드·실행 여부·건수·가장 오래된 결과 확인 실패 시각·다음 확인 시각
   */
  @ApiOperation({ summary: '운영자의 PG 취소 결과 장애 복구 현황 조회' })
  @Get('status')
  async status(@CurrentUser() user: JwtValidationResult) {
    this.accessService.assertOperator({
      userId: user.userId,
      role: user.role,
    });
    return this.recoveryService.recoveryStatus(new Date());
  }

  /**
   * 결과 확인 실패 건의 전체 재확인을 예약한다
   * @param user 요청한 사용자(JWT)
   * @param _body 본문 없음/{}만 허용
   * @param res 응답 상태 지정용(SCHEDULED 202, 그 밖 200)
   * @returns 예약 결과
   */
  @ApiOperation({ summary: '운영자가 결과 확인 실패 건의 전체 재조회를 예약' })
  @Post('resume')
  async resume(
    @CurrentUser() user: JwtValidationResult,
    @Body() _body: EmptyBodyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: string }> {
    this.accessService.assertOperator({
      userId: user.userId,
      role: user.role,
    });
    const status = await this.recoveryService.resumeRecovery(new Date());
    res.status(status === 'SCHEDULED' ? 202 : 200);
    return { status };
  }
}
