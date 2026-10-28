import { Injectable } from '@nestjs/common';
import { ManualRefundPayoutStatus, Prisma } from '@prisma/client';
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
import {
  evaluateManualReservation,
  ManualReservationRejection,
} from './refund-manual-payout.policy';
import {
  IdempotencyKeyRequiredError,
  ManualPayoutEvidenceRequiredError,
  ManualPayoutNotFoundError,
  ManualPayoutReferenceReusedError,
  ManualPayoutStateConflictError,
  RefundNotFoundError,
  RefundOutstandingAmountMismatchError,
  RefundPayoutNotActionableError,
  RefundPayoutUnresolvedError,
} from './errors';

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
          const settled = paidAmount === refund.amount;
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
