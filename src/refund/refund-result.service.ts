import { Injectable } from '@nestjs/common';
import {
  PaymentCancelFailureCode,
  PaymentCancelStatus,
  RefundNotificationAudience,
  RefundPayoutStatus,
} from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';
import { RefundLedgerRepository } from 'src/ledger/refund-ledger.repository';
import { AttemptForResult, RefundRepository } from './refund.repository';
import { RefundEventRepository } from './refund-event.repository';
import {
  PgCallbackTargetMismatchError,
  PgCallbackTargetNotFoundError,
} from './errors';
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

/** PG 취소 결과 콜백 본문 */
export type RefundCallbackInput = {
  success: boolean;
  paymentCancelId: string;
  pgTransactionId: string; // PG 취소 거래 ID
  orderItemId: string | null; // PAYMENT 대상이면 null
  amount: number; // 성공이면 실제 취소액
  reason?: string | null;
};

/** 결과 반영 결과 */
export type ApplyPgResultOutcome = {
  applied: boolean; // 이번 요청으로 결과를 저장했는지
  attemptStatus: PaymentCancelStatus;
  payoutStatus: RefundPayoutStatus;
};

/** 결과 반영 요청 */
export type ApplyPgResultCommand = {
  paymentCancelId: string; // 결과가 온 PG 취소 요청
  outcome: PgCancelOutcome;
  claimToken?: string; // 자동 작업이 반영할 때의 담당 토큰(콜백은 없음)
  expectedOrderItemId?: string | null; // 콜백이 가리킨 환불 대상(콜백만, PAYMENT 대상이면 null)
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
    private readonly eventRepository: RefundEventRepository,
  ) {}

  /**
   * PG가 확정한 결과를 반영한다
   * @param command PG 취소 요청과 결과
   * @returns 반영 여부와 반영 후(반영하지 않았으면 저장된) 상태, PG 취소 요청이 없으면 null
   */
  async applyPgResult(
    command: ApplyPgResultCommand,
  ): Promise<ApplyPgResultOutcome | null> {
    return this.refundRepository.runInTransaction(async (tx) => {
      // 결과가 온 PG 취소 요청과 환불을 찾고 Refund → PaymentCancel 순서로 잠근 뒤 다시 읽는다
      const found = await this.refundRepository.findAttemptForResult(
        command.paymentCancelId,
        tx,
      );
      if (!found) return null;
      await this.lockingRepository.lockForPayout(tx, {
        refundId: found.refund.id,
        paymentCancelIds: [found.id],
        manualRefundPayoutIds: [],
      });
      const attempt = (await this.refundRepository.findAttemptForResult(
        command.paymentCancelId,
        tx,
      ))!;
      // 콜백이 가리킨 대상이 저장된 PaymentCancel → Refund 대상과 다르면 반영하지 않는다(API 계약 §7)
      if (
        command.expectedOrderItemId !== undefined &&
        attempt.refund.orderItemId !== command.expectedOrderItemId
      ) {
        throw new PgCallbackTargetMismatchError();
      }
      const stored: ApplyPgResultOutcome = {
        applied: false,
        attemptStatus: attempt.status,
        payoutStatus: attempt.refund.payoutStatus,
      };
      // 담당이 다른 작업으로 넘어갔으면 이 작업의 결과는 저장하지 않는다(API 계약 §6 담당 토큰 재확인)
      if (
        command.claimToken !== undefined &&
        attempt.claimToken !== command.claimToken
      ) {
        return stored;
      }
      const now = new Date();
      const { outcome } = command;
      // 결과는 미확정 시도에만 한 번 반영한다(이미 확정된 시도는 저장된 결과를 유지)
      if (!unresolvedAttemptStatuses.includes(attempt.status)) {
        // 확정된 결과와 모순되는 늦은 통보는 덮어쓰지 않고 검토 필요·운영자 알림으로 남긴다(API 계약 §7)
        if (attempt.status !== outcome.kind) {
          await this.recordResultConflict(tx, attempt);
        }
        return stored;
      }
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
        return {
          applied: true,
          attemptStatus: PaymentCancelStatus.FAILED,
          payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
        };
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
      const payoutStatus = settled
        ? RefundPayoutStatus.PAID
        : RefundPayoutStatus.ACTION_REQUIRED;
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
      return {
        applied: true,
        attemptStatus: PaymentCancelStatus.SUCCEEDED,
        payoutStatus,
      };
    });
  }

  /**
   * PG 취소 결과 콜백을 대상과 대조한 뒤 공통 결과 처리로 반영한다 (API 계약 §7 POST /refund/callback)
   * @param callback 콜백 본문
   * @returns 반영 결과
   */
  async applyCallback(
    callback: RefundCallbackInput,
  ): Promise<ApplyPgResultOutcome> {
    const outcome: PgCancelOutcome = callback.success
      ? {
          kind: 'SUCCEEDED',
          pgTransactionId: callback.pgTransactionId,
          actualAmount: callback.amount,
        }
      : { kind: 'FAILED', reason: callback.reason ?? '' };
    const result = await this.applyPgResult({
      paymentCancelId: callback.paymentCancelId,
      expectedOrderItemId: callback.orderItemId,
      outcome,
    });
    if (!result) throw new PgCallbackTargetNotFoundError();
    return result;
  }

  /**
   * 확정된 시도와 모순되는 PG 결과를 검토 필요·운영자 알림으로 기록한다
   * - 지급 합계·원장·시도 상태는 바꾸지 않는다
   * @param tx 지급 결과 반영 트랜잭션
   * @param attempt 이미 확정된 PG 취소 요청과 그 환불
   */
  private async recordResultConflict(
    tx: TransactionClient,
    attempt: AttemptForResult,
  ): Promise<void> {
    await this.refundRepository.updateRefundPayout(tx, attempt.refund.id, {
      reviewRequired: true,
      actionCode: 'PG_RESULT_CONFLICT',
    });
    await this.eventRepository.recordNotification(tx, {
      refundId: attempt.refund.id,
      paymentCancelId: attempt.id,
      kind: 'PG_RESULT_CONFLICT',
      audience: RefundNotificationAudience.OPERATOR,
      shopId: attempt.refund.shopId,
      eventKey: `pg-result-conflict:${attempt.id}`,
    });
  }
}
