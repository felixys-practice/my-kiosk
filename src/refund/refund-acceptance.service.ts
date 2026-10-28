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
import {
  AcceptedRefundInput,
  CustomerRefundTarget,
  RefundRepository,
} from './refund.repository';
import { TransactionClient } from 'src/prisma/prisma.service';
import { RefundLockingRepository } from './refund-locking.repository';
import {
  IdempotentResult,
  RefundIdempotencyService,
} from './refund-idempotency.service';
import { RefundActor } from './refund-access.service';
import { RefundDispatchService } from './refund-dispatch.service';
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

/** 커밋 뒤 보낼 최초 PG 취소 요청과 그 전송 담당 */
export type PendingSend = {
  paymentCancelId: string;
  amount: number;
  claimToken: string; // 확정 트랜잭션이 저장한 전송 담당 토큰
  sentAt: Date; // 확정 트랜잭션이 저장한 전송 시도 시각
};

/** 환불 접수 응답 본문 (API 계약 §3 일부) */
export type RefundAcceptance = {
  refundId: string;
  decisionStatus: string;
  ticketId: string;
  amount: number;
  payoutStatus: string;
  paymentCancelId: string | null; // 현재 PG 취소 요청, 0원 환불이면 null
  actionCode?: string | null; // 미지급 조치 사유(전송 전 실패·PG 거절 등), 없으면 null
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
    private readonly dispatchService: RefundDispatchService,
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
    let accepted: PendingSend | undefined;
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

        const confirmed = await this.confirmAcceptedRefund(
          {
            ticketId: command.ticketId,
            paymentId: target!.paymentId,
            orderItemId: target!.orderItemId,
            orderId: target!.orderId,
            shopId: target!.shopId,
            source: RefundSource.CUSTOMER,
            amount: decision.amount,
            requestedById: actor.userId,
            now,
          },
          tx,
        );
        accepted = confirmed.pending;
        return confirmed.result;
      },
    );

    // PG 전송은 커밋 뒤에만 하고, 전송 결과를 응답과 멱등 기록에 반영한다
    if (!accepted) return result;
    return this.sendAccepted(accepted, result, {
      requesterId: actor.userId,
      operation: 'CUSTOMER_REFUND',
      key: command.idempotencyKey,
    });
  }

  /**
   * 커밋된 환불의 최초 PG 취소 요청을 보내고 결과를 응답·멱등 기록에 반영한다(고객·매장 공통)
   * @param pending 커밋 뒤 보낼 PG 취소 요청과 그 전송 담당
   * @param result 확정 트랜잭션이 만든 접수 응답
   * @param scope 멱등 기록 범위(키 없으면 기록 갱신 없음)
   * @returns 전송 결과(지급 상태·조치 사유)를 반영한 접수 응답
   */
  async sendAccepted(
    pending: PendingSend,
    result: IdempotentResult<RefundAcceptance>,
    scope: { requesterId: string; operation: string; key?: string },
  ): Promise<IdempotentResult<RefundAcceptance>> {
    const sendResult = await this.pgGateway.sendCancel({
      paymentCancelId: pending.paymentCancelId,
      amount: pending.amount,
    });
    const state = await this.dispatchService.recordSendResult(
      pending.paymentCancelId,
      pending.claimToken,
      pending.sentAt,
      sendResult,
    );
    // 이용 종료 완료와 미지급 상태를 구분해 응답한다(전송 전 실패·즉시 거절도 202 접수, API 계약 §4)
    const updated = {
      ...result,
      body: {
        ...result.body,
        payoutStatus: state.payoutStatus,
        actionCode: state.actionCode,
      },
    };
    // 멱등 키로 저장한 최초 응답도 같은 내용으로 바꾼다(키 없이 처리한 요청은 저장 응답이 없음)
    if (scope.key !== undefined) {
      await this.idempotencyService.replaceResponse(scope, updated);
    }
    return updated;
  }

  /**
   * 검증을 마친 환불을 확정한다(고객·매장 공통, API 계약 §4)
   * - 이용권 종료 → 진행 중 정지 닫기 → 고정석 해제 → 확정 환불과 최초 PG 취소 요청(0원은 지급 완료) 저장
   * - 호출하는 쪽의 트랜잭션 안에서 실행하며, PG 전송은 커밋 뒤 호출하는 쪽이 한다
   * @param input 이용권·대상·경로·금액·실행자·시각과 매장 환불의 사유·퇴실 정보
   * @param tx 확정 트랜잭션
   * @returns 멱등 기록에 저장할 응답과, 커밋 뒤 보낼 PG 취소 요청(0원이면 없음)
   */
  async confirmAcceptedRefund(
    input: AcceptedRefundInput & { ticketId: string },
    tx: TransactionClient,
  ): Promise<{
    result: IdempotentResult<RefundAcceptance>;
    pending?: PendingSend;
  }> {
    const { ticketId, ...refundInput } = input;
    const { now } = input;
    // 이용권을 종료한다
    await this.refundRepository.terminateTicket(ticketId, now, tx);
    // 진행 중이던 정지 기록을 재개 없이 닫는다
    await this.refundRepository.closeOpenPausesForRefund(ticketId, now, tx);
    // 고정석 배정을 해제한다(자유석이면 할 일 없음)
    await this.seatAssignmentService.releaseByTicket(
      ticketId,
      SeatReleaseReason.TICKET_REVOKED,
      now,
      tx,
    );
    // 확정된 환불과 최초 PG 취소 요청을 저장한다. 양수는 커밋 뒤 바로 보낼 전송 기록(시도·시각·담당)도 함께 저장한다
    const sendClaim =
      input.amount > 0 ? this.dispatchService.newSendClaim(now) : undefined;
    const created = await this.refundRepository.createAcceptedRefund(
      { ...refundInput, sendClaim },
      tx,
    );
    // 양수는 202 접수·지급 처리 중, 0원은 PG 요청 없이 200 지급 완료(API 계약 §4)
    const isZero = created.paymentCancelId === null;
    return {
      pending: isZero
        ? undefined
        : {
            paymentCancelId: created.paymentCancelId!,
            amount: input.amount,
            claimToken: sendClaim!.claimToken,
            sentAt: now,
          },
      result: {
        status: isZero ? 200 : 202,
        refundId: created.refundId,
        body: {
          refundId: created.refundId,
          decisionStatus: RefundDecisionStatus.ACCEPTED,
          ticketId,
          amount: input.amount,
          payoutStatus: isZero
            ? RefundPayoutStatus.PAID
            : RefundPayoutStatus.PENDING,
          paymentCancelId: created.paymentCancelId,
          acceptedAt: now.toISOString(),
          terminatedAt: now.toISOString(),
        },
      },
    };
  }

  /**
   * 공유 잠금 순서로 대상 행을 잠근 뒤 판정에 쓸 대상을 다시 읽는다
   * - 같은 이용권의 동시 신청은 잠금을 기다린 뒤 먼저 커밋된 확정 환불을 보고 판정한다
   * @param ticketId 이용권 ID
   * @param tx 확정 트랜잭션
   * @returns 잠근 뒤 읽은 대상, 이용권이 없으면 null
   */
  async findLockedTarget(
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
