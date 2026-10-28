import { Inject, Injectable } from '@nestjs/common';
import {
  RefundDecisionStatus,
  RefundPayoutStatus,
  RefundSource,
  SeatReleaseReason,
  UserRole,
} from '@prisma/client';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import type { RefundPgGateway } from 'src/pg/refund-pg.gateway';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { CustomerRefundTarget, RefundRepository } from './refund.repository';
import { TransactionClient } from 'src/prisma/prisma.service';
import { RefundLockingRepository } from './refund-locking.repository';
import {
  IdempotentResult,
  RefundIdempotencyService,
} from './refund-idempotency.service';
import { RefundActor } from './refund-access.service';
import {
  CustomerRefundDecision,
  evaluateCustomerRefund,
} from './refund-policy';
import {
  RefundForbiddenError,
  RefundNotEligibleError,
  RefundTerminationConsentRequiredError,
  TicketNotFoundError,
} from './errors';

/** 고객 환불 신청 */
export type CustomerRefundCommand = {
  ticketId: string;
  consentToTerminateTicket?: boolean;
  idempotencyKey?: string;
};

/** 환불 접수 응답 본문 (API 계약 §3 일부) */
export type RefundAcceptance = {
  refundId: string;
  decisionStatus: string;
  ticketId: string;
  amount: number;
  payoutStatus: string;
  paymentCancelId: string;
  acceptedAt: string;
  terminatedAt: string;
};

/**
 * 환불 확정(이용 종료·금액 확정) 서비스
 * - 검증·동의 확인 → 같은 트랜잭션에서 이용권 종료·정지 종료·좌석 해제·환불·최초 PG 취소 요청 저장
 * - PG 전송은 커밋 뒤에만 한다
 */
@Injectable()
export class RefundAcceptanceService {
  constructor(
    private readonly refundRepository: RefundRepository,
    private readonly lockingRepository: RefundLockingRepository,
    private readonly seatAssignmentService: SeatAssignmentService,
    private readonly idempotencyService: RefundIdempotencyService,
    @Inject(REFUND_PG_GATEWAY) private readonly pgGateway: RefundPgGateway,
  ) {}

  /**
   * 고객 본인 이용권의 환불을 확정한다 (API 계약 §4 고객: POST /refund)
   * @param actor 신청한 고객
   * @param command 이용권·종료 동의·멱등 키
   * @returns 202 접수 응답
   */
  async acceptCustomerRefund(
    actor: RefundActor,
    command: CustomerRefundCommand,
  ): Promise<IdempotentResult<RefundAcceptance>> {
    // 고객 환불은 USER만 신청한다(API 계약 §2). 저장된 응답을 재생할 때도 같은 확인을 거친다
    assertCustomerRole(actor);

    // 이번 요청이 실제로 확정한 PG 취소 요청(저장된 응답을 재생한 경우는 없음)
    let accepted: { paymentCancelId: string; amount: number } | undefined;
    const result = await this.idempotencyService.execute(
      {
        requesterId: actor.userId,
        operation: 'CUSTOMER_REFUND',
        key: command.idempotencyKey,
        request: {
          ticketId: command.ticketId,
          consentToTerminateTicket: command.consentToTerminateTicket ?? null,
        },
        authorize: () => Promise.resolve(),
      },
      async (tx) => {
        // 대상 판정(본인 범위 → 결제 → 기존 환불 → 사용·기한)
        const now = new Date();
        const target = await this.findLockedTarget(command.ticketId, tx);
        const decision = evaluateCustomerRefund(
          target?.candidate ?? null,
          actor.userId,
          now,
        );
        if (!decision.eligible) {
          throw rejectionError(decision);
        }

        // 대상 판정을 모두 통과한 뒤 종료 동의를 확인한다(API 계약 §4 확인 순서)
        if (command.consentToTerminateTicket !== true) {
          throw new RefundTerminationConsentRequiredError();
        }

        // 이용권을 종료한다
        await this.refundRepository.terminateTicket(command.ticketId, now, tx);
        // 진행 중이던 정지 기록을 재개 없이 닫는다
        await this.refundRepository.closeOpenPausesForRefund(
          command.ticketId,
          now,
          tx,
        );

        // 고정석 배정을 해제한다(자유석이면 할 일 없음)
        await this.seatAssignmentService.releaseByTicket(
          command.ticketId,
          SeatReleaseReason.TICKET_REVOKED,
          now,
          tx,
        );

        // 확정된 환불과 최초 PG 취소 요청을 저장한다
        const created = await this.refundRepository.createAcceptedRefund(
          {
            paymentId: target!.paymentId,
            orderItemId: target!.orderItemId,
            source: RefundSource.CUSTOMER,
            amount: decision.amount,
            requestedById: actor.userId,
            now,
          },
          tx,
        );
        accepted = {
          paymentCancelId: created.paymentCancelId,
          amount: decision.amount,
        };
        return {
          status: 202,
          refundId: created.refundId,
          body: {
            refundId: created.refundId,
            decisionStatus: RefundDecisionStatus.ACCEPTED,
            ticketId: command.ticketId,
            amount: decision.amount,
            payoutStatus: RefundPayoutStatus.PENDING,
            paymentCancelId: created.paymentCancelId,
            acceptedAt: now.toISOString(),
            terminatedAt: now.toISOString(),
          },
        };
      },
    );

    // PG 전송은 커밋 뒤에만 한다. 전송 결과 저장은 PG 처리 흐름(US5)에서 한다
    if (accepted) {
      await this.pgGateway.sendCancel(accepted);
    }
    return result;
  }

  /**
   * 공유 잠금 순서로 대상 행을 잠근 뒤 판정에 쓸 대상을 다시 읽는다
   * - 같은 이용권의 동시 신청은 잠금을 기다린 뒤 먼저 커밋된 확정 환불을 보고 판정한다
   * @param ticketId 이용권 ID
   * @param tx 확정 트랜잭션
   * @returns 잠근 뒤 읽은 대상, 이용권이 없으면 null
   */
  private async findLockedTarget(
    ticketId: string,
    tx: TransactionClient,
  ): Promise<CustomerRefundTarget | null> {
    const unlocked = await this.refundRepository.findCustomerRefundTarget(
      ticketId,
      tx,
    );
    if (!unlocked) return null;
    await this.lockingRepository.lockForAcceptance(tx, unlocked.lockTargets);
    return this.refundRepository.findCustomerRefundTarget(ticketId, tx);
  }
}

/**
 * 판정 거절을 계약 코드의 도메인 오류로 바꾼다
 * @param decision 거절 판정
 * @returns 본인 범위 밖이면 404 TicketNotFoundError, 그 밖은 409 RefundNotEligibleError
 */
function rejectionError(
  decision: Extract<CustomerRefundDecision, { eligible: false }>,
): Error {
  if (decision.code === 'TICKET_NOT_FOUND') return new TicketNotFoundError();
  return new RefundNotEligibleError(
    decision.code,
    decision.violations
      ? { violations: decision.violations, action: decision.action }
      : undefined,
  );
}

/**
 * 고객 환불을 신청할 수 있는 역할인지 확인한다
 * @param actor 신청한 사용자
 * @throws RefundForbiddenError USER가 아닐 때(403)
 */
function assertCustomerRole(actor: RefundActor): void {
  if (actor.role !== UserRole.USER) throw new RefundForbiddenError();
}
