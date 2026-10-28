import { Injectable } from '@nestjs/common';
import { RefundNotificationAudience } from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';

/** 저장할 환불 사건 알림 */
export type RefundNotificationInput = {
  refundId: string;
  paymentCancelId?: string; // 관련 PG 취소 요청
  kind: string; // 알림 종류
  audience: RefundNotificationAudience;
  shopId: string; // 원래 주문의 매장
  eventKey: string; // 같은 사건의 중복 알림을 막는 키
};

/**
 * 환불 사건 알림 저장소 (data-model §8)
 * - 같은 eventKey·수신 범위·수신자 조합은 부분 unique 인덱스로 한 번만 저장된다
 */
@Injectable()
export class RefundEventRepository {
  /**
   * 사건 알림을 현재 트랜잭션에 저장한다. 이미 같은 사건 알림이 있으면 그대로 둔다
   * @param tx 사건을 반영하는 트랜잭션
   * @param input 알림 내용
   */
  async recordNotification(
    tx: TransactionClient,
    input: RefundNotificationInput,
  ): Promise<void> {
    await tx.refundNotification.createMany({
      data: [input],
      skipDuplicates: true,
    });
  }
}
