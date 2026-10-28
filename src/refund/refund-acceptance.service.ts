import { Inject, Injectable } from '@nestjs/common';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import type { RefundPgGateway } from 'src/pg/refund-pg.gateway';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { RefundRepository } from './refund.repository';
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
    return this.idempotencyService.execute(
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
        const target = await this.refundRepository.findCustomerRefundTarget(
          command.ticketId,
          tx,
        );
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
        return Promise.reject(new Error('미구현'));
      },
    );
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
