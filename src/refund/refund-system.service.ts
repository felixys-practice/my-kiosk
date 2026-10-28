import { Injectable } from '@nestjs/common';
import { RefundSource } from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';
import {
  PendingSend,
  RefundAcceptanceService,
} from './refund-acceptance.service';
import { RefundDispatchService } from './refund-dispatch.service';
import { RefundRepository } from './refund.repository';

/**
 * 시스템 자동 취소 환불 서비스 (US6, API 계약 §7)
 * - 결제 콜백 처리 트랜잭션 안에서 환불 확정과 최초 PG 취소 요청을 저장하고, 커밋 뒤 보낸다
 */
@Injectable()
export class RefundSystemService {
  constructor(
    private readonly refundRepository: RefundRepository,
    private readonly dispatchService: RefundDispatchService,
    private readonly acceptanceService: RefundAcceptanceService,
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
   * 승인 처리 중 좌석을 배정하지 못한 이용권의 상품 대상 시스템 환불을 확정한다(호출자의 트랜잭션 안에서)
   * @param tx 결제 승인 트랜잭션
   * @param input 결제·주문 항목·이용권·시각
   * @returns 커밋 뒤 보낼 최초 PG 취소 요청
   */
  async acceptSeatAssignmentFailure(
    tx: TransactionClient,
    input: {
      paymentId: string;
      orderItemId: string;
      ticketId: string;
      now: Date;
    },
  ): Promise<PendingSend | undefined> {
    // 같은 트랜잭션에서 방금 발행한 이용권을 공유 잠금 순서로 잠그고 대상(결제·주문 항목·실결제액)을 읽는다
    const target = (await this.acceptanceService.findLockedTarget(
      input.ticketId,
      tx,
    ))!;
    // 이용 종료·좌석 배정 해제·상품 대상 시스템 환불(실결제액 전액)·최초 PG 취소 요청을 함께 저장한다
    const confirmed = await this.acceptanceService.confirmAcceptedRefund(
      {
        ticketId: input.ticketId,
        paymentId: target.paymentId,
        orderItemId: target.orderItemId,
        orderId: target.orderId,
        shopId: target.shopId,
        source: RefundSource.SYSTEM,
        amount: target.candidate.paidAmount,
        requestedById: null,
        now: input.now,
      },
      tx,
    );
    return confirmed.pending;
  }

  /**
   * 확정한 시스템 환불의 최초 PG 취소 요청을 커밋 뒤 보낸다
   * - 전송 중 오류는 호출자에게 그대로 알린다. 저장한 전송 기록·담당 기한으로 자동 조회가 이어받는다
   * @param pending 보낼 PG 취소 요청
   */
  async sendAfterCommit(pending: PendingSend): Promise<void> {
    await this.dispatchService.sendPrepared(pending);
  }
}
