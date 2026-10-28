import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentCancelFailureCode, PaymentCancelStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import type { RefundPgGateway } from 'src/pg/refund-pg.gateway';
import { AttemptForResult, RefundRepository } from './refund.repository';
import { RefundLockingRepository } from './refund-locking.repository';
import { RefundDispatchService } from './refund-dispatch.service';
import { RefundResultService } from './refund-result.service';

/** 자동 조회 대상인 미확정 시도 상태 */
const inquirableStatuses: readonly PaymentCancelStatus[] = [
  PaymentCancelStatus.REQUESTED,
  PaymentCancelStatus.QUERY_FAILED,
];

/**
 * PG 취소 결과 자동 조회·재전송·장애 복구 서비스 (API 계약 §8, tasks T097~T099)
 * - 일정의 원천은 DB(nextInquiryAt)이며, 조회는 담당을 정한 뒤 트랜잭션 밖에서 한다
 */
@Injectable()
export class RefundRecoveryService {
  constructor(
    private readonly refundRepository: RefundRepository,
    private readonly lockingRepository: RefundLockingRepository,
    private readonly dispatchService: RefundDispatchService,
    private readonly resultService: RefundResultService,
    private readonly configService: ConfigService,
    @Inject(REFUND_PG_GATEWAY) private readonly pgGateway: RefundPgGateway,
  ) {}

  /**
   * PG 취소 요청 한 건을 조회하고 결과에 따라 반영·재전송·재조회 예약을 한다
   * @param paymentCancelId 조회할 PG 취소 요청
   * @param now 조회 시각(일정 계산 기준)
   */
  async inquireAttempt(paymentCancelId: string, now: Date): Promise<void> {
    // 1. Refund → PaymentCancel을 잠그고 조회 담당을 정한 뒤 커밋한다
    const claimToken = randomUUID();
    const attempt = await this.claimForInquiry(
      paymentCancelId,
      claimToken,
      now,
    );
    if (!attempt) return;

    // 2. PG 조회는 트랜잭션 밖에서 한다
    const result = await this.pgGateway.inquireCancel({ paymentCancelId });

    // 3. PG가 미접수를 확실히 확인했으면 자동 한도 안에서 같은 ID·금액으로 다시 보내고,
    //    한도를 모두 썼으면 그 시도를 실패(RETRY_EXHAUSTED)로 끝내 운영자 재처리로 넘긴다
    if (result.result === 'NOT_FOUND') {
      if (attempt.resendCount < this.config('resendLimit')) {
        await this.dispatchService.resendClaimed(
          paymentCancelId,
          attempt.amount,
          claimToken,
          now,
          'resendCount',
        );
        return;
      }
      await this.resultService.applyPgResult({
        paymentCancelId,
        claimToken,
        outcome: {
          kind: 'FAILED',
          reason: '자동 재전송 한도를 소진한 뒤 PG 미접수 확인',
          failureCode: PaymentCancelFailureCode.RETRY_EXHAUSTED,
        },
      });
      return;
    }

    // 4. PG가 처리 중이면 결과를 단정하지 않고 정상 간격 뒤 다시 조회한다(연속 조회 오류는 0으로)
    if (result.result === 'IN_PROGRESS') {
      await this.refundRepository.scheduleNextInquiry(
        paymentCancelId,
        claimToken,
        {
          nextInquiryAt: new Date(
            now.getTime() + this.config('queryIntervalSeconds') * 1000,
          ),
          inquiryFailureCount: 0,
          lastInquiryError: null,
        },
      );
    }
  }

  /**
   * 조회 담당을 정한다(미확정이고 유효한 다른 담당이 없을 때만)
   * @param paymentCancelId PG 취소 요청
   * @param claimToken 새 담당 토큰
   * @param now 조회 시각
   * @returns 맡은 시도, 맡지 못하면 null
   */
  private claimForInquiry(
    paymentCancelId: string,
    claimToken: string,
    now: Date,
  ): Promise<AttemptForResult | null> {
    return this.refundRepository.runInTransaction(async (tx) => {
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
      if (!inquirableStatuses.includes(attempt.status)) return null;
      if (attempt.claimUntil && attempt.claimUntil > now) return null;
      await this.refundRepository.markInquiryStarted(tx, attempt.id, {
        claimToken,
        claimUntil: new Date(
          now.getTime() + this.config('workLeaseSeconds') * 1000,
        ),
        now,
      });
      return attempt;
    });
  }

  /**
   * 환불 운영 설정 값을 읽는다
   * @param key 설정 이름(refund.<key>)
   * @returns 설정 값
   */
  private config(
    key: 'resendLimit' | 'workLeaseSeconds' | 'queryIntervalSeconds',
  ): number {
    return this.configService.get<number>(`refund.${key}`)!;
  }
}
