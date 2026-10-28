import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentCancelFailureCode,
  PaymentCancelStatus,
  RefundPayoutStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import type { RefundPgGateway } from 'src/pg/refund-pg.gateway';
import { PgCancelSendResult } from 'src/pg/pg.types';
import { RefundRepository } from './refund.repository';
import { RefundLockingRepository } from './refund-locking.repository';
import { RefundResultService } from './refund-result.service';

/** PG 취소 요청 전송 결과 요약 */
export type DispatchOutcome = {
  sent: boolean; // 이번 호출이 실제로 PG에 보냈는지(담당을 얻지 못하면 false)
};

/** 전송·결과 반영을 할 수 있는 미확정 시도 상태 */
const sendableStatuses: readonly PaymentCancelStatus[] = [
  PaymentCancelStatus.REQUESTED,
  PaymentCancelStatus.QUERY_FAILED,
];

/**
 * PG 취소 요청 전송 서비스 (API 계약 §8, tasks T096)
 * - 전송 직전에 전송 시도 횟수·시각·담당 기한을 저장하고, PG 호출은 트랜잭션 밖에서 한다
 * - 전송 결과는 NOT_SENT·REJECTED면 시도 실패·조치 필요, ACCEPTED·UNKNOWN이면 조회 대기, SUCCEEDED면 공통 결과 처리
 */
@Injectable()
export class RefundDispatchService {
  constructor(
    private readonly refundRepository: RefundRepository,
    private readonly lockingRepository: RefundLockingRepository,
    private readonly configService: ConfigService,
    private readonly resultService: RefundResultService,
    @Inject(REFUND_PG_GATEWAY) private readonly pgGateway: RefundPgGateway,
  ) {}

  /**
   * PG 취소 요청을 보낸다
   * @param paymentCancelId 보낼 PG 취소 요청
   * @returns 전송 결과 요약
   */
  async dispatch(paymentCancelId: string): Promise<DispatchOutcome> {
    const claimToken = randomUUID();
    const now = new Date();
    // 1. Refund → PaymentCancel을 잠그고 담당·전송 시도를 저장한 뒤 커밋한다
    const prepared = await this.refundRepository.runInTransaction(
      async (tx) => {
        const found = await this.refundRepository.findAttemptForResult(
          paymentCancelId,
          tx,
        );
        if (!found) return null;
        await this.lockingRepository.lockForPayout(tx, {
          refundId: found.refund.id,
          paymentCancelIds: [found.id],
          manualRefundPayoutIds: [],
        });
        const attempt = (await this.refundRepository.findAttemptForResult(
          paymentCancelId,
          tx,
        ))!;
        // 확정된 시도나 다른 작업자가 유효하게 맡은 시도는 보내지 않는다
        if (!sendableStatuses.includes(attempt.status)) return null;
        if (attempt.claimUntil && attempt.claimUntil > now) return null;
        await this.refundRepository.markSendStarted(tx, attempt.id, {
          claimToken,
          claimUntil: new Date(now.getTime() + this.seconds('workLease')),
          now,
        });
        return { amount: attempt.amount };
      },
    );
    if (!prepared) return { sent: false };

    // 2. PG 호출은 트랜잭션 밖에서 한다(PG 시도 ID를 멱등 키로 쓴다)
    const result = await this.pgGateway.sendCancel({
      paymentCancelId,
      amount: prepared.amount,
    });

    // 3. 전송 결과를 반영한다
    await this.recordSendResult(paymentCancelId, claimToken, now, result);
    return { sent: true };
  }

  /**
   * 이미 맡은(조회 담당) PG 취소 요청을 같은 ID·금액으로 다시 보낸다 (API 계약 §8)
   * - 재전송 횟수·전송 시도·새 처리 기한을 먼저 저장한 뒤 트랜잭션 밖에서 보낸다
   * @param paymentCancelId PG 취소 요청
   * @param amount 기존 PG 취소 요청 금액
   * @param claimToken 조회를 맡은 담당 토큰
   * @param now 재전송 시각
   * @param counter 자동 재전송(resendCount) 또는 개별 확인 재전송(manualResendCount)
   * @returns 실제로 보냈으면 true(담당이 바뀌었으면 false)
   */
  async resendClaimed(
    paymentCancelId: string,
    amount: number,
    claimToken: string,
    now: Date,
    counter: 'resendCount' | 'manualResendCount',
  ): Promise<boolean> {
    const marked = await this.refundRepository.markResendStarted(
      paymentCancelId,
      {
        claimToken,
        claimUntil: new Date(now.getTime() + this.seconds('workLease')),
        now,
      },
      counter,
    );
    if (!marked) return false;
    const result = await this.pgGateway.sendCancel({ paymentCancelId, amount });
    await this.recordSendResult(paymentCancelId, claimToken, now, result);
    return true;
  }

  /**
   * 커밋 뒤 바로 보낼 PG 취소 요청의 담당을 만든다(확정 트랜잭션이 전송 직전 기록과 함께 저장한다)
   * @param now 전송 시도 시각
   * @returns 담당 토큰과 처리 기한
   */
  newSendClaim(now: Date): { claimToken: string; claimUntil: Date } {
    return {
      claimToken: randomUUID(),
      claimUntil: new Date(now.getTime() + this.seconds('workLease')),
    };
  }

  /**
   * 전송 결과를 반영한다
   * @param paymentCancelId PG 취소 요청
   * @param claimToken 전송을 맡은 담당 토큰
   * @param sentAt 전송 시도 시각
   * @param result PG 전송 결과
   * @returns 반영 뒤 환불의 지급 상태와 조치 사유 코드
   */
  async recordSendResult(
    paymentCancelId: string,
    claimToken: string,
    sentAt: Date,
    result: PgCancelSendResult,
  ): Promise<{ payoutStatus: RefundPayoutStatus; actionCode: string | null }> {
    await this.applySendResult(paymentCancelId, claimToken, sentAt, result);
    return this.refundRepository.findPayoutStateByAttempt(paymentCancelId);
  }

  /**
   * 전송 결과 종류별로 시도·환불 상태를 바꾼다
   * @param paymentCancelId PG 취소 요청
   * @param claimToken 전송을 맡은 담당 토큰
   * @param sentAt 전송 시도 시각
   * @param result PG 전송 결과
   */
  private async applySendResult(
    paymentCancelId: string,
    claimToken: string,
    sentAt: Date,
    result: PgCancelSendResult,
  ): Promise<void> {
    // 보내기 전에 실패가 확인되면 그 시도를 실패(SEND_FAILED)로 끝내고 조치 필요로 둔다(API 계약 §8)
    if (result.result === 'NOT_SENT') {
      await this.resultService.applyPgResult({
        paymentCancelId,
        claimToken,
        outcome: {
          kind: 'FAILED',
          reason: result.reason,
          failureCode: PaymentCancelFailureCode.SEND_FAILED,
        },
      });
      return;
    }
    // PG가 즉시 거절하면 그 시도를 실패(PG_REJECTED)로 끝내고 조치 필요로 둔다
    if (result.result === 'REJECTED') {
      await this.resultService.applyPgResult({
        paymentCancelId,
        claimToken,
        outcome: { kind: 'FAILED', reason: result.reason },
      });
      return;
    }
    // PG가 즉시 취소를 확정하면 공통 결과 처리로 실제액·원장을 반영한다
    if (result.result === 'SUCCEEDED') {
      await this.resultService.applyPgResult({
        paymentCancelId,
        claimToken,
        outcome: {
          kind: 'SUCCEEDED',
          pgTransactionId: result.pgTransactionId,
          actualAmount: result.cancelledAmount,
        },
      });
      return;
    }
    // 결과를 아직 모르면 전송 시각부터 결과 대기 시간 뒤 첫 조회를 예약한다
    await this.refundRepository.scheduleInquiryAfterSend(
      paymentCancelId,
      claimToken,
      new Date(sentAt.getTime() + this.seconds('resultWait')),
    );
  }

  /**
   * 환불 운영 설정의 초 단위 값을 밀리초로 읽는다
   * @param key 설정 이름(refund.<key>Seconds)
   * @returns 밀리초
   */
  private seconds(key: 'workLease' | 'resultWait'): number {
    return this.configService.get<number>(`refund.${key}Seconds`)! * 1000;
  }
}
