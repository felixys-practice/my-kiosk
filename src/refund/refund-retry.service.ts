import { PaymentCancelFailureCode, RefundPayoutStatus } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PgService } from 'src/pg/pg.service';
import type { PgCancelQueryResult } from 'src/pg/pg.types';
import { TransactionClient } from 'src/prisma/prisma.service';
import { RefundLockingRepository } from './refund-locking.repository';
import { RefundRepository } from './refund.repository';
import { RefundDispatchService } from './refund-dispatch.service';
import { RefundResultService } from './refund-result.service';
import type { TransactionLog } from 'src/logger/transaction-logger.service';
import { PendingSend } from './refund-acceptance.service';
import { evaluatePayoutRetry } from './refund-retry.policy';

/**
 * 개별 확인에서 실패한 PG 취소 요청을 조회하고 결과에 따라 정정·재시도하는 서비스 (API 계약 §8)
 * - Refund를 잠근 뒤 지급 상태를 다시 확인하고, 이전 실패 기록을 보존한 채 같은 금액의 새 PG 취소 요청을 만든다
 * - 새 요청이 필요하면 커밋 뒤 바로 보내고 개별 확인 결과를 반환한다
 */
@Injectable()
export class RefundRetryService {
  constructor(
    private readonly lockingRepository: RefundLockingRepository,
    private readonly refundRepository: RefundRepository,
    private readonly dispatchService: RefundDispatchService,
    private readonly configService: ConfigService,
    private readonly resultService: RefundResultService,
    private readonly pgService: PgService,
  ) {}

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
      await this.refundRepository.markPgCancelStatusCheckAttempt(
        tx,
        failed.id,
        {
          claimToken,
          claimUntil: new Date(
            now.getTime() + this.seconds('workLeaseSeconds') * 1000,
          ),
          now,
        },
      );
      return null;
    });
    if (claimed) return claimed;

    // 2. PG 조회는 트랜잭션 밖에서 한다
    const inquiry = await this.pgService.inquirePaymentCancel({
      paymentCancelId: candidate.id,
    });

    if (inquiry.result === 'SUCCEEDED') {
      await this.resultService.applyPgResult({
        source: 'INDIVIDUAL_CHECK',
        paymentCancelId: candidate.id,
        claimToken,
        pgCancelResult: {
          kind: 'SUCCEEDED',
          pgTransactionId: inquiry.pgTransactionId,
          actualAmount: inquiry.cancelledAmount,
        },
      });
      return {
        kind: 'CHECKED',
        inquiryResult: inquiry.result,
        resendResult: null,
      };
    }

    // 3. 결과 반영: 담당을 내려놓고 조건을 다시 확인한 뒤 미접수면 새 요청을 저장한다
    let pending: PendingSend | undefined;
    let actionLogs: TransactionLog[] = [];
    await this.refundRepository.runInTransaction(async (tx) => {
      await this.lockRetryTarget(tx, refundId);
      if (
        !(await this.refundRepository.releasePaymentCancelClaim(
          tx,
          candidate.id,
          claimToken,
          // 조회 오류는 결과 확인 불가로 남기고, 정상 응답은 이전 오류를 지운다
          inquiry.result === 'QUERY_ERROR' ? inquiry.reason : null,
        ))
      ) {
        return;
      }
      // 처리 중 조회는 내부 실패만 정정한다. PG 최종 거절과의 모순은 추가 지급을 차단한다.
      if (inquiry.result === 'IN_PROGRESS') {
        const failed = await this.refundRepository.findFailedRetryCandidate(
          refundId,
          tx,
        );
        const target = await this.refundRepository.findPayoutRetryTarget(
          refundId,
          tx,
        );
        const stored = await this.refundRepository.findPaymentCancelForResult(
          candidate.id,
          tx,
        );
        if (
          !stored ||
          failed?.id !== candidate.id ||
          !target ||
          !evaluatePayoutRetry(target.state, now).allowed
        )
          return;
        if (
          stored.failureCode === PaymentCancelFailureCode.SEND_FAILED ||
          stored.failureCode === PaymentCancelFailureCode.RETRY_EXHAUSTED
        ) {
          await this.refundRepository.resumePgCancelStatusInquiry(
            tx,
            candidate.id,
            new Date(
              now.getTime() + this.seconds('queryIntervalSeconds') * 1000,
            ),
          );
          await this.refundRepository.updateRefundPayout(tx, refundId, {
            payoutStatus: RefundPayoutStatus.PENDING,
            actionCode: null,
            actionReason: null,
          });
          actionLogs.push({
            transactionId: `REFUND-${refundId}-${candidate.id}`,
            type: 'REFUND',
            userId: stored.refund.customerId,
            orderId: stored.refund.orderId,
            status: `${stored.failureCode}_CORRECTED_BY_PG_QUERY`,
            metadata: {
              paymentCancelId: candidate.id,
              previousStatus: stored.status,
              previousFailureCode: stored.failureCode,
              previousFailureReason: stored.failureReason,
              previousFailedAt: stored.failedAt,
              received: inquiry,
            },
          });
          return;
        }
        actionLogs = await this.resultService.recordFailedAttemptConflict(
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
        !evaluatePayoutRetry(target.state, now).allowed
      ) {
        return;
      }
      const sendClaim = this.dispatchService.newSendClaim(now);
      const paymentCancelId =
        await this.refundRepository.createRetryPaymentCancel(tx, {
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
        });
      pending = {
        paymentCancelId,
        amount: target.state.amount,
        claimToken: sendClaim.claimToken,
        sentAt: now,
      };
    });

    // 내부 실패 정정·모순 기록의 거래 로그는커밋 뒤에 남긴다
    this.resultService.writeActionLogs(actionLogs);
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
