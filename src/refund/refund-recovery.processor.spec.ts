import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { RefundRecoveryProcessor } from './refund-recovery.processor';
import { RefundRecoveryService } from './refund-recovery.service';

describe('RefundRecoveryProcessor', () => {
  /**
   * 설정·복구 서비스 대역으로 처리기를 만든다
   * @param enabled 자동 작업자 실행 여부
   * @returns 처리기와 복구 서비스 대역
   */
  function processorWith(enabled: boolean) {
    const recovery = {
      sweep: jest.fn().mockResolvedValue(undefined),
      recoverQueryFailed: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      get: () => enabled,
    } as unknown as ConfigService;
    return {
      processor: new RefundRecoveryProcessor(
        recovery as unknown as RefundRecoveryService,
        config,
      ),
      recovery,
    };
  }

  const sweepJob = { name: 'sweep' } as Job;

  it('정기 탐색 작업은 예정 조회 탐색과 장애 복구 확인을 같은 시각으로 실행한다', async () => {
    const { processor, recovery } = processorWith(true);

    await processor.process(sweepJob);

    const [[sweptAt]] = recovery.sweep.mock.calls as Date[][];
    expect({
      sweptAt: sweptAt instanceof Date,
      recoveredAt: recovery.recoverQueryFailed.mock.calls,
    }).toEqual({ sweptAt: true, recoveredAt: [[sweptAt]] });
  });

  it('자동 작업자 설정이 꺼져 있으면 아무것도 하지 않는다', async () => {
    const { processor, recovery } = processorWith(false);

    await processor.process(sweepJob);

    expect({
      sweep: recovery.sweep.mock.calls.length,
      recover: recovery.recoverQueryFailed.mock.calls.length,
    }).toEqual({ sweep: 0, recover: 0 });
  });
});
