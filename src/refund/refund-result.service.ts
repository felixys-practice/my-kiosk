import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentCancelFailureCode,
  PaymentCancelStatus,
  Prisma,
  RefundNotificationAudience,
  RefundPayoutStatus,
  RefundSource,
} from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';
import type { PgCancelQueryResult } from 'src/pg/pg.types';
import {
  TransactionLog,
  TransactionLoggerService,
} from 'src/logger/transaction-logger.service';
import { RefundLedgerRepository } from 'src/ledger/refund-ledger.repository';
import { PaymentCancelForResult, RefundRepository } from './refund.repository';
import { RefundEventRepository } from './refund-event.repository';
import {
  PaymentCancelResultTargetMissingError,
  PgCallbackTargetMismatchError,
  PgCallbackTargetNotFoundError,
  RefundStorageUnavailableError,
} from './errors';
import { isDomainError } from 'src/common/errors';
import { RefundLockingRepository } from './refund-locking.repository';
import { evaluatePayoutRetry } from './refund-retry.policy';

/** PG가 확정한 PG 취소 요청 결과 */
export type PgCancelOutcome =
  | { kind: 'SUCCEEDED'; pgTransactionId: string; actualAmount: number }
  | {
      kind: 'FAILED';
      reason: string;
      // 실패 사유 코드(기본 PG 거절). 전송 전 실패는 SEND_FAILED
      failureCode?: PaymentCancelFailureCode;
    };

/** 결과를 반영할 수 있는 미확정 PG 취소 요청 상태 */
const unresolvedAttemptStatuses: readonly PaymentCancelStatus[] = [
  PaymentCancelStatus.REQUESTED, // 취소 요청을 기록했지만 최종 결과는 미확정(전송 전·PG 처리 중·응답 유실 포함)
  PaymentCancelStatus.QUERY_FAILED, // 결과 조회의 연속 실패가 한도에 도달함. 취소 실패 확정은 아니며 장애 복구 조회로 계속 확인
];

/** PG 취소 결과 콜백 본문 */
export type RefundCallbackInput = {
  success: boolean;
  paymentCancelId: string;
  pgTransactionId: string; // PG 취소 거래 ID
  amount: number; // 성공이면 실제 취소액
  reason?: string | null;
};

/**
 * 확정된 PG 취소 요청과 새로 온 결과가 모순되는지 판단한다
 * @param storedPaymentCancel 이미 확정된 PG 취소 요청
 * @param outcome 새로 온 결과
 * @returns 결과 종류, 성공 실제액 또는 PG 취소 거래 ID가 다르면 true
 */
function contradicts(
  storedPaymentCancel: PaymentCancelForResult,
  outcome: PgCancelOutcome,
) {
  if (storedPaymentCancel.status !== outcome.kind) return true;
  return (
    outcome.kind === 'SUCCEEDED' &&
    (storedPaymentCancel.actualAmount !== outcome.actualAmount ||
      storedPaymentCancel.pgTransactionId !== outcome.pgTransactionId)
  );
}

/**
 * 다른 PG 취소 요청이 이미 사용한 PG 취소 거래 ID의 unique 위반을 연결 불일치로 바꾼다
 * - 중복 저장은 DB unique가 막고, 위반 오류는 저장 장애(503) 대신 대상 불일치(409)로 전달한다.
 * @param error 결과 반영 트랜잭션에서 난 오류
 * @throws PgCallbackTargetMismatchError PG 취소 거래 ID unique 위반이면
 * @throws 그 밖의 오류는 그대로 다시 던진다
 */
function rethrowCancelTransactionConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    error.meta?.modelName === 'PaymentCancel' &&
    JSON.stringify(error.meta).includes('pg_transaction_id')
  ) {
    throw new PgCallbackTargetMismatchError();
  }
  throw error;
}

/** 결과 반영 결과 */
export type ApplyPgResultOutcome = {
  applied: boolean; // 이번 요청으로 결과를 저장했는지
  attemptStatus: PaymentCancelStatus;
  payoutStatus: RefundPayoutStatus;
};

/** 결과 반영 요청 */
export type CancelResultUpdate = {
  source: 'DISPATCH' | 'RECOVERY' | 'CALLBACK' | 'INDIVIDUAL_CHECK'; // INDIVIDUAL_CHECK는 실패한 요청의 개별 PG 조회 결과다.
  paymentCancelId: string; // 결과가 온 PG 취소 요청
  pgCancelResult: PgCancelOutcome;
  claimToken?: string; // 자동 작업이 반영할 때의 담당 토큰(콜백은 없음)
};

/**
 * 환불금 지급 결과 공통 처리 (API 계약 §6)
 * - Refund → PaymentCancel 순서로 잠근 뒤 최종 상태·실제액·지급 합계·원장·필요 알림을 한 트랜잭션에 반영한다
 * - 실패·미확정에는 원장을 만들지 않는다
 */
@Injectable()
export class RefundResultService {
  private readonly logger = new Logger(RefundResultService.name);
  constructor(
    private readonly refundRepository: RefundRepository,
    private readonly lockingRepository: RefundLockingRepository,
    private readonly ledgerRepository: RefundLedgerRepository,
    private readonly eventRepository: RefundEventRepository,
    private readonly txLogger: TransactionLoggerService,
  ) {}

  /**
   * PG가 확정한 결과를 반영한다
   * @param cancelResultUpdate 결과를 반영할 PG 취소 요청 ID·결과·검증 정보
   * @returns 반영 여부와 반영 후(반영하지 않았으면 저장된) 상태, PG 취소 요청이 없으면 예외를 던진다
   */
  async applyPgResult(
    cancelResultUpdate: CancelResultUpdate,
  ): Promise<ApplyPgResultOutcome> {
    // 조치가 필요한 사건은 커밋된 뒤에만 거래 로그에 남긴다(롤백된 사건을 기록하지 않는다)
    const actionLogs: TransactionLog[] = [];
    const result = await this.refundRepository
      .runInTransaction(async (tx) => {
        // 결과가 온 PG 취소 요청과 환불을 찾고 Refund → PaymentCancel 순서로 잠근 뒤 다시 읽는다
        const found = await this.refundRepository.findPaymentCancelForResult(
          cancelResultUpdate.paymentCancelId,
          tx,
        );
        if (!found) {
          throw new PaymentCancelResultTargetMissingError(
            cancelResultUpdate.paymentCancelId,
          );
        }
        await this.lockingRepository.lockForPayout(tx, {
          refundId: found.refund.id,
          paymentCancelIds: [found.id],
          manualRefundPayoutIds: [],
        });
        const storedPaymentCancel =
          await this.refundRepository.findPaymentCancelForResult(
            cancelResultUpdate.paymentCancelId,
            tx,
          );
        if (!storedPaymentCancel) {
          throw new PaymentCancelResultTargetMissingError(
            cancelResultUpdate.paymentCancelId,
          );
        }
        const stored: ApplyPgResultOutcome = {
          applied: false,
          attemptStatus: storedPaymentCancel.status,
          payoutStatus: storedPaymentCancel.refund.payoutStatus,
        };
        // 담당이 다른 작업으로 넘어갔으면 이 작업의 결과는 저장하지 않는다(API 계약 §6 담당 토큰 재확인)
        if (
          cancelResultUpdate.claimToken !== undefined && // PG 콜백에서 호출 시 claimToken = undefined
          storedPaymentCancel.claimToken !== cancelResultUpdate.claimToken
        ) {
          return stored;
        }
        const now = new Date();
        const { pgCancelResult: outcome } = cancelResultUpdate;
        // 개별 조회에서 PG 취소 성공이 확인되면 SEND_FAILED·RETRY_EXHAUSTED의 내부 실패를 정정한다.
        // 두 사유는 PG 최종 거절을 뜻하지 않으므로 기존 요청에 실제 취소 결과를 반영한다.
        // 콜백·전송 결과에는 이 예외를 적용하지 않으며 조회 작업 토큰이 반드시 필요하다.
        const correctInternalFailure =
          cancelResultUpdate.source === 'INDIVIDUAL_CHECK' &&
          cancelResultUpdate.claimToken !== undefined &&
          storedPaymentCancel.status === PaymentCancelStatus.FAILED &&
          (storedPaymentCancel.failureCode ===
            PaymentCancelFailureCode.SEND_FAILED ||
            storedPaymentCancel.failureCode ===
              PaymentCancelFailureCode.RETRY_EXHAUSTED) &&
          outcome.kind === 'SUCCEEDED';
        if (correctInternalFailure) {
          await this.refundRepository.releasePaymentCancelClaim(
            tx,
            storedPaymentCancel.id,
            cancelResultUpdate.claimToken!,
            null,
          );
          // 자기 조회 점유만 해제한 뒤 다른 지급·예약과 최근 요청을 다시 검사한다.
          const target = await this.refundRepository.findPayoutRetryTarget(
            storedPaymentCancel.refund.id,
            tx,
          );
          const candidate =
            await this.refundRepository.findFailedRetryCandidate(
              storedPaymentCancel.refund.id,
              tx,
            );
          if (
            !target ||
            candidate?.id !== storedPaymentCancel.id ||
            !evaluatePayoutRetry(target.state, now).allowed
          )
            return stored;
          actionLogs.push({
            transactionId: `REFUND-${storedPaymentCancel.refund.id}-${storedPaymentCancel.id}`,
            type: 'REFUND',
            userId: storedPaymentCancel.refund.customerId,
            orderId: storedPaymentCancel.refund.orderId,
            status: `${storedPaymentCancel.failureCode}_CORRECTED_BY_PG_QUERY`,
            metadata: {
              paymentCancelId: storedPaymentCancel.id,
              previousStatus: storedPaymentCancel.status,
              previousFailureCode: storedPaymentCancel.failureCode,
              previousFailureReason: storedPaymentCancel.failureReason,
              previousFailedAt: storedPaymentCancel.failedAt,
              received: outcome,
            },
          });
        }
        // 내부 실패 정정을 제외한 최종 결과는 기존 충돌 처리 규칙을 유지한다.
        if (
          !unresolvedAttemptStatuses.includes(storedPaymentCancel.status) &&
          !correctInternalFailure
        ) {
          if (
            cancelResultUpdate.source === 'INDIVIDUAL_CHECK' &&
            cancelResultUpdate.claimToken !== undefined
          ) {
            await this.refundRepository.releasePaymentCancelClaim(
              tx,
              storedPaymentCancel.id,
              cancelResultUpdate.claimToken,
              null,
            );
          }
          // 확정된 결과와 모순되는 늦은 통보는 덮어쓰지 않고 검토 필요·운영자 알림으로 남긴다(API 계약 §7)
          if (contradicts(storedPaymentCancel, outcome)) {
            await this.recordResultConflict(
              tx,
              storedPaymentCancel,
              outcome,
              actionLogs,
            );
            // 모순 기록으로 환불은 조치 필요가 됐다. 반환 상태도 저장된 상태와 맞춘다
            return {
              ...stored,
              payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
            };
          }
          return stored;
        }
        // 시도 실패(PG 거절·전송 전 실패): 그 시도만 실패로 끝내고 환불은 미지급 조치 필요로 둔다(원장 없음, 이용 종료 유지)
        if (outcome.kind === 'FAILED') {
          const failureCode =
            outcome.failureCode ?? PaymentCancelFailureCode.PG_REJECTED;
          await this.refundRepository.markPaymentCancelFailed(
            tx,
            storedPaymentCancel.id,
            {
              failureCode,
              failureReason: outcome.reason,
              now,
            },
          );
          await this.refundRepository.updateRefundPayout(
            tx,
            storedPaymentCancel.refund.id,
            {
              payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
              actionCode: failureCode,
            },
          );
          await this.notifyPayoutAction(
            tx,
            storedPaymentCancel,
            failureCode,
            actionLogs,
          );
          return {
            applied: true,
            attemptStatus: PaymentCancelStatus.FAILED,
            payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
          };
        }

        // PG 취소 성공: 실제액을 기록하고 지급 합계에 더한다
        await this.refundRepository.markPaymentCancelSucceeded(
          tx,
          storedPaymentCancel.id,
          {
            pgTransactionId: outcome.pgTransactionId,
            actualAmount: outcome.actualAmount,
            now,
          },
        );
        await this.ledgerRepository.recordPayout(tx, {
          shopId: storedPaymentCancel.refund.shopId,
          orderId: storedPaymentCancel.refund.orderId,
          refundId: storedPaymentCancel.refund.id,
          paidAmount: outcome.actualAmount,
          paymentCancelId: storedPaymentCancel.id,
        });
        const paidAmount =
          storedPaymentCancel.refund.paidAmount + outcome.actualAmount;
        // 지급 완료는 미지급액 0이고 검토가 끝났을 때만이다(data-model §2). 금액이 다르면 금액은 그대로 두고 조치·검토 필요(API 계약 §6)
        const amountMatches = paidAmount === storedPaymentCancel.refund.amount;
        const settled =
          amountMatches && !storedPaymentCancel.refund.reviewRequired;
        const payoutStatus = settled
          ? RefundPayoutStatus.PAID
          : RefundPayoutStatus.ACTION_REQUIRED;
        await this.refundRepository.updateRefundPayout(
          tx,
          storedPaymentCancel.refund.id,
          settled
            ? {
                paidAmount,
                payoutStatus,
                paidAt: now,
                ...(correctInternalFailure
                  ? { actionCode: null, actionReason: null }
                  : {}),
              }
            : amountMatches
              ? { paidAmount, payoutStatus }
              : {
                  paidAmount,
                  payoutStatus,
                  reviewRequired: true,
                  actionCode: 'AMOUNT_MISMATCH',
                },
        );
        // 실제액 불일치는 운영자가 부족액·초과액을 처리해야 하므로 알린다(FR-027)
        if (!amountMatches) {
          await this.notifyOperator(
            tx,
            storedPaymentCancel,
            'AMOUNT_MISMATCH',
            actionLogs,
          );
        }
        return {
          applied: true,
          attemptStatus: PaymentCancelStatus.SUCCEEDED,
          payoutStatus,
        };
      })
      .catch((error: unknown) => {
        if (
          error instanceof PaymentCancelResultTargetMissingError &&
          cancelResultUpdate.source !== 'CALLBACK'
        ) {
          this.logger.error({
            message: error.message,
            paymentCancelId: error.paymentCancelId,
            operation: 'applyPgResult',
            source: cancelResultUpdate.source,
            pgCancelResult: cancelResultUpdate.pgCancelResult,
          });
        }
        rethrowCancelTransactionConflict(error);
      });
    for (const log of actionLogs) this.txLogger.logTransaction(log);
    return result;
  }

  /**
   * 이미 실패가 확정된 PG 취소 요청의 재조회 결과가 그 실패와 모순될 때 기록한다(개별 확인, API 계약 §8)
   * - 확정 결과를 덮어쓰지 않고 PG_RESULT_CONFLICT·검토 필요·운영자 알림으로 남겨 추가 지급을 막는다
   * @param tx 호출자의 결과 반영 트랜잭션(Refund 잠금 뒤)
   * @param paymentCancelId 실패가 확정된 PG 취소 요청
   * @param received 모순되는 재조회 결과(취소 성공·처리 중 등)
   * @returns 커밋 뒤 기록할 거래 로그
   */
  async recordFailedAttemptConflict(
    tx: TransactionClient,
    paymentCancelId: string,
    received: PgCancelQueryResult,
  ): Promise<TransactionLog[]> {
    const storedPaymentCancel =
      (await this.refundRepository.findPaymentCancelForResult(
        paymentCancelId,
        tx,
      ))!;
    const actionLogs: TransactionLog[] = [];
    await this.recordResultConflict(
      tx,
      storedPaymentCancel,
      received,
      actionLogs,
    );
    return actionLogs;
  }

  /**
   * 커밋된 사건의 거래 로그를 남긴다
   * @param logs 거래 로그
   */
  writeActionLogs(logs: TransactionLog[]): void {
    for (const log of logs) this.txLogger.logTransaction(log);
  }

  /**
   * 연속 조회 오류가 한도에 도달한 PG 취소 요청을 결과 확인 실패로 바꾸고 운영자에게 알린다 (FR-025)
   * - 지급 결과를 단정하지 않는다(환불은 지급 처리 중 그대로, 이용 종료 유지)
   * @param paymentCancelId PG 취소 요청
   * @param claimToken 조회를 맡은 담당 토큰(바뀌었으면 아무것도 하지 않는다)
   * @param failure 연속 오류 횟수·마지막 오류·시각
   */
  async recordQueryFailed(
    paymentCancelId: string,
    claimToken: string,
    failure: { inquiryFailureCount: number; reason: string; now: Date },
  ): Promise<void> {
    const actionLogs: TransactionLog[] = [];
    await this.refundRepository.runInTransaction(async (tx) => {
      const found = await this.refundRepository.findPaymentCancelForResult(
        paymentCancelId,
        tx,
      );
      if (!found) return;
      await this.lockingRepository.lockForPayout(tx, {
        refundId: found.refund.id,
        paymentCancelIds: [found.id],
        manualRefundPayoutIds: [],
      });
      const storedPaymentCancel =
        (await this.refundRepository.findPaymentCancelForResult(
          paymentCancelId,
          tx,
        ))!;
      if (storedPaymentCancel.claimToken !== claimToken) return;
      await this.refundRepository.markQueryFailed(tx, storedPaymentCancel.id, {
        inquiryFailureCount: failure.inquiryFailureCount,
        lastInquiryError: failure.reason,
        now: failure.now,
      });
      await this.notifyOperator(
        tx,
        storedPaymentCancel,
        'QUERY_FAILED',
        actionLogs,
      );
    });
    for (const log of actionLogs) this.txLogger.logTransaction(log);
  }

  /**
   * PG 취소 결과 콜백을 받아 대상에 맞는 처리로 보낸다 (API 계약 §7 POST /refund/callback)
   * - 환불 기록에 연결된 PG 취소 요청은 환불금 지급 결과 공통 처리로 반영한다
   * @param callback 콜백 본문
   * @throws PgCallbackTargetNotFoundError 환불에 연결된 PG 취소 요청을 찾을 수 없는 경우
   * @throws RefundStorageUnavailableError 결과 저장이 실패한 경우(503)
   */
  async receiveCallback(callback: RefundCallbackInput): Promise<void> {
    try {
      await this.applyCallback(callback);
    } catch (error) {
      // 대상 오류(404·409 등 도메인 오류)는 그대로, 그 밖의 저장 실패는 PG가 다시 보내도록 503으로 바꾼다(API 계약 §7)
      if (isDomainError(error)) throw error;
      throw new RefundStorageUnavailableError(error);
    }
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
    try {
      return await this.applyPgResult({
        source: 'CALLBACK',
        paymentCancelId: callback.paymentCancelId,
        pgCancelResult: outcome,
      });
    } catch (error) {
      if (error instanceof PaymentCancelResultTargetMissingError) {
        throw new PgCallbackTargetNotFoundError();
      }
      throw error;
    }
  }

  /**
   * PG 취소 요청 사건 알림의 공통 내용을 만든다
   * - eventKey는 사건 종류와 PG 취소 요청으로 정해 같은 사건은 한 번만 저장된다
   * @param storedPaymentCancel 사건이 생긴 PG 취소 요청과 그 환불
   * @param kind 알림 종류
   * @returns 수신 대상을 뺀 알림 내용
   */
  private notificationBase(
    storedPaymentCancel: PaymentCancelForResult,
    kind: string,
  ) {
    return {
      refundId: storedPaymentCancel.refund.id,
      paymentCancelId: storedPaymentCancel.id,
      kind,
      shopId: storedPaymentCancel.refund.shopId,
      eventKey: `${kind}:${storedPaymentCancel.id}`,
    };
  }

  /**
   * 운영자 알림을 저장하고 커밋 뒤 남길 거래 로그를 모은다 (FR-037)
   * @param tx 지급 결과 반영 트랜잭션
   * @param storedPaymentCancel 사건이 생긴 PG 취소 요청과 그 환불
   * @param kind 알림 종류(조치 사유 코드)
   * @param actionLogs 커밋 뒤 기록할 거래 로그
   * @param logDetail 거래 로그에 더 남길 대사 근거(선택)
   */
  private async notifyOperator(
    tx: TransactionClient,
    storedPaymentCancel: PaymentCancelForResult,
    kind: string,
    actionLogs: TransactionLog[],
    logDetail: Record<string, unknown> = {},
  ): Promise<void> {
    await this.eventRepository.recordNotification(tx, {
      ...this.notificationBase(storedPaymentCancel, kind),
      audience: RefundNotificationAudience.OPERATOR,
    });
    actionLogs.push({
      transactionId: `REFUND-${storedPaymentCancel.refund.id}-${storedPaymentCancel.id}`,
      type: 'REFUND',
      userId: storedPaymentCancel.refund.customerId,
      orderId: storedPaymentCancel.refund.orderId,
      orderItemId: storedPaymentCancel.refund.orderItemId ?? undefined,
      status: kind,
      metadata: {
        refundId: storedPaymentCancel.refund.id,
        paymentCancelId: storedPaymentCancel.id,
        ...logDetail,
      },
    });
  }

  /**
   * 미지급 조치 필요 사건을 수신 대상별 알림으로 저장한다 (FR-037)
   * - 운영자에게 알리고, 고객 환불이면 고객 본인과 점주에게도 알린다
   * @param tx 지급 결과 반영 트랜잭션
   * @param storedPaymentCancel 사건이 생긴 PG 취소 요청과 그 환불
   * @param kind 알림 종류(조치 사유 코드)
   * @param actionLogs 커밋 뒤 기록할 거래 로그
   */
  private async notifyPayoutAction(
    tx: TransactionClient,
    storedPaymentCancel: PaymentCancelForResult,
    kind: string,
    actionLogs: TransactionLog[],
  ): Promise<void> {
    await this.notifyOperator(tx, storedPaymentCancel, kind, actionLogs);
    // 시스템 자동 취소는 운영자만 처리한다(API 계약 §9 수신자 표)
    if (storedPaymentCancel.refund.source === RefundSource.SYSTEM) return;
    await this.eventRepository.recordNotification(tx, {
      ...this.notificationBase(storedPaymentCancel, kind),
      audience: RefundNotificationAudience.SHOP,
    });
    // 고객 본인에게는 고객 환불일 때만 알린다(매장 환불은 점주가 처리한 건)
    if (storedPaymentCancel.refund.source !== RefundSource.CUSTOMER) return;
    await this.eventRepository.recordNotification(tx, {
      ...this.notificationBase(storedPaymentCancel, kind),
      audience: RefundNotificationAudience.CUSTOMER,
      recipientUserId: storedPaymentCancel.refund.customerId,
    });
  }

  /**
   * 확정된 시도와 모순되는 PG 결과를 조치·검토 필요와 운영자 알림으로 기록한다
   * - 지급 완료(PAID)였어도 검토가 끝날 때까지 조치 필요로 둔다(PAID는 검토 완료일 때만, data-model §2)
   * - 지급 합계·원장·시도 상태는 바꾸지 않는다
   * @param tx 지급 결과 반영 트랜잭션
   * @param storedPaymentCancel 이미 확정된 PG 취소 요청과 그 환불
   * @param outcome 새로 온 모순 결과
   * @param actionLogs 커밋 뒤 기록할 거래 로그
   */
  private async recordResultConflict(
    tx: TransactionClient,
    storedPaymentCancel: PaymentCancelForResult,
    outcome: PgCancelOutcome | PgCancelQueryResult,
    actionLogs: TransactionLog[],
  ): Promise<void> {
    await this.refundRepository.updateRefundPayout(
      tx,
      storedPaymentCancel.refund.id,
      {
        payoutStatus: RefundPayoutStatus.ACTION_REQUIRED,
        paidAt: null,
        reviewRequired: true,
        actionCode: 'PG_RESULT_CONFLICT',
      },
    );
    // 운영자가 PG와 대사할 수 있도록 기존 확정 결과와 새 통보를 함께 남긴다
    await this.notifyOperator(
      tx,
      storedPaymentCancel,
      'PG_RESULT_CONFLICT',
      actionLogs,
      {
        stored: {
          kind: storedPaymentCancel.status,
          actualAmount: storedPaymentCancel.actualAmount,
          pgTransactionId: storedPaymentCancel.pgTransactionId,
        },
        received: outcome,
      },
    );
  }
}
