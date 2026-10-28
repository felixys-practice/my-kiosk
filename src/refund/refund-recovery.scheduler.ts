import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/** 환불 PG 작업 큐 이름 */
export const refundRecoveryQueueName = 'refund-recovery';
/** 정기 탐색 작업 스케줄러 ID(여러 인스턴스가 등록해도 하나로 유지) */
export const refundSweepSchedulerId = 'refund-recovery-sweep';

/**
 * 환불 자동 조회·장애 복구 정기 탐색 스케줄 등록 (API 계약 §8, research 결정)
 * - 일정의 원천은 DB(nextInquiryAt·복구 제어 행)이므로, 기동 때 정기 탐색만 등록하면 재기동 뒤 밀린 일이 이어진다
 */
@Injectable()
export class RefundRecoveryScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(refundRecoveryQueueName) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 기동 시 정기 탐색 작업 스케줄을 등록한다(작업자 설정이 켜져 있을 때만)
   */
  async onApplicationBootstrap(): Promise<void> {
    // 테스트 환경 등 작업자를 끈 환경에서는 등록하지 않는다
    if (!this.configService.get<boolean>('refund.recoveryWorkerEnabled')) {
      return;
    }
    const sweepSeconds = this.configService.get<number>(
      'refund.sweepIntervalSeconds',
    )!;
    await this.queue.upsertJobScheduler(
      refundSweepSchedulerId,
      { every: sweepSeconds * 1000 },
      { name: 'sweep' },
    );
  }
}
