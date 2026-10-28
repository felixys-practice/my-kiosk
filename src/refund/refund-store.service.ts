import { Inject, Injectable } from '@nestjs/common';
import { RefundSource, UserRole } from '@prisma/client';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import type { RefundPgGateway } from 'src/pg/refund-pg.gateway';
import { RefundActor } from './refund-access.service';
import {
  IdempotentResult,
  RefundIdempotencyService,
} from './refund-idempotency.service';
import {
  RefundAcceptance,
  RefundAcceptanceService,
} from './refund-acceptance.service';
import { evaluateStoreRefund } from './refund-policy';
import {
  RefundForbiddenError,
  RefundTerminationConsentRequiredError,
  TicketNotFoundError,
} from './errors';

/** 점주 매장 환불 요청 */
export type StoreRefundCommand = {
  ticketId: string;
  amount: number; // 원 단위 정수
  reason?: string; // DTO에서 앞뒤 공백을 지운 사유
  consentToTerminateTicket?: boolean;
  consentToEndSession?: boolean;
  idempotencyKey?: string;
};

/**
 * 점주 매장 환불 서비스 (API 계약 §4 매장: POST /refund/shop/:shopId)
 * - 현재 ShopOwner 범위의 이용권만 찾는다
 * - 금액·사유·동의 검증을 모두 통과한 뒤 한 트랜잭션에서 퇴실·이용 종료·좌석 해제·환불·최초 PG 취소 요청을 저장한다
 */
@Injectable()
export class RefundStoreService {
  constructor(
    private readonly acceptanceService: RefundAcceptanceService,
    private readonly idempotencyService: RefundIdempotencyService,
    @Inject(REFUND_PG_GATEWAY) private readonly pgGateway: RefundPgGateway,
  ) {}

  /**
   * 매장 환불을 확정한다
   * @param actor 요청한 점주
   * @param shopId 요청 매장
   * @param command 이용권·금액·사유·동의·멱등 키
   * @returns 접수 응답(양수 202, 0원 200)
   * @throws RefundForbiddenError OWNER가 아닐 때(403)
   */
  async acceptStoreRefund(
    actor: RefundActor,
    shopId: string,
    command: StoreRefundCommand,
  ): Promise<IdempotentResult<RefundAcceptance>> {
    // 새 매장 환불은 OWNER만 요청한다(MANAGER도 거절, API 계약 §2·FR-050)
    if (actor.role !== UserRole.OWNER) throw new RefundForbiddenError();

    // 이번 요청이 실제로 확정한 PG 취소 요청(저장된 응답을 재생한 경우는 없음)
    let pending: { paymentCancelId: string; amount: number } | undefined;
    const result = await this.idempotencyService.execute(
      {
        requesterId: actor.userId,
        operation: 'STORE_REFUND',
        key: command.idempotencyKey,
        request: {
          shopId,
          ticketId: command.ticketId,
          amount: command.amount,
          reason: command.reason ?? null,
          consentToTerminateTicket: command.consentToTerminateTicket ?? null,
          consentToEndSession: command.consentToEndSession ?? null,
        },
        authorize: () => Promise.resolve(),
      },
      async (tx) => {
        // 대상 판정(결제 → 기존 환불 → 금액 상한 → 전액 원칙·사유)
        const now = new Date();
        const target = await this.acceptanceService.findLockedTarget(
          command.ticketId,
          tx,
        );
        // 요청 매장의 주문이 아닌 이용권은 다른 매장에 있더라도 드러내지 않고 찾을 수 없음으로 본다
        const inShop = target !== null && target.shopId === shopId;
        const decision = evaluateStoreRefund(
          inShop ? target.candidate : null,
          { amount: command.amount, reason: command.reason },
          now,
        );
        if (!decision.eligible) {
          if (decision.code === 'TICKET_NOT_FOUND') {
            throw new TicketNotFoundError();
          }
          throw new Error(decision.code);
        }

        // 판정을 모두 통과한 뒤 종료 동의를 확인한다
        if (command.consentToTerminateTicket !== true) {
          throw new RefundTerminationConsentRequiredError();
        }

        // 이용권 종료·좌석 해제·확정 환불·최초 PG 취소 요청을 함께 저장한다
        const confirmed = await this.acceptanceService.confirmAcceptedRefund(
          {
            ticketId: command.ticketId,
            paymentId: target!.paymentId,
            orderItemId: target!.orderItemId,
            orderId: target!.orderId,
            shopId: target!.shopId,
            source: RefundSource.STORE,
            amount: decision.amount,
            reason: decision.reason ?? undefined,
            requestedById: actor.userId,
            now,
          },
          tx,
        );
        pending = confirmed.pending;
        return confirmed.result;
      },
    );

    // PG 전송은 커밋 뒤에만 한다
    if (pending) {
      await this.pgGateway.sendCancel(pending);
    }
    return result;
  }
}
