import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentCancelFailureCode,
  PaymentCancelStatus,
  RefundRecoveryMode,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import type { RefundPgGateway } from 'src/pg/refund-pg.gateway';
import { AttemptForResult, RefundRepository } from './refund.repository';
import { RefundLockingRepository } from './refund-locking.repository';
import { RefundDispatchService } from './refund-dispatch.service';
import { RefundResultService } from './refund-result.service';
import { inquiryBackoffSeconds } from './refund-recovery.policy';
import { RefundWorkRepository } from './refund-work.repository';
import { refundRecoveryQueueName } from './refund-recovery.scheduler';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PgCancelQueryResult } from 'src/pg/pg.types';

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
    private readonly workRepository: RefundWorkRepository,
    @InjectQueue(refundRecoveryQueueName) private readonly recoveryQueue: Queue,
    @Inject(REFUND_PG_GATEWAY) private readonly pgGateway: RefundPgGateway,
  ) {}

  /**
   * DB에서 조회 예정 시각이 지난 PG 취소 요청을 찾아 조회한다(정기 탐색)
   * @param now 탐색 시각
   */
  async sweep(now: Date): Promise<void> {
    const due = await this.refundRepository.findDueInquiries(
      now,
      this.config('recoveryBatchSize'),
    );
    // 예정 시각 순으로 한 건씩 조회한다(각 건은 담당 토큰으로 중복 실행을 막는다)
    for (const paymentCancelId of due) {
      await this.inquireAttempt(paymentCancelId, now);
    }
  }

  /**
   * 결과 확인 실패(QUERY_FAILED) 건의 장애 복구 확인을 한 번 실행한다(PROBE 1건 / BATCH 처리 단위)
   * @param now 실행 시각
   */
  async recoverQueryFailed(now: Date): Promise<void> {
    // 복구 작업 담당을 잡는다. 다른 작업자가 처리 기한 안에서 맡고 있으면 이번 실행은 건너뛴다
    const claimToken = randomUUID();
    await this.workRepository.getRecoveryControl();
    const claimed = await this.workRepository.claimRecoveryControl(
      claimToken,
      now,
      new Date(now.getTime() + this.config('workLeaseSeconds') * 1000),
    );
    if (!claimed) return;
    try {
      await this.runRecovery(now);
    } finally {
      await this.workRepository.releaseRecoveryControl(claimToken);
    }
  }

  /**
   * 복구 제어 모드에 따라 PROBE 1건 또는 BATCH 처리 단위를 조회한다
   * @param now 실행 시각
   */
  private async runRecovery(now: Date): Promise<void> {
    const control = await this.workRepository.getRecoveryControl();
    if (control.mode === RefundRecoveryMode.BATCH) {
      await this.runRecoveryBatch(control.batchCutoffAt ?? now, now);
      return;
    }
    // PROBE: 다음 확인 시각이 되면 가장 오래된 1건만 조회한다
    if (control.nextProbeAt && control.nextProbeAt > now) return;
    const [oldest] = await this.workRepository.findQueryFailed(now, 1);
    if (!oldest) return;
    const result = await this.inquireAttempt(oldest, now);
    if (result === null) return;
    // 조회 장애가 이어지면 다음 확인 시각까지 기다리고, 정상 응답이면 나머지를 처리 단위씩 확인한다
    await this.workRepository.updateRecoveryControl(
      result === 'QUERY_ERROR'
        ? { nextProbeAt: this.nextProbeAt(now) }
        : {
            mode: RefundRecoveryMode.BATCH,
            batchCutoffAt: now,
            nextProbeAt: null,
          },
    );
  }

  /**
   * 복구 현황을 읽는다 (API 계약 §8 GET /refund/recovery/status)
   * @param now 현재 시각(실행 중 판단 기준)
   * @returns 모드·실행 여부·건수·가장 오래된 결과 확인 실패 시각·다음 확인 시각
   */
  async recoveryStatus(now: Date) {
    const control = await this.workRepository.getRecoveryControl();
    const counts = await this.workRepository.getRecoveryCounts();
    return {
      mode: control.mode,
      running: control.claimUntil !== null && control.claimUntil > now,
      ...counts,
      nextProbeAt: control.nextProbeAt,
    };
  }

  /**
   * 운영자 전체 재확인: 자동 확인 예정 시각을 기다리지 않고 결과 확인 실패 건을 처리 단위씩 조회하도록 예약한다 (API 계약 §8)
   * @param now 요청 시각(BATCH 대상 기준 시각)
   * @returns SCHEDULED(예약함) / ALREADY_RUNNING(복구 작업 진행 중) / NO_WORK(대상 없음)
   */
  async resumeRecovery(
    now: Date,
  ): Promise<'SCHEDULED' | 'ALREADY_RUNNING' | 'NO_WORK'> {
    // 다른 작업자가 복구 작업을 처리 기한 안에서 실행 중이면 중복 실행하지 않는다
    const control = await this.workRepository.getRecoveryControl();
    if (control.claimUntil && control.claimUntil > now)
      return 'ALREADY_RUNNING';
    // 기준 시각 이전의 결과 확인 실패 건이 없으면 할 일이 없다
    const [any] = await this.workRepository.findQueryFailed(now, 1);
    if (!any) return 'NO_WORK';
    // 다음 PROBE 시각을 기다리지 않고 지금 이전의 결과 확인 실패 건을 처리 단위씩 확인한다
    await this.workRepository.updateRecoveryControl({
      mode: RefundRecoveryMode.BATCH,
      batchCutoffAt: now,
      nextProbeAt: null,
    });
    // 정기 탐색을 기다리지 않도록 같은 작업을 바로 한 번 넣는다
    await this.recoveryQueue.add('sweep', {});
    return 'SCHEDULED';
  }

  /**
   * BATCH: 기준 시각 이전의 결과 확인 실패 건을 처리 단위만큼 조회한다
   * - 조회 장애가 다시 나면 PROBE로 돌아가고, 남은 건이 없으면 PROBE 대기로 돌아간다
   * @param cutoff BATCH 대상 기준 시각
   * @param now 실행 시각
   */
  private async runRecoveryBatch(cutoff: Date, now: Date): Promise<void> {
    const batch = await this.workRepository.findQueryFailed(
      cutoff,
      this.config('recoveryBatchSize'),
    );
    if (batch.length === 0) {
      await this.workRepository.updateRecoveryControl({
        mode: RefundRecoveryMode.PROBE,
        batchCutoffAt: null,
        nextProbeAt: null,
      });
      return;
    }
    for (const paymentCancelId of batch) {
      const result = await this.inquireAttempt(paymentCancelId, now);
      if (result === 'QUERY_ERROR') {
        await this.workRepository.updateRecoveryControl({
          mode: RefundRecoveryMode.PROBE,
          batchCutoffAt: null,
          nextProbeAt: this.nextProbeAt(now),
        });
        return;
      }
    }
  }

  /**
   * 다음 PROBE 확인 시각
   * @param now 기준 시각
   * @returns now + REFUND_RECOVERY_PROBE_SECONDS
   */
  private nextProbeAt(now: Date): Date {
    return new Date(now.getTime() + this.config('recoveryProbeSeconds') * 1000);
  }

  /**
   * PG 취소 요청 한 건을 조회하고 결과에 따라 반영·재전송·재조회 예약을 한다
   * @param paymentCancelId 조회할 PG 취소 요청
   * @param now 조회 시각(일정 계산 기준)
   */
  async inquireAttempt(
    paymentCancelId: string,
    now: Date,
  ): Promise<PgCancelQueryResult['result'] | null> {
    // 1. Refund → PaymentCancel을 잠그고 조회 담당을 정한 뒤 커밋한다
    const claimToken = randomUUID();
    const attempt = await this.claimForInquiry(
      paymentCancelId,
      claimToken,
      now,
    );
    if (!attempt) return null;

    // 2. PG 조회는 트랜잭션 밖에서 한다
    const result = await this.pgGateway.inquireCancel({ paymentCancelId });
    await this.applyInquiryResult(attempt, claimToken, now, result);
    return result.result;
  }

  /**
   * 조회 결과에 따라 반영·재전송·재조회 예약을 한다
   * @param attempt 조회를 맡은 PG 취소 요청
   * @param claimToken 조회 담당 토큰
   * @param now 조회 시각
   * @param result PG 조회 결과
   */
  private async applyInquiryResult(
    attempt: AttemptForResult,
    claimToken: string,
    now: Date,
    result: PgCancelQueryResult,
  ): Promise<void> {
    const paymentCancelId = attempt.id;

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
      return;
    }

    // 5. 조회 오류이면 결과를 단정하지 않고 지수 백오프 간격 뒤 다시 조회한다
    if (result.result === 'QUERY_ERROR') {
      const failures = attempt.inquiryFailureCount + 1;
      // 이미 결과 확인 실패인 건은 진입 시각·알림을 반복하지 않고 오류만 기록한다(다음 확인은 장애 복구 확인)
      if (attempt.status === PaymentCancelStatus.QUERY_FAILED) {
        await this.refundRepository.recordRepeatedQueryError(
          paymentCancelId,
          claimToken,
          { inquiryFailureCount: failures, lastInquiryError: result.reason },
        );
        return;
      }
      // 연속 오류가 한도에 도달하면 결과 확인 실패로 바꾸고 이후는 장애 복구 확인이 맡는다
      if (failures >= this.config('queryFailureThreshold')) {
        await this.resultService.recordQueryFailed(
          paymentCancelId,
          claimToken,
          {
            inquiryFailureCount: failures,
            reason: result.reason,
            now,
          },
        );
        return;
      }
      await this.refundRepository.scheduleNextInquiry(
        paymentCancelId,
        claimToken,
        {
          nextInquiryAt: new Date(
            now.getTime() +
              inquiryBackoffSeconds(
                failures,
                this.config('queryBackoffSeconds'),
                this.config('queryBackoffMaxSeconds'),
              ) *
                1000,
          ),
          inquiryFailureCount: failures,
          lastInquiryError: result.reason,
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
    key:
      | 'resendLimit'
      | 'workLeaseSeconds'
      | 'queryIntervalSeconds'
      | 'queryBackoffSeconds'
      | 'queryBackoffMaxSeconds'
      | 'queryFailureThreshold'
      | 'recoveryBatchSize'
      | 'recoveryProbeSeconds',
  ): number {
    return this.configService.get<number>(`refund.${key}`)!;
  }
}
