import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtValidationResult } from 'src/auth/interfaces/jwt-payload.interface';
import { RefundNotificationService } from './refund-notification.service';
import { GetRefundNotificationQueryDto } from './dto/get-refund-notification-query.dto';
import { EmptyBodyDto } from './dto/empty-body.dto';
import {
  ApiOperation,
  ApiTags,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import {
  ApiRefundResponse,
  ApiRefundErrors,
  notificationListSchema,
  notificationSchema,
} from './refund.swagger';

/** 수신자 범위에 맞는 환불 알림 조회와 읽음 처리 API. */
@ApiTags('refund')
@ApiBearerAuth('access-token')
@Controller('refund/notifications')
export class RefundNotificationController {
  constructor(private readonly service: RefundNotificationService) {}

  /** 현재 로그인한 사용자에게 전달된 알림만 읽음 처리한다. */
  @ApiParam({
    name: 'notificationId',
    format: 'uuid',
    description: 'notificationId (UUID)',
  })
  @ApiBody({
    required: false,
    description: '본문 생략 또는 빈 객체만 허용합니다.',
    schema: { type: 'object', additionalProperties: false },
  })
  @ApiRefundResponse(200, '읽음 처리한 알림', notificationSchema)
  @ApiRefundErrors(400, 401, 403, 404)
  @ApiOperation({ summary: '본인에게 전달된 환불 알림을 읽음 처리' })
  @Patch(':notificationId/read')
  read(
    @CurrentUser() user: JwtValidationResult,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
    @Body() _body: EmptyBodyDto,
  ) {
    void _body;
    return this.service.read(user, notificationId, new Date());
  }

  /** 고객·현재 점주·운영자에게 허용된 수신 알림만 조회한다. */
  @ApiRefundResponse(200, '수신 알림 목록', notificationListSchema)
  @ApiRefundErrors(400, 401, 403, 404)
  @ApiOperation({ summary: '권한 범위 안의 환불 알림 목록 조회' })
  @Get()
  list(
    @CurrentUser() user: JwtValidationResult,
    @Query() query: GetRefundNotificationQueryDto,
  ) {
    return this.service.list(user, query);
  }
}
