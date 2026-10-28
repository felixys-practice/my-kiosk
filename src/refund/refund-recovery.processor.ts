import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { RefundRecoveryService } from './refund-recovery.service';
import { refundRecoveryQueueName } from './refund-recovery.scheduler';

/**
 * 환불 정기 탐색 작업 처리기 (API 계약 §8)
 * - 예정 시각이 지난 조회와 결과 확인 실패 건의 장애 복구 확인을 실행한다
 */
@Processor(refundRecoveryQueueName)
export class RefundRecoveryProcessor extends WorkerHost {
  constructor(
    private readonly recoveryService: RefundRecoveryService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  /**
   * 정기 탐색 작업을 처리한다
   * @param job BullMQ 작업
   */
  async process(job: Job): Promise<void> {
    void job;
    // 작업자를 끈 환경에서는 Redis에 남은 이전 스케줄이 실행돼도 아무것도 하지 않는다
    if (!this.configService.get<boolean>('refund.recoveryWorkerEnabled')) {
      return;
    }
    await this.recoveryService.sweep(new Date());
    // 탐색이 오래 걸렸을 수 있으므로 장애 복구 담당 기한은 지금 시각으로 잡는다
    await this.recoveryService.recoverQueryFailed(new Date());
  }
}
