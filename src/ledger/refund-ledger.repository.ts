import { Injectable } from '@nestjs/common';
import { LedgerStatus } from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';

/** 실제 환불금 지급 원장 기록 내용 */
export type RefundPayoutLedgerInput = {
  shopId: string; // 원래 주문의 매장
  orderId: string; // 원래 주문
  refundId: string;
  paidAmount: number; // 실제 지급액(양수). 원장에는 음수로 기록한다
  paymentCancelId?: string; // PG 결제 취소로 지급했으면 그 요청
  manualRefundPayoutId?: string; // 별도 환불금 지급이면 그 지급
};

/**
 * 환불 지급 원장 저장소 (data-model §8)
 * - 지급별(paymentCancelId·manualRefundPayoutId) unique와 0원 refundId unique가 중복 기록을 막는다
 */
@Injectable()
export class RefundLedgerRepository {
  /**
   * 실제 지급액의 음수 원장을 현재 트랜잭션에 저장한다
   * @param tx 지급 결과 반영 트랜잭션
   * @param input 지급 내용
   */
  async recordPayout(
    tx: TransactionClient,
    input: RefundPayoutLedgerInput,
  ): Promise<void> {
    await tx.ledger.create({
      data: {
        shopId: input.shopId,
        orderId: input.orderId,
        refundId: input.refundId,
        amount: -input.paidAmount,
        status: LedgerStatus.RELEASABLE,
        paymentCancelId: input.paymentCancelId,
        manualRefundPayoutId: input.manualRefundPayoutId,
      },
    });
  }
}
