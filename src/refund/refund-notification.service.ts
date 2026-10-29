import { BadRequestException, Injectable } from '@nestjs/common';
import { RefundNotificationRepository } from './refund-notification.repository';
import type { RefundActor } from './refund-access.service';
import { GetRefundNotificationQueryDto } from './dto/get-refund-notification-query.dto';
import type { NotificationRow } from './refund-notification.repository';
import { PaginationUtil } from 'src/common/pagination/pagination.util';

const notificationMessages: Record<string, string> = {
  SEND_FAILED: '환불금 지급 요청을 보내지 못해 확인이 필요합니다.',
  PG_REJECTED: '환불금 지급 요청이 거절되어 확인이 필요합니다.',
  RETRY_EXHAUSTED: '환불금 지급 요청의 자동 재전송 한도에 도달했습니다.',
  QUERY_FAILED: 'PG 취소 결과를 확인하지 못해 재확인 중입니다.',
  AMOUNT_MISMATCH: '확정 금액과 실제 환불금 지급액이 달라 확인이 필요합니다.',
  PG_RESULT_CONFLICT: 'PG 취소 결과가 기존 기록과 달라 확인이 필요합니다.',
  MANUAL_CONFIRMATION_REQUIRED: '별도 환불금 지급 여부를 확인해 주세요.',
};

@Injectable()
export class RefundNotificationService {
  constructor(private readonly repository: RefundNotificationRepository) {}

  async list(actor: RefundActor, query = new GetRefundNotificationQueryDto()) {
    if (!Number.isSafeInteger((query.page - 1) * query.limit)) {
      throw new BadRequestException(
        '페이지와 크기로 계산한 조회 위치를 처리할 수 없습니다',
      );
    }
    const result = await this.repository.list(actor, query);
    return {
      items: result.items.map((row) => this.view(row)),
      meta: PaginationUtil.createMeta(query.page, query.limit, result.total),
    };
  }

  private view(row: NotificationRow) {
    const readAt = row.receipts[0]?.readAt ?? null;
    return {
      notificationId: row.id,
      refundId: row.refundId,
      paymentCancelId: row.paymentCancelId,
      manualRefundPayoutId: row.manualRefundPayoutId,
      kind: row.kind,
      audience: row.audience,
      shopId: row.shopId,
      message:
        notificationMessages[row.kind] ?? '환불 처리 상태를 확인해 주세요.',
      createdAt: row.createdAt,
      isRead: readAt !== null,
      readAt,
    };
  }
}
