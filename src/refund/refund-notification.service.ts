import { BadRequestException, Injectable } from '@nestjs/common';
import { RefundNotificationRepository } from './refund-notification.repository';
import type { RefundActor } from './refund-access.service';
import { GetRefundNotificationQueryDto } from './dto/get-refund-notification-query.dto';

@Injectable()
export class RefundNotificationService {
  constructor(private readonly repository: RefundNotificationRepository) {}

  async list(actor: RefundActor, query = new GetRefundNotificationQueryDto()) {
    if (!Number.isSafeInteger((query.page - 1) * query.limit)) {
      throw new BadRequestException(
        '페이지와 크기로 계산한 조회 위치를 처리할 수 없습니다',
      );
    }
    return this.repository.list(actor, query);
  }
}
