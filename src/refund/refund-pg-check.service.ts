import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RefundAccessService, RefundActor } from './refund-access.service';
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
  refund: Awaited<ReturnType<RefundRepository['findRefundSummary']>>; // 권한에 맞춘 최신 환불 정보
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
    private readonly accessService: RefundAccessService,
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
    // 현재 점주인 OWNER(자기 매장)와 MANAGER만, 범위 밖 환불은 존재를 드러내지 않고 404
    await this.accessService.assertRefundScope(actor, refundId);
    const result = await this.checkInScope(refundId, now, actor.userId);
    return {
      ...result,
      refund: await this.refundRepository.findRefundSummary(refundId),
    };
  }

  /**
   * 권한을 확인한 환불의 PG 결과를 개별 확인한다
   * @param refundId 확인할 환불
   * @param now 요청 시각
   * @param actorId 실행자(재전송 거래 로그에 남긴다)
   * @returns 환불 요약을 뺀 확인 결과
   */
  private async checkInScope(
    refundId: string,
    now: Date,
    actorId: string,
  ): Promise<Omit<PgCheckResult, 'refund'>> {
    // 지정한 환불의 미확정 PG 취소 요청 한 건만 조회한다(자동 조회 예정 시각과 무관)
    const pending =
      await this.refundRepository.findPendingAttemptOfRefund(refundId);
    // 지급 완료·0원·금액 검토·별도 지급 방식·예약 중 등 개별 PG 조회 대상이 아니면 저장 상태만 안내한다
    if (!pending) return this.storedResult('NO_PENDING_ATTEMPT', null);
    // 같은 환불의 전송·조회 담당이 유효하면 PG를 다시 부르지 않는다
    if (pending.claimUntil && pending.claimUntil > now) {
      return this.storedResult('ALREADY_RUNNING', pending);
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
    const inquired = await this.recoveryService.inquireForCheck(
      pending.id,
      now,
      actorId,
    );
    // 확인과 조회 담당 지정 사이에 다른 작업이 먼저 맡았으면 진행 중으로 안내한다
    if (inquired === null) {
      return this.storedResult('ALREADY_RUNNING', pending);
    }
    // 잠금 안의 재확인에서 최근 조회 간격 안으로 판명되면 저장된 최근 결과를 안내한다
    if (inquired === 'RECENT') {
      return this.storedResult(
        'RECENT_RESULT',
        await this.refundRepository.findPendingAttemptOfRefund(refundId),
      );
    }
    const after =
      await this.refundRepository.findPendingAttemptOfRefund(refundId);
    return {
      ...this.storedResult('CHECKED', after),
      ...inquired,
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
  ): Omit<PgCheckResult, 'refund'> {
    return {
      checkStatus,
      inquiryResult: null,
      resendResult: null,
      lastInquiryAt: attempt?.lastInquiryAt?.toISOString() ?? null,
      lastInquiryFailed: Boolean(attempt?.lastInquiryError),
    };
  }
}
