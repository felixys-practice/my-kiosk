import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentCancelStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import type { RefundPgGateway } from 'src/pg/refund-pg.gateway';
import { PgCancelSendResult } from 'src/pg/pg.types';
import { RefundRepository } from './refund.repository';
import { RefundLockingRepository } from './refund-locking.repository';

/** PG 취소 요청 전송 결과 요약 */
export type DispatchOutcome = {
  sent: boolean; // 이번 호출이 실제로 PG에 보냈는지(담당을 얻지 못하면 false)
};

/** 전송·결과 반영을 할 수 있는 미확정 시도 상태 */
const sendableStatuses: readonly PaymentCancelStatus[] = [
  PaymentCancelStatus.REQUESTED,
  PaymentCancelStatus.QUERY_FAILED,
];

/**
 * PG 취소 요청 전송 서비스 (API 계약 §8, tasks T096)
 * - 전송 직전에 전송 시도 횟수·시각·담당 기한을 저장하고, PG 호출은 트랜잭션 밖에서 한다
 * - 전송 결과는 NOT_SENT·REJECTED면 시도 실패·조치 필요, ACCEPTED·UNKNOWN이면 조회 대기, SUCCEEDED면 공통 결과 처리
 */
@Injectable()
export class RefundDispatchService {
  constructor(
    private readonly refundRepository: RefundRepository,
    private readonly lockingRepository: RefundLockingRepository,
    private readonly configService: ConfigService,
    @Inject(REFUND_PG_GATEWAY) private readonly pgGateway: RefundPgGateway,
  ) {}

  /**
   * PG 취소 요청을 보낸다
   * @param paymentCancelId 보낼 PG 취소 요청
   * @returns 전송 결과 요약
   */
  async dispatch(paymentCancelId: string): Promise<DispatchOutcome> {
    const claimToken = randomUUID();
    const now = new Date();
    // 1. Refund → PaymentCancel을 잠그고 담당·전송 시도를 저장한 뒤 커밋한다
    const prepared = await this.refundRepository.runInTransaction(
      async (tx) => {
        const found = await this.refundRepository.findAttemptForResult(
          paymentCancelId,
          tx,
        );
        if (!found) return null;
        await this.lockingRepository.lockForPayout(tx, {
          refundId: found.refund.id,
          paymentCancelIds: [found.id],
          manualRefundPayoutIds: [],
        });
        const attempt = (await this.refundRepository.findAttemptForResult(
          paymentCancelId,
          tx,
        ))!;
        // 확정된 시도나 다른 작업자가 유효하게 맡은 시도는 보내지 않는다
        if (!sendableStatuses.includes(attempt.status)) return null;
        if (attempt.claimUntil && attempt.claimUntil > now) return null;
        await this.refundRepository.markSendStarted(tx, attempt.id, {
          claimToken,
          claimUntil: new Date(now.getTime() + this.seconds('workLease')),
          now,
        });
        return { amount: attempt.amount };
      },
    );
    if (!prepared) return { sent: false };

    // 2. PG 호출은 트랜잭션 밖에서 한다(PG 시도 ID를 멱등 키로 쓴다)
    const result = await this.pgGateway.sendCancel({
      paymentCancelId,
      amount: prepared.amount,
    });

    // 3. 전송 결과를 반영한다
    await this.applySendResult(paymentCancelId, claimToken, now, result);
    return { sent: true };
  }

  /**
   * 전송 결과를 반영한다
   * @param paymentCancelId PG 취소 요청
   * @param claimToken 전송을 맡은 담당 토큰
   * @param sentAt 전송 시도 시각
   * @param result PG 전송 결과
   */
  private async applySendResult(
    paymentCancelId: string,
    claimToken: string,
    sentAt: Date,
    result: PgCancelSendResult,
  ): Promise<void> {
    void result;
    // 결과를 아직 모르면 전송 시각부터 결과 대기 시간 뒤 첫 조회를 예약한다
    await this.refundRepository.scheduleInquiryAfterSend(
      paymentCancelId,
      claimToken,
      new Date(sentAt.getTime() + this.seconds('resultWait')),
    );
  }

  /**
   * 환불 운영 설정의 초 단위 값을 밀리초로 읽는다
   * @param key 설정 이름(refund.<key>Seconds)
   * @returns 밀리초
   */
  private seconds(key: 'workLease' | 'resultWait'): number {
    return this.configService.get<number>(`refund.${key}Seconds`)! * 1000;
  }
}
