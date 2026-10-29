import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ManualRefundPayoutStatus,
  Prisma,
  RefundNotificationAudience,
} from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';
import { RefundAccessService, RefundActor } from './refund-access.service';
import {
  IdempotentResult,
  RefundIdempotencyService,
} from './refund-idempotency.service';
import { RefundLockingRepository } from './refund-locking.repository';
import { RefundRepository } from './refund.repository';
import { RefundOperationsRepository } from './refund-operations.repository';
import { RefundLedgerRepository } from 'src/ledger/refund-ledger.repository';
import { RefundEventRepository } from './refund-event.repository';
import { TransactionLoggerService } from 'src/logger/transaction-logger.service';
import { hasUnresolvedPayout } from './refund-retry.policy';
import {
  evaluateManualReservation,
  ManualReservationRejection,
} from './refund-manual-payout.policy';
import {
  IdempotencyKeyRequiredError,
  ManualPayoutEvidenceRequiredError,
  RefundAmountReviewIncompleteError,
  ManualPayoutNotFoundError,
  ManualPayoutReferenceReusedError,
  ManualPayoutStateConflictError,
  RefundNotFoundError,
  RefundOutstandingAmountMismatchError,
  RefundPayoutNotActionableError,
  RefundPayoutUnresolvedError,
} from './errors';

/** 별도 지급 장기 미확인 알림 종류(API 계약 §10 actionCode와 같은 이름) */
const manualConfirmationAlertKind = 'MANUAL_CONFIRMATION_REQUIRED';

/** 별도 환불금 지급 예약 요청 */
export type ManualReservationCommand = {
  amount: number; // 예약 금액(현재 미지급액과 같아야 한다)
  reason: string; // DTO에서 앞뒤 공백을 지운 사유
  idempotencyKey?: string;
};

/** 별도 환불금 지급 예약 응답 (API 계약 §5) */
export type ManualReservationResponse = {
  refundId: string;
  payoutId: string;
  status: 'RESERVED';
  amount: number;
};

/** 별도 환불금 지급 결과 등록 요청 */
export type ManualConfirmCommand = {
  amount: number; // 실제 지급액(예약과 같아야 한다)
  paidAt: Date; // 실제 지급 시각(미래 불가, DTO에서 검증)
  externalTransactionId: string; // 실제 지급 거래 식별자(전역 고유)
  evidenceReference?: string; // 지급 증빙 참조(없으면 MANUAL_PAYOUT_EVIDENCE_REQUIRED)
  idempotencyKey?: string;
};

/** 별도 환불금 지급 결과 등록 응답 */
export type ManualConfirmResponse = {
  refundId: string;
  payoutId: string;
  status: 'SUCCEEDED';
  amount: number;
  payoutStatus: string; // 등록 뒤 환불의 지급 상태
};

/** 별도 환불금 미지급 확인 요청 */
export type ManualNotPaidCommand = {
  reason: string; // DTO에서 앞뒤 공백을 지운 사유
  evidenceReference?: string; // 확실한 미지급 근거(없으면 MANUAL_PAYOUT_EVIDENCE_REQUIRED)
  idempotencyKey?: string;
};

/** 별도 환불금 미지급 확인 응답 */
export type ManualNotPaidResponse = {
  refundId: string;
  payoutId: string;
  status: 'FAILED';
  payoutStatus: string; // 종료 뒤 환불의 지급 상태(조치 필요)
};

/** 초과 취소 검토 결과 등록 요청 */
export type AmountReviewCommand = {
  reason: string; // DTO에서 앞뒤 공백을 지운 검토 사유
  evidenceReference?: string; // 확인 근거(없으면 MANUAL_PAYOUT_EVIDENCE_REQUIRED)
  idempotencyKey?: string;
};

/** 초과 취소 검토 결과 등록 응답 */
export type AmountReviewResponse = {
  refundId: string;
  payoutStatus: 'PAID';
};

/**
 * 미지급 환불금의 운영 처리 서비스 (API 계약 §5, MANAGER 전용)
 * - 별도 환불금 지급 예약·지급 결과 등록·미지급 확인·초과 취소 검토
 * - 모든 변경은 멱등 키가 필수이고, Refund를 잠근 뒤 지급 상태를 다시 확인한다
 */
@Injectable()
export class RefundOperationsService {
  constructor(
    private readonly accessService: RefundAccessService,
    private readonly idempotencyService: RefundIdempotencyService,
    private readonly lockingRepository: RefundLockingRepository,
    private readonly refundRepository: RefundRepository,
    private readonly operationsRepository: RefundOperationsRepository,
    private readonly ledgerRepository: RefundLedgerRepository,
    private readonly eventRepository: RefundEventRepository,
    private readonly configService: ConfigService,
    private readonly txLogger: TransactionLoggerService,
  ) {}

  /**
   * 별도 환불금 지급을 예약한다(실제 송금은 하지 않는다)
   * @param actor 요청한 운영자
   * @param refundId 환불
   * @param command 금액·사유·멱등 키
   * @returns 201 예약 응답(같은 키·같은 내용이면 최초 응답)
   * @throws RefundForbiddenError MANAGER가 아닐 때(403)
   * @throws IdempotencyKeyRequiredError 멱등 키가 없을 때(400)
   * @throws RefundNotFoundError 없는 환불(404)
   */
  async reserveManualPayout(
    actor: RefundActor,
    refundId: string,
    command: ManualReservationCommand,
  ): Promise<IdempotentResult<ManualReservationResponse>> {
    const idempotencyKey = await this.assertOperationRequest(
      actor,
      refundId,
      command.idempotencyKey,
    );
    return this.idempotencyService.execute<ManualReservationResponse>(
      {
        requesterId: actor.userId,
        operation: 'MANUAL_PAYOUT_RESERVE',
        key: idempotencyKey,
        request: { refundId, amount: command.amount, reason: command.reason },
        authorize: () => Promise.resolve(),
      },
      async (tx) => {
        const now = new Date();
        // Refund 잠금 뒤 다시 읽은 지급 상태로 판정한다(PG 재시도·다른 예약과의 교차 지급 차단)
        const target = await this.lockPayoutTarget(tx, refundId);
        const decision = evaluateManualReservation(
          target.state,
          command.amount,
          now,
        );
        if (!decision.allowed) throw reservationRejectionError(decision.code);
        const payoutId = await this.operationsRepository.createReservation(tx, {
          refundId,
          amount: decision.outstandingAmount,
          reservedById: actor.userId,
          reason: command.reason,
          now,
        });
        return {
          status: 201,
          refundId,
          body: {
            refundId,
            payoutId,
            status: 'RESERVED',
            amount: decision.outstandingAmount,
          },
        };
      },
    );
  }

  /**
   * 별도 환불금 지급의 실제 지급 결과를 등록한다
   * @param actor 요청한 운영자
   * @param refundId 환불
   * @param payoutId 예약
   * @param command 금액·지급 시각·거래 식별자·증빙·멱등 키
   * @returns 200 등록 응답
   */
  async confirmManualPayout(
    actor: RefundActor,
    refundId: string,
    payoutId: string,
    command: ManualConfirmCommand,
  ): Promise<IdempotentResult<ManualConfirmResponse>> {
    const idempotencyKey = await this.assertOperationRequest(
      actor,
      refundId,
      command.idempotencyKey,
    );
    // 실제 지급 사실을 확인할 증빙이 있어야 결과를 등록한다
    const evidenceReference = command.evidenceReference?.trim();
    if (!evidenceReference) throw new ManualPayoutEvidenceRequiredError();
    return this.idempotencyService
      .execute<ManualConfirmResponse>(
        {
          requesterId: actor.userId,
          operation: 'MANUAL_PAYOUT_CONFIRM',
          key: idempotencyKey,
          request: {
            refundId,
            payoutId,
            amount: command.amount,
            paidAt: command.paidAt.toISOString(),
            externalTransactionId: command.externalTransactionId,
            evidenceReference,
          },
          authorize: () => Promise.resolve(),
        },
        async (tx) => {
          const now = new Date();
          await this.lockPayoutTarget(tx, refundId);
          const payout = await this.operationsRepository.findPayout(
            tx,
            refundId,
            payoutId,
          );
          if (!payout) throw new ManualPayoutNotFoundError();
          // 같은 지급 결과의 반복 등록은 저장된 결과를 돌려주고 지급액·원장을 더하지 않는다
          if (
            payout.status === ManualRefundPayoutStatus.SUCCEEDED &&
            payout.externalTransactionId === command.externalTransactionId &&
            payout.amount === command.amount
          ) {
            const stored = await this.operationsRepository.findRefundForPayout(
              tx,
              refundId,
            );
            return {
              status: 200,
              refundId,
              body: {
                refundId,
                payoutId,
                status: 'SUCCEEDED',
                amount: payout.amount,
                payoutStatus: stored.payoutStatus,
              },
            };
          }
          // 실패로 끝났거나 다른 결과로 확정된 예약은 바꾸지 않는다
          if (payout.status !== ManualRefundPayoutStatus.RESERVED) {
            throw new ManualPayoutStateConflictError();
          }
          // 실제 지급액은 예약 금액과 같아야 한다
          if (command.amount !== payout.amount) {
            throw new RefundOutstandingAmountMismatchError();
          }
          // 거래 식별자는 전역에서 한 지급에만 쓴다(동시 등록은 DB unique가 막는다)
          if (
            await this.operationsRepository.isExternalTransactionUsedByOther(
              tx,
              command.externalTransactionId,
              payoutId,
            )
          ) {
            throw new ManualPayoutReferenceReusedError();
          }
          // 예약 성공 확정·지급 합계·원장을 같은 트랜잭션에서 저장한다
          await this.operationsRepository.markPayoutSucceeded(tx, payoutId, {
            confirmedById: actor.userId,
            now,
            paidAt: command.paidAt,
            externalTransactionId: command.externalTransactionId,
            evidenceReference,
          });
          const refund = await this.operationsRepository.findRefundForPayout(
            tx,
            refundId,
          );
          await this.ledgerRepository.recordPayout(tx, {
            shopId: refund.shopId,
            orderId: refund.orderId,
            refundId,
            paidAmount: payout.amount,
            manualRefundPayoutId: payoutId,
          });
          const paidAmount = refund.paidAmount + payout.amount;
          // PG 결과 모순은 이 지급과 별개로 운영자 확인이 남아 있으므로 지급 완료·검토 완료로 바꾸지 않는다
          const settled =
            paidAmount === refund.amount &&
            refund.actionCode !== 'PG_RESULT_CONFLICT';
          // 부족액 지급으로 미지급액이 0이 되면 이 증빙으로 부족 지급 검토도 함께 마친다(API 계약 §5 confirm)
          await this.operationsRepository.applyManualPaid(tx, refundId, {
            paidAmount,
            settled,
            now,
            review: refund.reviewRequired
              ? { reviewedById: actor.userId, evidenceReference }
              : undefined,
          });
          return {
            status: 200,
            refundId,
            body: {
              refundId,
              payoutId,
              status: 'SUCCEEDED',
              amount: payout.amount,
              payoutStatus: settled ? 'PAID' : 'ACTION_REQUIRED',
            },
          };
        },
      )
      .catch(rethrowReferenceReused);
  }

  /**
   * 예약한 별도 환불금 지급을 실제로 지급하지 않았다고 확인해 실패로 종료한다
   * @param actor 요청한 운영자
   * @param refundId 환불
   * @param payoutId 예약
   * @param command 사유·근거·멱등 키
   * @returns 200 종료 응답
   */
  async markManualPayoutNotPaid(
    actor: RefundActor,
    refundId: string,
    payoutId: string,
    command: ManualNotPaidCommand,
  ): Promise<IdempotentResult<ManualNotPaidResponse>> {
    const idempotencyKey = await this.assertOperationRequest(
      actor,
      refundId,
      command.idempotencyKey,
    );
    // 지급하지 않았다는 확실한 근거가 있어야 예약을 종료한다(지급 여부를 모르면 종료하지 않는다)
    const evidenceReference = command.evidenceReference?.trim();
    if (!evidenceReference) throw new ManualPayoutEvidenceRequiredError();
    return this.idempotencyService.execute<ManualNotPaidResponse>(
      {
        requesterId: actor.userId,
        operation: 'MANUAL_PAYOUT_NOT_PAID',
        key: idempotencyKey,
        request: {
          refundId,
          payoutId,
          reason: command.reason,
          evidenceReference,
        },
        authorize: () => Promise.resolve(),
      },
      async (tx) => {
        const now = new Date();
        await this.lockPayoutTarget(tx, refundId);
        const payout = await this.operationsRepository.findPayout(
          tx,
          refundId,
          payoutId,
        );
        if (!payout) throw new ManualPayoutNotFoundError();
        // 이미 지급 성공·실패로 끝난 예약은 바꾸지 않는다
        if (payout.status !== ManualRefundPayoutStatus.RESERVED) {
          throw new ManualPayoutStateConflictError();
        }
        // 예약만 실패로 종료한다. 환불은 조치 필요·MANUAL 그대로이고 PG 재개는 운영자 직접 재시도로만 한다
        await this.operationsRepository.markPayoutNotPaid(tx, payoutId, {
          confirmedById: actor.userId,
          now,
          reason: command.reason,
          evidenceReference,
        });
        return {
          status: 200,
          refundId,
          body: {
            refundId,
            payoutId,
            status: 'FAILED',
            payoutStatus: 'ACTION_REQUIRED',
          },
        };
      },
    );
  }

  /**
   * PG가 확정된 환불 금액보다 많이 취소한 환불의 검토 결과를 등록한다
   * @param actor 요청한 운영자
   * @param refundId 환불
   * @param command 사유·근거·멱등 키
   * @returns 200 등록 응답
   */
  async reviewRefundAmount(
    actor: RefundActor,
    refundId: string,
    command: AmountReviewCommand,
  ): Promise<IdempotentResult<AmountReviewResponse>> {
    const idempotencyKey = await this.assertOperationRequest(
      actor,
      refundId,
      command.idempotencyKey,
    );
    const evidenceReference = command.evidenceReference?.trim();
    if (!evidenceReference) throw new ManualPayoutEvidenceRequiredError();
    return this.idempotencyService.execute<AmountReviewResponse>(
      {
        requesterId: actor.userId,
        operation: 'REFUND_AMOUNT_REVIEW',
        key: idempotencyKey,
        request: { refundId, reason: command.reason, evidenceReference },
        authorize: () => Promise.resolve(),
      },
      async (tx) => {
        const now = new Date();
        const target = await this.lockPayoutTarget(tx, refundId);
        // 확인되지 않은 지급이 있으면 검토를 마치지 않는다
        if (hasUnresolvedPayout(target.state, now)) {
          throw new RefundPayoutUnresolvedError();
        }
        // 초과 취소로 검토가 필요하고 미지급액이 없을 때만 마친다(부족액은 별도 지급 경로)
        const refund = await this.operationsRepository.findRefundForPayout(
          tx,
          refundId,
        );
        if (!refund.reviewRequired || refund.paidAmount < refund.amount) {
          throw new RefundAmountReviewIncompleteError();
        }
        await this.operationsRepository.completeAmountReview(tx, refundId, {
          reviewedById: actor.userId,
          now,
          reason: command.reason,
          evidenceReference,
        });
        return {
          status: 200,
          refundId,
          body: { refundId, payoutStatus: 'PAID' },
        };
      },
    );
  }

  /**
   * 예약 뒤 확인 기준 시간이 지나도 결과가 없는 별도 지급마다 운영자 미확인 알림을 한 번 남긴다
   * @param now 탐색 시각
   */
  async alertUnconfirmedManualPayouts(now: Date): Promise<void> {
    const alertSeconds = this.configService.get<number>(
      'refund.manualConfirmAlertSeconds',
    )!;
    const reservations =
      await this.operationsRepository.findUnalertedReservations(
        new Date(now.getTime() - alertSeconds * 1000),
        this.configService.get<number>('refund.recoveryBatchSize')!,
        manualConfirmationAlertKind,
      );
    // 예약은 그대로 두고(시간 초과만으로 풀지 않는다) 예약 ID 기반 사건 키로 한 번만 알린다
    for (const reservation of reservations) {
      const alerted = await this.refundRepository.runInTransaction(
        async (tx) => {
          // 탐색 뒤 지급 결과가 등록됐을 수 있으므로 Refund → 예약 순서로 잠근 뒤 아직 예약 중인지 다시 확인한다
          await this.lockingRepository.lockForPayout(tx, {
            refundId: reservation.refundId,
            paymentCancelIds: [],
            manualRefundPayoutIds: [reservation.payoutId],
          });
          const status = await this.operationsRepository.findPayoutStatus(
            tx,
            reservation.payoutId,
          );
          if (status !== ManualRefundPayoutStatus.RESERVED) return false;
          return this.eventRepository.recordNotification(tx, {
            refundId: reservation.refundId,
            manualRefundPayoutId: reservation.payoutId,
            kind: manualConfirmationAlertKind,
            audience: RefundNotificationAudience.OPERATOR,
            shopId: reservation.shopId,
            eventKey: `${manualConfirmationAlertKind}:${reservation.payoutId}`,
          });
        },
      );
      // 새 알림이 커밋된 경우에만 거래 로그를 남긴다(FR-037)
      if (!alerted) continue;
      this.txLogger.logTransaction({
        transactionId: `REFUND-${reservation.refundId}-${reservation.payoutId}`,
        type: 'REFUND',
        userId: reservation.customerId,
        orderId: reservation.orderId,
        status: manualConfirmationAlertKind,
        metadata: {
          refundId: reservation.refundId,
          payoutId: reservation.payoutId,
          reservedAt: reservation.reservedAt.toISOString(),
        },
      });
    }
  }

  /**
   * 운영 변경 요청의 공통 사전 확인(역할 → 멱등 키 → 환불 존재)
   * @param actor 요청자
   * @param refundId 환불
   * @param idempotencyKey 멱등 키
   * @returns 확인한 멱등 키
   */
  private async assertOperationRequest(
    actor: RefundActor,
    refundId: string,
    idempotencyKey: string | undefined,
  ): Promise<string> {
    this.accessService.assertOperator(actor);
    if (idempotencyKey === undefined) throw new IdempotencyKeyRequiredError();
    if (!(await this.refundRepository.findPayoutRetryTarget(refundId))) {
      throw new RefundNotFoundError();
    }
    return idempotencyKey;
  }

  /**
   * Refund → PG 취소 요청 → 별도 지급 순서로 잠근 뒤 지급 상태를 다시 읽는다
   * @param tx 트랜잭션
   * @param refundId 환불
   * @returns 잠근 뒤 읽은 지급 상태
   */
  private async lockPayoutTarget(tx: TransactionClient, refundId: string) {
    const unlocked = (await this.refundRepository.findPayoutRetryTarget(
      refundId,
      tx,
    ))!;
    await this.lockingRepository.lockForPayout(tx, {
      refundId,
      paymentCancelIds: unlocked.paymentCancelIds,
      manualRefundPayoutIds: unlocked.manualRefundPayoutIds,
    });
    return (await this.refundRepository.findPayoutRetryTarget(refundId, tx))!;
  }
}

/**
 * 예약 판정 거절을 계약 오류로 바꾼다 (API 계약 §10)
 * @param code 거절 코드
 * @returns 도메인 오류
 */
function reservationRejectionError(code: ManualReservationRejection): Error {
  if (code === 'REFUND_PAYOUT_UNRESOLVED') {
    return new RefundPayoutUnresolvedError();
  }
  if (code === 'REFUND_OUTSTANDING_AMOUNT_MISMATCH') {
    return new RefundOutstandingAmountMismatchError();
  }
  return new RefundPayoutNotActionableError();
}

/**
 * 동시 등록 경쟁으로 거래 식별자 고유 제약에 걸리면 재사용 오류로 바꾼다
 * @param error 잡은 오류
 * @returns 없음(항상 던진다)
 * @throws ManualPayoutReferenceReusedError 거래 식별자 고유 위반일 때
 */
function rethrowReferenceReused(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    JSON.stringify(error.meta ?? {}).includes('external_transaction_id')
  ) {
    throw new ManualPayoutReferenceReusedError();
  }
  throw error;
}
