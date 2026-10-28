import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  REFUND_PG_GATEWAY,
  type RefundPgGateway,
} from 'src/pg/refund-pg.gateway';
import type { PgCancelQueryResult } from 'src/pg/pg.types';
import { TransactionClient } from 'src/prisma/prisma.service';
import { RefundAccessService, RefundActor } from './refund-access.service';
import {
  IdempotentResult,
  RefundIdempotencyService,
} from './refund-idempotency.service';
import { RefundLockingRepository } from './refund-locking.repository';
import { RefundRepository } from './refund.repository';
import { RefundDispatchService } from './refund-dispatch.service';
import { RefundResultService } from './refund-result.service';
import type { TransactionLog } from 'src/logger/transaction-logger.service';
import { PendingSend } from './refund-acceptance.service';
import {
  evaluatePayoutRetry,
  PayoutRetryRejection,
} from './refund-retry.policy';
import {
  IdempotencyKeyRequiredError,
  RefundNotFoundError,
  RefundPartialPayoutRequiresManualError,
  RefundPayoutNotActionableError,
  RefundPayoutUnresolvedError,
} from './errors';

/** MANAGER의 PG 직접 재시도 요청 */
export type PayoutRetryCommand = {
  reason: string; // DTO에서 앞뒤 공백을 지운 사유
  idempotencyKey?: string;
};

/** PG 재시도 접수 응답(API 계약 §5, 접수 당시 정보) */
export type PayoutRetryAcceptance = {
  refundId: string;
  paymentCancelId: string;
  payoutStatus: 'PENDING';
};

/**
 * 확정된 환불의 PG 취소 재요청 서비스 (API 계약 §5)
 * - Refund를 잠근 뒤 지급 상태를 다시 확인하고, 이전 실패 기록을 보존한 채 같은 금액의 새 PG 취소 요청을 만든다
 * - 새 요청은 커밋 뒤 바로 보낸다. 최초 응답은 접수 당시 정보(PENDING)다
 */
@Injectable()
export class RefundRetryService {
  constructor(
    private readonly accessService: RefundAccessService,
    private readonly idempotencyService: RefundIdempotencyService,
    private readonly lockingRepository: RefundLockingRepository,
    private readonly refundRepository: RefundRepository,
    private readonly dispatchService: RefundDispatchService,
    private readonly configService: ConfigService,
    private readonly resultService: RefundResultService,
    @Inject(REFUND_PG_GATEWAY) private readonly pgGateway: RefundPgGateway,
  ) {}

  /**
   * MANAGER의 PG 직접 재시도
   * @param actor 요청한 운영자
   * @param refundId 재시도할 환불
   * @param command 사유·멱등 키
   * @returns 202 접수 응답(같은 키·같은 내용이면 최초 응답)
   * @throws RefundForbiddenError MANAGER가 아닐 때(403)
   * @throws IdempotencyKeyRequiredError 멱등 키가 없을 때(400)
   * @throws RefundNotFoundError 없는 환불(404)
   */
  async retryByManager(
    actor: RefundActor,
    refundId: string,
    command: PayoutRetryCommand,
  ): Promise<IdempotentResult<PayoutRetryAcceptance>> {
    // 1. 역할 확인: 고객·점주는 상태와 관계없이 403
    this.accessService.assertOperator(actor);
    // 운영 변경은 멱등 키가 필수다
    if (command.idempotencyKey === undefined) {
      throw new IdempotencyKeyRequiredError();
    }
    // 없는 환불은 404
    if (!(await this.refundRepository.findPayoutRetryTarget(refundId))) {
      throw new RefundNotFoundError();
    }

    // 2. 같은 키·같은 내용이면 최초 응답을 돌려주고, 새 요청만 3·4단계로 상태를 검사한다
    let pending: PendingSend | undefined;
    const result = await this.idempotencyService.execute<PayoutRetryAcceptance>(
      {
        requesterId: actor.userId,
        operation: 'PAYOUT_RETRY',
        key: command.idempotencyKey,
        request: { refundId, reason: command.reason },
        authorize: () => Promise.resolve(),
      },
      async (tx) => {
        const now = new Date();
        // 3. Refund → PG 취소 요청 → 별도 지급 순서로 잠근 뒤 다시 읽어 판정한다
        const unlocked = (await this.refundRepository.findPayoutRetryTarget(
          refundId,
          tx,
        ))!;
        await this.lockingRepository.lockForPayout(tx, {
          refundId,
          paymentCancelIds: unlocked.paymentCancelIds,
          manualRefundPayoutIds: unlocked.manualRefundPayoutIds,
        });
        const target = (await this.refundRepository.findPayoutRetryTarget(
          refundId,
          tx,
        ))!;
        const decision = evaluatePayoutRetry(target.state, now);
        if (!decision.allowed) throw retryRejectionError(decision.code);
        if (target.orderItemId === null) {
          throw new RefundPayoutNotActionableError();
        }

        // 4. 이전 실패를 보존한 채 같은 금액의 새 요청과 커밋 뒤 전송 기록을 저장한다
        const sendClaim = this.dispatchService.newSendClaim(now);
        const paymentCancelId = await this.refundRepository.createRetryAttempt(
          tx,
          {
            refundId,
            paymentId: target.paymentId,
            orderItemId: target.orderItemId,
            attemptNumber: target.nextAttemptNumber,
            amount: target.state.amount,
            requestedById: actor.userId,
            retryReason: command.reason,
            now,
            sendClaim,
          },
        );
        pending = {
          paymentCancelId,
          amount: target.state.amount,
          claimToken: sendClaim.claimToken,
          sentAt: now,
        };
        return {
          status: 202,
          refundId,
          body: { refundId, paymentCancelId, payoutStatus: 'PENDING' },
        };
      },
    );

    // 이번 요청이 만든 새 요청만 커밋 뒤 보낸다(최초 응답 반환·거절은 PG를 호출하지 않는다)
    if (pending) await this.dispatchService.sendPrepared(pending);
    return result;
  }

  /**
   * 최근 시도가 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED로 이미 실패한 환불을 개별 확인한다 (API 계약 §8, FR-057)
   * - 그 실패 시도를 맡아 PG에 다시 조회하고, 미접수가 확인되면 이전 실패를 보존한 채 같은 금액의 새 요청을 바로 보낸다
   * @param refundId 확인할 환불
   * @param now 요청 시각
   * @param actorId 실행자(새 요청의 requestedById)
   * @returns 확인 결과
   */
  async checkFailedAttempt(
    refundId: string,
    now: Date,
    actorId: string,
  ): Promise<FailedCheckOutcome> {
    const candidate =
      await this.refundRepository.findFailedRetryCandidate(refundId);
    if (!candidate) return { kind: 'NOT_ELIGIBLE' };

    // 1. Refund를 잠근 뒤 대상·담당·최근 조회 간격·재시도 조건을 다시 확인하고 실패 시도의 조회 담당을 맡는다
    const claimToken = randomUUID();
    const claimed = await this.refundRepository.runInTransaction(async (tx) => {
      const target = await this.lockRetryTarget(tx, refundId);
      const failed = await this.refundRepository.findFailedRetryCandidate(
        refundId,
        tx,
      );
      if (!target || failed?.id !== candidate.id) {
        return { kind: 'NOT_ELIGIBLE' } as const;
      }
      if (failed.claimUntil && failed.claimUntil > now) {
        return { kind: 'RUNNING' } as const;
      }
      if (
        failed.lastInquiryAt &&
        now.getTime() - failed.lastInquiryAt.getTime() <
          this.seconds('queryIntervalSeconds') * 1000
      ) {
        return { kind: 'RECENT' } as const;
      }
      if (!evaluatePayoutRetry(target.state, now).allowed) {
        return { kind: 'NOT_ELIGIBLE' } as const;
      }
      await this.refundRepository.markInquiryStarted(tx, failed.id, {
        claimToken,
        claimUntil: new Date(
          now.getTime() + this.seconds('workLeaseSeconds') * 1000,
        ),
        now,
      });
      return null;
    });
    if (claimed) return claimed;

    // 2. PG 조회는 트랜잭션 밖에서 한다
    const inquiry = await this.pgGateway.inquireCancel({
      paymentCancelId: candidate.id,
    });

    // 3. 결과 반영: 담당을 내려놓고 조건을 다시 확인한 뒤 미접수면 새 요청을 저장한다
    let pending: PendingSend | undefined;
    let conflictLogs: TransactionLog[] = [];
    await this.refundRepository.runInTransaction(async (tx) => {
      await this.lockRetryTarget(tx, refundId);
      if (
        !(await this.refundRepository.releaseAttemptClaim(
          tx,
          candidate.id,
          claimToken,
          // 조회 오류는 결과 확인 불가로 남기고, 정상 응답은 이전 오류를 지운다
          inquiry.result === 'QUERY_ERROR' ? inquiry.reason : null,
        ))
      ) {
        return;
      }
      // 취소 성공·처리 중은 기존 확정 실패와 모순된다. 새 요청 없이 모순·운영자 확인으로 남겨 추가 지급을 막는다
      if (inquiry.result === 'SUCCEEDED' || inquiry.result === 'IN_PROGRESS') {
        conflictLogs = await this.resultService.recordFailedAttemptConflict(
          tx,
          candidate.id,
          inquiry,
        );
        return;
      }
      // 미접수 또는 거절 확정(취소가 실행되지 않았고 앞으로도 진행되지 않음)일 때만 새 요청을 만든다
      if (inquiry.result !== 'NOT_FOUND' && inquiry.result !== 'FAILED') {
        return;
      }
      const target = (await this.refundRepository.findPayoutRetryTarget(
        refundId,
        tx,
      ))!;
      const failed = await this.refundRepository.findFailedRetryCandidate(
        refundId,
        tx,
      );
      if (
        failed?.id !== candidate.id ||
        target.orderItemId === null ||
        !evaluatePayoutRetry(target.state, now).allowed
      ) {
        return;
      }
      const sendClaim = this.dispatchService.newSendClaim(now);
      const paymentCancelId = await this.refundRepository.createRetryAttempt(
        tx,
        {
          refundId,
          paymentId: target.paymentId,
          orderItemId: target.orderItemId,
          attemptNumber: target.nextAttemptNumber,
          amount: target.state.amount,
          requestedById: actorId,
          retryReason:
            inquiry.result === 'NOT_FOUND'
              ? '개별 확인에서 PG 미접수 확인 후 재시도'
              : '개별 확인에서 PG 거절 확정 후 재시도',
          now,
          sendClaim,
          lastInquiryAt: failed.lastInquiryAt,
        },
      );
      pending = {
        paymentCancelId,
        amount: target.state.amount,
        claimToken: sendClaim.claimToken,
        sentAt: now,
      };
    });

    // 모순 기록의 거래 로그는 커밋 뒤에 남긴다
    this.resultService.writeActionLogs(conflictLogs);
    // 4. 새 요청은 커밋 뒤 바로 보낸다
    const sent = pending
      ? await this.dispatchService.sendPrepared(pending)
      : null;
    return {
      kind: 'CHECKED',
      inquiryResult: inquiry.result,
      resendResult: sent ? sent.sendResult : null,
    };
  }

  /**
   * Refund → PG 취소 요청 → 별도 지급 순서로 잠근 뒤 재시도 판정 대상을 다시 읽는다
   * @param tx 트랜잭션
   * @param refundId 환불 ID
   * @returns 잠근 뒤 읽은 대상, 없으면 null
   */
  private async lockRetryTarget(tx: TransactionClient, refundId: string) {
    const unlocked = await this.refundRepository.findPayoutRetryTarget(
      refundId,
      tx,
    );
    if (!unlocked) return null;
    await this.lockingRepository.lockForPayout(tx, {
      refundId,
      paymentCancelIds: unlocked.paymentCancelIds,
      manualRefundPayoutIds: unlocked.manualRefundPayoutIds,
    });
    return this.refundRepository.findPayoutRetryTarget(refundId, tx);
  }

  /**
   * 환불 처리 설정의 초 단위 값을 읽는다
   * @param key 설정 키
   * @returns 초
   */
  private seconds(key: 'queryIntervalSeconds' | 'workLeaseSeconds'): number {
    return this.configService.get<number>(`refund.${key}`)!;
  }
}

/** 실패 확정 시도의 개별 확인 결과 */
export type FailedCheckOutcome =
  | { kind: 'NOT_ELIGIBLE' } // 개별 확인으로 새 요청을 보낼 대상이 아님
  | { kind: 'RUNNING' } // 다른 작업이 그 시도를 맡고 있음
  | { kind: 'RECENT' } // 최근 조회 간격 안의 반복 실행
  | {
      kind: 'CHECKED';
      inquiryResult: PgCancelQueryResult['result'];
      resendResult: string | null; // 새 요청의 최초 전송 결과, 보내지 않았으면 null
    };

/**
 * 재시도 판정 거절을 계약 오류로 바꾼다 (API 계약 §10)
 * @param code 거절 코드
 * @returns 409 도메인 오류
 */
function retryRejectionError(code: PayoutRetryRejection): Error {
  if (code === 'REFUND_PAYOUT_UNRESOLVED') {
    return new RefundPayoutUnresolvedError();
  }
  if (code === 'REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL') {
    return new RefundPartialPayoutRequiresManualError();
  }
  return new RefundPayoutNotActionableError();
}
