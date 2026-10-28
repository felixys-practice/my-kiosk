import { Injectable } from '@nestjs/common';
import { TransactionClient } from 'src/prisma/prisma.service';
import { RefundAccessService, RefundActor } from './refund-access.service';
import {
  IdempotentResult,
  RefundIdempotencyService,
} from './refund-idempotency.service';
import { RefundLockingRepository } from './refund-locking.repository';
import { RefundRepository } from './refund.repository';
import { RefundOperationsRepository } from './refund-operations.repository';
import {
  evaluateManualReservation,
  ManualReservationRejection,
} from './refund-manual-payout.policy';
import {
  IdempotencyKeyRequiredError,
  RefundNotFoundError,
  RefundOutstandingAmountMismatchError,
  RefundPayoutNotActionableError,
  RefundPayoutUnresolvedError,
} from './errors';

/** 별도 환불금 지급 예약 요청 */
export type ManualReservationCommand = {
  amount: number; // 예약 금액(현재 미지급액과 같아야 한다)
  reason: string; // DTO에서 앞뒤 공백을 지운 사유
  idempotencyKey?: string;
};

/** 별도 환불금 지급 예약 응답 (API 계약 §5) */
export type ManualReservationResponse = {
  refundId: string;
  payoutId: string;
  status: 'RESERVED';
  amount: number;
};

/**
 * 미지급 환불금의 운영 처리 서비스 (API 계약 §5, MANAGER 전용)
 * - 별도 환불금 지급 예약·지급 결과 등록·미지급 확인·초과 취소 검토
 * - 모든 변경은 멱등 키가 필수이고, Refund를 잠근 뒤 지급 상태를 다시 확인한다
 */
@Injectable()
export class RefundOperationsService {
  constructor(
    private readonly accessService: RefundAccessService,
    private readonly idempotencyService: RefundIdempotencyService,
    private readonly lockingRepository: RefundLockingRepository,
    private readonly refundRepository: RefundRepository,
    private readonly operationsRepository: RefundOperationsRepository,
  ) {}

  /**
   * 별도 환불금 지급을 예약한다(실제 송금은 하지 않는다)
   * @param actor 요청한 운영자
   * @param refundId 환불
   * @param command 금액·사유·멱등 키
   * @returns 201 예약 응답(같은 키·같은 내용이면 최초 응답)
   * @throws RefundForbiddenError MANAGER가 아닐 때(403)
   * @throws IdempotencyKeyRequiredError 멱등 키가 없을 때(400)
   * @throws RefundNotFoundError 없는 환불(404)
   */
  async reserveManualPayout(
    actor: RefundActor,
    refundId: string,
    command: ManualReservationCommand,
  ): Promise<IdempotentResult<ManualReservationResponse>> {
    const idempotencyKey = await this.assertOperationRequest(
      actor,
      refundId,
      command.idempotencyKey,
    );
    return this.idempotencyService.execute<ManualReservationResponse>(
      {
        requesterId: actor.userId,
        operation: 'MANUAL_PAYOUT_RESERVE',
        key: idempotencyKey,
        request: { refundId, amount: command.amount, reason: command.reason },
        authorize: () => Promise.resolve(),
      },
      async (tx) => {
        const now = new Date();
        // Refund 잠금 뒤 다시 읽은 지급 상태로 판정한다(PG 재시도·다른 예약과의 교차 지급 차단)
        const target = await this.lockPayoutTarget(tx, refundId);
        const decision = evaluateManualReservation(
          target.state,
          command.amount,
          now,
        );
        if (!decision.allowed) throw reservationRejectionError(decision.code);
        const payoutId = await this.operationsRepository.createReservation(tx, {
          refundId,
          amount: decision.outstandingAmount,
          reservedById: actor.userId,
          reason: command.reason,
          now,
        });
        return {
          status: 201,
          refundId,
          body: {
            refundId,
            payoutId,
            status: 'RESERVED',
            amount: decision.outstandingAmount,
          },
        };
      },
    );
  }

  /**
   * 운영 변경 요청의 공통 사전 확인(역할 → 멱등 키 → 환불 존재)
   * @param actor 요청자
   * @param refundId 환불
   * @param idempotencyKey 멱등 키
   * @returns 확인한 멱등 키
   */
  private async assertOperationRequest(
    actor: RefundActor,
    refundId: string,
    idempotencyKey: string | undefined,
  ): Promise<string> {
    this.accessService.assertOperator(actor);
    if (idempotencyKey === undefined) throw new IdempotencyKeyRequiredError();
    if (!(await this.refundRepository.findPayoutRetryTarget(refundId))) {
      throw new RefundNotFoundError();
    }
    return idempotencyKey;
  }

  /**
   * Refund → PG 취소 요청 → 별도 지급 순서로 잠근 뒤 지급 상태를 다시 읽는다
   * @param tx 트랜잭션
   * @param refundId 환불
   * @returns 잠근 뒤 읽은 지급 상태
   */
  private async lockPayoutTarget(tx: TransactionClient, refundId: string) {
    const unlocked = (await this.refundRepository.findPayoutRetryTarget(
      refundId,
      tx,
    ))!;
    await this.lockingRepository.lockForPayout(tx, {
      refundId,
      paymentCancelIds: unlocked.paymentCancelIds,
      manualRefundPayoutIds: unlocked.manualRefundPayoutIds,
    });
    return (await this.refundRepository.findPayoutRetryTarget(refundId, tx))!;
  }
}

/**
 * 예약 판정 거절을 계약 오류로 바꾼다 (API 계약 §10)
 * @param code 거절 코드
 * @returns 도메인 오류
 */
function reservationRejectionError(code: ManualReservationRejection): Error {
  if (code === 'REFUND_PAYOUT_UNRESOLVED') {
    return new RefundPayoutUnresolvedError();
  }
  if (code === 'REFUND_OUTSTANDING_AMOUNT_MISMATCH') {
    return new RefundOutstandingAmountMismatchError();
  }
  return new RefundPayoutNotActionableError();
}
