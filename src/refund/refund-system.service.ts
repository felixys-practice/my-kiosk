import { Injectable, Logger } from '@nestjs/common';
import { TransactionClient } from 'src/prisma/prisma.service';
import { PendingSend } from './refund-acceptance.service';
import { RefundDispatchService } from './refund-dispatch.service';
import { RefundRepository } from './refund.repository';

/**
 * 시스템 자동 취소 환불 서비스 (US6, API 계약 §7)
 * - 결제 콜백 처리 트랜잭션 안에서 환불 확정과 최초 PG 취소 요청을 저장하고, 커밋 뒤 보낸다
 */
@Injectable()
export class RefundSystemService {
  private readonly logger = new Logger(RefundSystemService.name);

  constructor(
    private readonly refundRepository: RefundRepository,
    private readonly dispatchService: RefundDispatchService,
  ) {}

  /**
   * 승인 금액 불일치 결제의 결제 전체 대상 시스템 환불을 확정한다(호출자의 트랜잭션 안에서)
   * - 확정된 환불 금액은 PG가 승인한 금액 전액이다. 이용권이 없으므로 이용 종료 시각은 없다
   * @param tx 결제 콜백 처리 트랜잭션(Payment 잠금 뒤)
   * @param input 결제·실제 승인액·시각
   * @returns 커밋 뒤 보낼 최초 PG 취소 요청
   */
  async acceptPaymentMismatch(
    tx: TransactionClient,
    input: { paymentId: string; approvedAmount: number; now: Date },
  ): Promise<PendingSend | undefined> {
    const sendClaim = this.dispatchService.newSendClaim(input.now);
    const created = await this.refundRepository.createPaymentTargetRefund(tx, {
      paymentId: input.paymentId,
      amount: input.approvedAmount,
      now: input.now,
      sendClaim,
    });
    return {
      paymentCancelId: created.paymentCancelId,
      amount: input.approvedAmount,
      claimToken: sendClaim.claimToken,
      sentAt: input.now,
    };
  }

  /**
   * 확정한 시스템 환불의 최초 PG 취소 요청을 커밋 뒤 보낸다
   * - 전송 중 오류가 나도 콜백 수신 확인은 유지한다. 저장한 전송 기록·담당 기한으로 자동 조회가 이어받는다
   * @param pending 보낼 PG 취소 요청
   */
  async sendAfterCommit(pending: PendingSend): Promise<void> {
    try {
      await this.dispatchService.sendPrepared(pending);
    } catch (error) {
      this.logger.warn(
        `시스템 자동 취소의 PG 전송을 마치지 못했습니다(자동 조회로 이어감): ${pending.paymentCancelId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
