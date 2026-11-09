import { vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  RefundRecoveryScheduler,
  refundSweepSchedulerId,
} from './refund-recovery.scheduler';

describe('RefundRecoveryScheduler', () => {
  /**
   * 설정 대역으로 스케줄러를 만든다
   * @param enabled 자동 작업자 실행 여부
   * @returns 스케줄러와 큐 대역
   */
  function schedulerWith(enabled: boolean) {
    const queue = { upsertJobScheduler: vi.fn() };
    const values: Record<string, unknown> = {
      'refund.recoveryWorkerEnabled': enabled,
      'refund.sweepIntervalSeconds': 5,
    };
    const config = {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
    return {
      scheduler: new RefundRecoveryScheduler(queue as unknown as Queue, config),
      queue,
    };
  }

  it('기동 시 정기 탐색 작업을 탐색 주기(5초)마다 실행하도록 등록한다', async () => {
    const { scheduler, queue } = schedulerWith(true);

    await scheduler.onApplicationBootstrap();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      refundSweepSchedulerId,
      { every: 5_000 },
      { name: 'sweep' },
    );
  });
  it('자동 작업자 설정이 꺼져 있으면 정기 탐색 스케줄을 등록하지 않는다', async () => {
    const { scheduler, queue } = schedulerWith(false);

    await scheduler.onApplicationBootstrap();

    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });
});
