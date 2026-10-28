import { Injectable } from '@nestjs/common';
import {
  PaymentCancelFailureCode,
  PaymentCancelStatus,
  RefundPayoutStatus,
} from '@prisma/client';
import { RefundLedgerRepository } from 'src/ledger/refund-ledger.repository';
import { RefundRepository } from './refund.repository';
import { RefundLockingRepository } from './refund-locking.repository';

/** PG가 확정한 PG 취소 요청 결과 */
export type PgCancelOutcome =
  | { kind: 'SUCCEEDED'; pgTransactionId: string; actualAmount: number }
  | { kind: 'FAILED'; reason: string };

/** 결과를 반영할 수 있는 미확정 PG 취소 요청 상태 */
const unresolvedAttemptStatuses: readonly PaymentCancelStatus[] = [
  PaymentCancelStatus.REQUESTED,
  PaymentCancelStatus.QUERY_FAILED,
];

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
      // 결과는 미확정 시도에만 한 번 반영한다(이미 확정된 시도는 저장된 결과를 유지)
      if (!unresolvedAttemptStatuses.includes(attempt.status)) return;
      const now = new Date();
      const { outcome } = command;
      // PG 거절: 그 시도만 실패로 끝내고 환불은 미지급 조치 필요로 둔다(원장 없음, 이용 종료 유지)
      if (outcome.kind === 'FAILED') {
        await this.refundRepository.markAttemptFailed(tx, attempt.id, {
          failureCode: PaymentCancelFailureCode.PG_REJECTED,
          failureReason: outcome.reason,
          now,
        });
        await this.refundRepository.updateRefundPayout(tx, attempt.refund.id, {
          payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
          actionCode: 'PG_REJECTED',
        });
        return;
      }

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
      // 확정된 환불 금액과 같으면 지급 완료, 다르면 금액은 그대로 두고 조치·검토 필요(API 계약 §6)
      const settled = paidAmount === attempt.refund.amount;
      await this.refundRepository.updateRefundPayout(
        tx,
        attempt.refund.id,
        settled
          ? { paidAmount, payoutStatus: RefundPayoutStatus.PAID, paidAt: now }
          : {
              paidAmount,
              payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
              reviewRequired: true,
              actionCode: 'AMOUNT_MISMATCH',
            },
      );
    });
  }
}
