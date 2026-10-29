import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtValidationResult } from 'src/auth/interfaces/jwt-payload.interface';
import { RefundNotificationService } from './refund-notification.service';
import { GetRefundNotificationQueryDto } from './dto/get-refund-notification-query.dto';

@Controller('refund/notifications')
export class RefundNotificationController {
  constructor(private readonly service: RefundNotificationService) {}

  @Get()
  list(
    @CurrentUser() user: JwtValidationResult,
    @Query() query: GetRefundNotificationQueryDto,
  ) {
    return this.service.list(user, query);
  }
}
