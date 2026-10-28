import { Injectable } from '@nestjs/common';
import { RefundPayoutStatus } from '@prisma/client';
import { RefundLedgerRepository } from 'src/ledger/refund-ledger.repository';
import { RefundRepository } from './refund.repository';
import { RefundLockingRepository } from './refund-locking.repository';

/** PG가 확정한 PG 취소 요청 결과 */
export type PgCancelOutcome =
  | { kind: 'SUCCEEDED'; pgTransactionId: string; actualAmount: number }
  | { kind: 'FAILED'; reason: string };

/** 결과 반영 요청 */
export type ApplyPgResultCommand = {
  paymentCancelId: string; // 결과가 온 PG 취소 요청
  outcome: PgCancelOutcome;
  claimToken?: string; // 자동 작업이 반영할 때의 담당 토큰(콜백은 없음)
};

/**
 * 환불금 지급 결과 공통 처리 (API 계약 §6)
 * - Refund → PaymentCancel 순서로 잠근 뒤 최종 상태·실제액·지급 합계·원장·필요 알림을 한 트랜잭션에 반영한다
 * - 실패·미확정에는 원장을 만들지 않는다
 */
@Injectable()
export class RefundResultService {
  constructor(
    private readonly refundRepository: RefundRepository,
    private readonly lockingRepository: RefundLockingRepository,
    private readonly ledgerRepository: RefundLedgerRepository,
  ) {}

  /**
   * PG가 확정한 결과를 반영한다
   * @param command PG 취소 요청과 결과
   */
  async applyPgResult(command: ApplyPgResultCommand): Promise<void> {
    await this.refundRepository.runInTransaction(async (tx) => {
      // 결과가 온 PG 취소 요청과 환불을 찾고 Refund → PaymentCancel 순서로 잠근 뒤 다시 읽는다
      const found = await this.refundRepository.findAttemptForResult(
        command.paymentCancelId,
        tx,
      );
      if (!found) return;
      await this.lockingRepository.lockForPayout(tx, {
        refundId: found.refund.id,
        paymentCancelIds: [found.id],
        manualRefundPayoutIds: [],
      });
      const attempt = (await this.refundRepository.findAttemptForResult(
        command.paymentCancelId,
        tx,
      ))!;
      const now = new Date();
      const { outcome } = command;
      if (outcome.kind !== 'SUCCEEDED') return;

      // PG 취소 성공: 실제액을 기록하고 지급 합계에 더한다
      await this.refundRepository.markAttemptSucceeded(tx, attempt.id, {
        pgTransactionId: outcome.pgTransactionId,
        actualAmount: outcome.actualAmount,
        now,
      });
      await this.ledgerRepository.recordPayout(tx, {
        shopId: attempt.refund.shopId,
        orderId: attempt.refund.orderId,
        refundId: attempt.refund.id,
        paidAmount: outcome.actualAmount,
        paymentCancelId: attempt.id,
      });
      const paidAmount = attempt.refund.paidAmount + outcome.actualAmount;
      await this.refundRepository.updateRefundPayout(tx, attempt.refund.id, {
        paidAmount,
        payoutStatus: RefundPayoutStatus.PAID,
        paidAt: now,
      });
    });
  }
}
