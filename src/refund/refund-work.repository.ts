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
   * 복구 제어 상태를 바꾼다
   * @param update 바꿀 모드·다음 확인 시각·BATCH 기준 시각
   */
  async updateRecoveryControl(
    update: Partial<RecoveryControlState>,
  ): Promise<void> {
    await this.prisma.refundRecoveryControl.update({
      where: { id: recoveryControlId },
      data: update,
    });
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
}
