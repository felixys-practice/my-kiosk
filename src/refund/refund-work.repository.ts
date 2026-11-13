import { Injectable } from '@nestjs/common';
import {
  ManualRefundPayoutStatus,
  PaymentCancelStatus,
  RefundDecisionStatus,
  RefundPayoutMethod,
  RefundPayoutStatus,
  RefundRecoveryMode,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

/** 단일 복구 제어 행 식별자 */
const recoveryControlId = 'PG_RESULT_RECOVERY';

/** 복구 제어 상태 */
export type RecoveryControlState = {
  mode: RefundRecoveryMode;
  nextProbeAt: Date | null;
  batchCutoffAt: Date | null;
  claimUntil: Date | null; // 복구 작업을 맡은 작업자의 처리 기한
};

/**
 * 환불 PG 작업(장애 복구 확인) 저장소 (data-model §8 RefundRecoveryControl)
 * - 결과 확인 실패(QUERY_FAILED) 건은 하나의 제어 행으로 PROBE/BATCH 확인한다
 */
@Injectable()
export class RefundWorkRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 복구 제어 행을 읽는다(없으면 PROBE·즉시 실행 가능 상태로 만든다)
   * @returns 복구 제어 상태
   */
  async getRecoveryControl(): Promise<RecoveryControlState> {
    return this.prisma.refundRecoveryControl.upsert({
      where: { id: recoveryControlId },
      create: { id: recoveryControlId, mode: RefundRecoveryMode.PROBE },
      update: {},
      select: {
        mode: true,
        nextProbeAt: true,
        batchCutoffAt: true,
        claimUntil: true,
      },
    });
  }

  /**
   * 복구 작업 담당을 잡는다(담당이 없거나 처리 기한이 지났을 때만)
   * @param claimToken 새 담당 토큰
   * @param now 현재 시각
   * @param claimUntil 처리 기한
   * @returns 담당을 잡았으면 true
   */
  async claimRecoveryControl(
    claimToken: string,
    now: Date,
    claimUntil: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.refundRecoveryControl.updateMany({
      where: {
        id: recoveryControlId,
        OR: [{ claimUntil: null }, { claimUntil: { lte: now } }],
      },
      data: { claimToken, claimUntil },
    });
    return count === 1;
  }

  /**
   * 맡은 복구 작업의 처리 기한을 늘린다(긴 BATCH 중 담당을 잃지 않게)
   * @param claimToken 담당 토큰
   * @param claimUntil 새 처리 기한
   * @returns 아직 자기 담당이라 늘렸으면 true
   */
  async extendRecoveryControl(
    claimToken: string,
    claimUntil: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.refundRecoveryControl.updateMany({
      where: { id: recoveryControlId, claimToken },
      data: { claimUntil },
    });
    return count === 1;
  }

  /**
   * 맡았던 복구 작업 담당을 내려놓는다(아직 자기 담당일 때만)
   * @param claimToken 담당 토큰
   */
  async releaseRecoveryControl(claimToken: string): Promise<void> {
    await this.prisma.refundRecoveryControl.updateMany({
      where: { id: recoveryControlId, claimToken },
      data: { claimToken: null, claimUntil: null },
    });
  }

  /**
   * 복구 제어 상태를 바꾼다(현재 담당 토큰일 때만, 담당을 잃은 작업자의 늦은 변경을 막는다)
   * @param claimToken 복구 작업 담당 토큰
   * @param update 바꿀 모드·다음 확인 시각·BATCH 기준 시각
   * @returns 바꿨으면 true
   */
  async updateRecoveryControl(
    claimToken: string,
    update: Partial<Omit<RecoveryControlState, 'claimUntil'>>,
  ): Promise<boolean> {
    const { count } = await this.prisma.refundRecoveryControl.updateMany({
      where: { id: recoveryControlId, claimToken },
      data: update,
    });
    return count === 1;
  }

  /**
   * 기준 시각 이전에 결과 확인 실패로 바뀐 PG 취소 요청을 오래된 순으로 찾는다
   * - 자동 PG 처리 대상 환불(확정·지급 처리 중·PG 방식, 별도 지급 예약 없음)만 고른다
   * @param cutoff 결과 확인 실패 진입 시각의 기준
   * @param limit 최대 건수
   * @returns PG 취소 요청 ID
   */
  async findQueryFailed(cutoff: Date, limit: number): Promise<string[]> {
    const attempts = await this.prisma.paymentCancel.findMany({
      where: {
        status: PaymentCancelStatus.QUERY_FAILED,
        queryFailedAt: { lte: cutoff },
        refund: {
          decisionStatus: RefundDecisionStatus.ACCEPTED,
          payoutStatus: RefundPayoutStatus.PENDING,
          payoutMethod: RefundPayoutMethod.PG,
          manualPayouts: {
            none: { status: ManualRefundPayoutStatus.RESERVED },
          },
        },
      },
      orderBy: { queryFailedAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return attempts.map((attempt) => attempt.id);
  }

  /**
   * 복구 현황 집계를 읽는다 (API 계약 §8 GET /refund/recovery/status)
   * @returns 결과 확인 중·결과 확인 실패·조치 필요·별도 지급 예약 건수와 가장 오래된 결과 확인 실패 시각
   */
  async getRecoveryCounts(): Promise<{
    requestedCount: number;
    queryFailedCount: number;
    actionRequiredCount: number;
    reservedManualCount: number;
    oldestQueryFailedAt: Date | null;
  }> {
    const [
      requestedCount,
      queryFailedCount,
      actionRequiredCount,
      reservedManualCount,
      oldest,
    ] = await Promise.all([
      this.prisma.paymentCancel.count({
        where: {
          status: PaymentCancelStatus.REQUESTED,
        },
      }),
      this.prisma.paymentCancel.count({
        where: { status: PaymentCancelStatus.QUERY_FAILED },
      }),
      this.prisma.refund.count({
        where: { payoutStatus: RefundPayoutStatus.ACTION_REQUIRED },
      }),
      this.prisma.manualRefundPayout.count({
        where: { status: ManualRefundPayoutStatus.RESERVED },
      }),
      this.prisma.paymentCancel.findFirst({
        where: { status: PaymentCancelStatus.QUERY_FAILED },
        orderBy: { queryFailedAt: 'asc' },
        select: { queryFailedAt: true },
      }),
    ]);
    return {
      requestedCount,
      queryFailedCount,
      actionRequiredCount,
      reservedManualCount,
      oldestQueryFailedAt: oldest?.queryFailedAt ?? null,
    };
  }
}
