import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RefundActor } from './refund-access.service';
import { RefundRepository } from './refund.repository';
import { RefundRecoveryService } from './refund-recovery.service';

/** 개별 확인 응답 (API 계약 §8 POST /refund/:refundId/pg-check) */
export type PgCheckResult = {
  checkStatus:
    'CHECKED' | 'ALREADY_RUNNING' | 'RECENT_RESULT' | 'NO_PENDING_ATTEMPT';
  inquiryResult: string | null; // 이번 조회 결과, 조회하지 않았으면 null
  resendResult: string | null; // 이번 재전송의 최초 응답, 보내지 않았으면 null
  lastInquiryAt: string | null;
  lastInquiryFailed: boolean;
};

/**
 * 점주·운영자의 환불 PG 결과 개별 확인 서비스 (API 계약 §8, tasks T101~T103)
 * - 지정한 환불의 미확정 PG 취소 요청 한 건만 조회하고, 다른 환불과 전체 복구 일정은 바꾸지 않는다
 */
@Injectable()
export class RefundPgCheckService {
  constructor(
    private readonly refundRepository: RefundRepository,
    private readonly recoveryService: RefundRecoveryService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 환불의 PG 결과를 개별 확인한다
   * @param actor 요청한 점주·운영자
   * @param refundId 확인할 환불
   * @param now 요청 시각
   * @returns 확인 결과
   */
  async check(
    actor: RefundActor,
    refundId: string,
    now: Date,
  ): Promise<PgCheckResult> {
    void actor;
    // 지정한 환불의 미확정 PG 취소 요청 한 건만 조회한다(자동 조회 예정 시각과 무관)
    const pending =
      await this.refundRepository.findPendingAttemptOfRefund(refundId);
    if (!pending) {
      return Promise.reject(new Error('구현 전'));
    }
    // 최근 조회 간격 안의 반복 실행은 PG를 다시 부르지 않고 저장된 결과를 안내한다
    const intervalMs =
      this.configService.get<number>('refund.queryIntervalSeconds')! * 1000;
    if (
      pending.lastInquiryAt &&
      now.getTime() - pending.lastInquiryAt.getTime() < intervalMs
    ) {
      return this.storedResult('RECENT_RESULT', pending);
    }
    const inquiryResult = await this.recoveryService.inquireAttempt(
      pending.id,
      now,
    );
    const after =
      await this.refundRepository.findPendingAttemptOfRefund(refundId);
    return {
      ...this.storedResult('CHECKED', after),
      inquiryResult,
    };
  }

  /**
   * 저장된 조회 기록으로 응답을 만든다
   * @param checkStatus 확인 결과 구분
   * @param attempt 조회 기록(최근 조회 시각·마지막 오류)
   * @returns 조회·재전송을 하지 않은 응답
   */
  private storedResult(
    checkStatus: PgCheckResult['checkStatus'],
    attempt: {
      lastInquiryAt: Date | null;
      lastInquiryError: string | null;
    } | null,
  ): PgCheckResult {
    return {
      checkStatus,
      inquiryResult: null,
      resendResult: null,
      lastInquiryAt: attempt?.lastInquiryAt?.toISOString() ?? null,
      lastInquiryFailed: Boolean(attempt?.lastInquiryError),
    };
  }
}
