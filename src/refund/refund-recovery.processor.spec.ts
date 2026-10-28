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

  it('정기 탐색 작업은 예정 조회 탐색과 장애 복구 확인을 실행하고, 장애 복구는 탐색 시각 이후로 시작한다', async () => {
    const { processor, recovery } = processorWith(true);

    await processor.process(sweepJob);

    const [[sweptAt]] = recovery.sweep.mock.calls as Date[][];
    const [[recoveredAt]] = recovery.recoverQueryFailed.mock.calls as Date[][];
    expect({
      sweptAt: sweptAt instanceof Date,
      recoveredAfterSweep: recoveredAt.getTime() >= sweptAt.getTime(),
    }).toEqual({ sweptAt: true, recoveredAfterSweep: true });
  });

  it('장애 복구 확인은 탐색이 끝난 뒤의 현재 시각으로 시작한다(탐색에 걸린 시간만큼 늦다)', async () => {
    const { processor, recovery } = processorWith(true);
    // 정기 탐색이 50ms 걸린다
    recovery.sweep.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 50)),
    );

    await processor.process(sweepJob);

    const [[sweptAt]] = recovery.sweep.mock.calls as Date[][];
    const [[recoveredAt]] = recovery.recoverQueryFailed.mock.calls as Date[][];
    expect(recoveredAt.getTime() - sweptAt.getTime()).toBeGreaterThanOrEqual(
      45,
    );
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
