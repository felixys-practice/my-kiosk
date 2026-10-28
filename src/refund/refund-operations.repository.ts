import { Injectable } from '@nestjs/common';
import { ManualRefundPayoutStatus, RefundPayoutMethod } from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';

/**
 * 별도 환불금 지급 저장소 (data-model §5)
 * - 모든 쓰기는 호출자가 Refund를 잠근 트랜잭션 안에서 한다
 */
@Injectable()
export class RefundOperationsRepository {
  /**
   * 별도 환불금 지급 예약을 저장하고 환불 지급 방식을 MANUAL로 고정한다
   * - 환불은 조치 필요 그대로다(예약은 지급 완료가 아니다)
   * @param tx Refund 잠금 트랜잭션
   * @param input 환불·금액·예약자·사유·시각
   * @returns 예약 ID
   */
  async createReservation(
    tx: TransactionClient,
    input: {
      refundId: string;
      amount: number;
      reservedById: string;
      reason: string;
      now: Date;
    },
  ): Promise<string> {
    const payout = await tx.manualRefundPayout.create({
      data: {
        refundId: input.refundId,
        status: ManualRefundPayoutStatus.RESERVED,
        amount: input.amount,
        reservedById: input.reservedById,
        reservedAt: input.now,
        reason: input.reason,
      },
      select: { id: true },
    });
    await tx.refund.update({
      where: { id: input.refundId },
      data: { payoutMethod: RefundPayoutMethod.MANUAL },
    });
    return payout.id;
  }
}
