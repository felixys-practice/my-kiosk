import { Inject, Injectable } from '@nestjs/common';
import { RefundSource, UserRole } from '@prisma/client';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import type { RefundPgGateway } from 'src/pg/refund-pg.gateway';
import { SessionLifecycleService } from 'src/session-lifecycle/session-lifecycle.service';
import { RefundAccessService, RefundActor } from './refund-access.service';
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
  RefundInputRejectedError,
  RefundNotEligibleError,
  RefundTerminationConsentRequiredError,
  TicketInUseError,
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
    private readonly accessService: RefundAccessService,
    private readonly acceptanceService: RefundAcceptanceService,
    private readonly idempotencyService: RefundIdempotencyService,
    private readonly sessionLifecycleService: SessionLifecycleService,
    @Inject(REFUND_PG_GATEWAY) private readonly pgGateway: RefundPgGateway,
  ) {}

  /**
   * 매장 환불을 확정한다
   * @param actor 요청한 점주
   * @param shopId 요청 매장
   * @param command 이용권·금액·사유·동의·멱등 키
   * @returns 접수 응답(양수 202, 0원 200)
   * @throws RefundForbiddenError OWNER가 아닐 때(403)
   * @throws ShopNotFoundError 요청 매장의 현재 점주가 아닐 때(404)
   */
  async acceptStoreRefund(
    actor: RefundActor,
    shopId: string,
    command: StoreRefundCommand,
  ): Promise<IdempotentResult<RefundAcceptance>> {
    // 새 매장 환불은 OWNER만 요청한다(MANAGER도 거절, API 계약 §2·FR-050)
    if (actor.role !== UserRole.OWNER) throw new RefundForbiddenError();
    // 지금 이 매장의 점주여야 한다. 같은 키 재응답에도 먼저 확인한다(범위 밖은 404)
    await this.accessService.assertShopScope(actor, shopId);

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
          throw storeRejectionError(decision.code);
        }

        // 판정을 모두 통과한 뒤 종료 동의를 확인한다
        if (command.consentToTerminateTicket !== true) {
          throw new RefundTerminationConsentRequiredError();
        }
        // 지금 이용 중이면 퇴실 동의가 있어야 한다(금액·사유 검증은 이미 끝났으므로 거절해도 퇴실하지 않음)
        if (
          target!.candidate.ticket.inUse &&
          command.consentToEndSession !== true
        ) {
          throw new TicketInUseError();
        }
        // 모든 검증을 통과했으므로 이용 중이면 퇴실시킨다(기존 퇴실 규칙: 시간권은 퇴실 시각까지 사용 시간 차감)
        let endedSessionId: string | undefined;
        if (target!.candidate.ticket.inUse) {
          endedSessionId = target!.lockTargets.usageSessionIds[0];
          await this.sessionLifecycleService.endSession(
            endedSessionId,
            now,
            tx,
          );
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
            endedSessionId,
            exitConsentedAt: endedSessionId ? now : undefined,
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

/** 점주 입력(금액·사유) 규칙 위반 코드 */
const storeInputRejections: readonly string[] = [
  'REFUND_AMOUNT_EXCEEDED',
  'UNUSED_TICKET_FULL_REFUND_REQUIRED',
  'REFUND_REASON_REQUIRED',
];

/**
 * 매장 환불 판정 거절을 계약 오류로 바꾼다 (API 계약 §10)
 * @param code 판정 거절 코드
 * @returns 계약 코드를 가진 도메인 오류
 */
export function storeRejectionError(code: string): Error {
  if (code === 'TICKET_NOT_FOUND') return new TicketNotFoundError();
  // 금액·사유 입력 규칙 위반은 400, 대상 여부 규칙(결제·기존 환불)은 409
  if (storeInputRejections.includes(code)) {
    return new RefundInputRejectedError(code);
  }
  return new RefundNotEligibleError(code);
}
