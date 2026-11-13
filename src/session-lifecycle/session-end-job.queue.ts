import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * 세션 자동 종료(expire-session) 지연 작업 큐
 * - 세션을 다른 경로(환불 퇴실 등)로 먼저 종료했을 때 남은 지연 작업을 지운다
 * - 지우지 못해도 처리기는 이미 종료된 세션을 다시 종료하지 않는다(endSession 멱등)
 */
@Injectable()
export class SessionEndJobQueue {
  constructor(
    @InjectQueue('usage-session')
    private readonly jobQueue: Queue<{ sessionId: string }>,
  ) {}

  /**
   * 세션 종료 지연 작업을 지운다
   * @param jobId BullMQ 작업 ID
   * @returns 작업이 있어 지웠으면 true, 이미 없으면 false
   */
  async remove(jobId: string): Promise<boolean> {
    const job = await this.jobQueue.getJob(jobId);
    if (!job) return false;
    await job.remove();
    return true;
  }
}
