import { Injectable } from '@nestjs/common';
import { RefundAccessService, RefundActor } from './refund-access.service';
import {
  IdempotentResult,
  RefundIdempotencyService,
} from './refund-idempotency.service';
import { RefundLockingRepository } from './refund-locking.repository';
import { RefundRepository } from './refund.repository';
import { RefundDispatchService } from './refund-dispatch.service';
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
}

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
