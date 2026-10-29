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

@Controller('refund/notifications')
export class RefundNotificationController {
  constructor(private readonly service: RefundNotificationService) {}

  @Patch(':notificationId/read')
  read(
    @CurrentUser() user: JwtValidationResult,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
    @Body() _body: EmptyBodyDto,
  ) {
    return this.service.read(user, notificationId, new Date());
  }

  @Get()
  list(
    @CurrentUser() user: JwtValidationResult,
    @Query() query: GetRefundNotificationQueryDto,
  ) {
    return this.service.list(user, query);
  }
}
