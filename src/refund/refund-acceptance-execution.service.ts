import { RefundIdempotencyStatus } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import { TransactionClient } from 'src/prisma/prisma.service';
import { REFUND_PG_GATEWAY } from 'src/pg/refund-pg.gateway';
import type { RefundPgGateway } from 'src/pg/refund-pg.gateway';
import type {
  PendingSend,
  RefundAcceptance,
} from './refund-acceptance.service';
import {
  IdempotentCommand,
  IdempotentResult,
  RefundIdempotencyService,
} from './refund-idempotency.service';
import {
  IdempotencyScope,
  RefundIdempotencyRepository,
} from './refund-idempotency.repository';
import { RefundRepository } from './refund.repository';
import { RefundDispatchService } from './refund-dispatch.service';
import { IdempotencyRequestInProgressError } from './errors';

/** 검증과 환불 확정을 같은 트랜잭션에서 마친 결과 */
export type ConfirmedRefundAcceptance = {
  result: IdempotentResult<RefundAcceptance> & { refundId: string };
  pending?: PendingSend;
};

/** 고객·점주 환불 접수: 확정 커밋 → 최초 PG 전송 → 최초 응답 저장. 중단 시 확정된 환불로 응답을 복구한다. */
@Injectable()
export class RefundAcceptanceExecutionService {
  constructor(
    private readonly idempotencyService: RefundIdempotencyService,
    private readonly idempotencyRepository: RefundIdempotencyRepository,
    private readonly refundRepository: RefundRepository,
    @Inject(REFUND_PG_GATEWAY) private readonly pgGateway: RefundPgGateway,
    private readonly dispatchService: RefundDispatchService,
  ) {}

  async executeAcceptance(
    command: IdempotentCommand & {
      operation: 'CUSTOMER_REFUND' | 'STORE_REFUND';
    },
    confirmRefund: (
      tx: TransactionClient,
    ) => Promise<ConfirmedRefundAcceptance>,
  ): Promise<IdempotentResult<RefundAcceptance>> {
    const acquired =
      await this.idempotencyService.acquire<RefundAcceptance>(command);
    if (acquired.kind === 'replay') return acquired.response;
    if (acquired.kind === 'without-key') {
      // prettier-ignore
      const confirmed = await this.idempotencyRepository.runInTransaction(confirmRefund);
      return confirmed.pending
        ? this.sendAccepted(confirmed.pending, confirmed.result)
        : confirmed.result;
    }
    const { scope, id, claimToken } = acquired.claim;
    // 이전 요청이 멱등 기록 행을 잠근 채 환불을 확정 중이면, 이어받기는 그 트랜잭션이 끝날 때까지 기다린다.
    // 대기 중 환불 확정이 커밋됐을 수 있으므로 담당을 확보한 뒤 기록을 다시 읽어 환불을 중복 확정하지 않는다.
    const current = await this.idempotencyRepository.find(scope);
    if (current?.refundId) {
      const response = await this.makeAcceptanceResponse(current.refundId);
      // PG 전송 없이 접수 응답을 저장하고, 미확정 PG 취소 요청은 복구 워커가 조회·처리한다.
      return this.completeOrReplay(scope, id, claimToken, response);
    }

    let confirmedRefund: ConfirmedRefundAcceptance;
    try {
      confirmedRefund = await this.idempotencyRepository.runInTransaction(
        async (tx) => {
          if (
            !(await this.idempotencyRepository.lockClaimedRecordInTransaction(
              tx,
              id,
              claimToken,
            ))
          ) {
            throw new IdempotencyRequestInProgressError();
          }
          const accepted = await confirmRefund(tx);
          await this.idempotencyRepository.updateConfirmedRefundIdInTransaction(
            tx,
            id,
            claimToken,
            accepted.result.refundId,
          );
          return accepted;
        },
      );
    } catch (error) {
      await this.idempotencyRepository.remove(id, claimToken);
      throw error;
    }
    // 환불 확정 트랜잭션이 DB에 저장된 뒤 PG 전송·결과 반영·응답 저장 중 실패해도 멱등 기록을 지우지 않는다.
    // 이미 환불이 확정됐으므로 기한이 지난 재요청은 refundId로 이미 확정된 환불 금액과 최신 지급 정보를 읽어 응답을 복구한다.
    const response = confirmedRefund.pending
      ? await this.sendAccepted(confirmedRefund.pending, confirmedRefund.result)
      : confirmedRefund.result;
    return this.completeOrReplay(scope, id, claimToken, response);
  }

  /**
   * PG 전송 결과를 반영한 응답을 멱등 record에 저장하고 완료로 표시한다. 그 사이 담당을 잃었으면 자기 응답을 확정하지 않는다
   * - 이어받은 요청이 이미 최초 응답을 저장했으면 그 응답을 돌려준다(같은 키는 같은 최초 응답)
   * @param scope 요청자·기능·키
   * @param id 멱등성 record ID
   * @param claimToken 이 요청의 담당 토큰
   * @param response 이 요청이 만든 최종 응답
   * @returns 저장된 최초 응답
   * @throws IdempotencyRequestInProgressError 담당을 잃었고 이어받은 요청이 아직 처리 중일 때
   */
  private async completeOrReplay(
    scope: IdempotencyScope,
    id: string,
    claimToken: string,
    response: IdempotentResult<RefundAcceptance>,
  ): Promise<IdempotentResult<RefundAcceptance>> {
    if (
      await this.idempotencyRepository.saveResponseAndCompleteIdempotency(
        id,
        claimToken,
        response,
      )
    ) {
      return response;
    }
    const stored = await this.idempotencyRepository.find(scope);
    if (stored?.status !== RefundIdempotencyStatus.COMPLETED) {
      throw new IdempotencyRequestInProgressError();
    }
    return {
      status: stored.responseStatus!,
      body: stored.responseBody as RefundAcceptance,
    };
  }

  /**
   * DB에 저장된 환불의 최초 PG 취소 요청을 보내고 결과를 응답·멱등 기록에 반영한다(고객·매장 공통)
   * @param pending 환불 확정 트랜잭션이 저장한 PG 취소 요청과 전송 담당
   * @param result 확정 트랜잭션이 만든 접수 응답
   * @returns 전송 결과(지급 상태·조치 사유)를 반영한 접수 응답
   */
  async sendAccepted(
    pending: PendingSend,
    result: IdempotentResult<RefundAcceptance>,
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
    return updated;
  }

  /**
   * PG 전송 전에 중단된 요청을 이어받으면 이미 확정된 환불 금액과 최신 지급 정보를 조회해 접수 응답을 다시 만든다
   * @param refundId 확정된 환불
   * @returns 접수 응답(0원 지급 완료면 200, 그 밖 202)
   */
  async makeAcceptanceResponse(
    refundId: string,
  ): Promise<IdempotentResult<RefundAcceptance> & { refundId: string }> {
    const stored = await this.refundRepository.findAcceptanceSnapshot(refundId);
    const isZero = stored.amount === 0;
    return {
      status: isZero ? 200 : 202,
      refundId,
      body: {
        refundId,
        decisionStatus: stored.decisionStatus,
        ticketId: stored.ticketId,
        amount: stored.amount,
        payoutStatus: stored.payoutStatus,
        paymentCancelId: stored.paymentCancelId,
        actionCode: stored.actionCode,
        acceptedAt: stored.acceptedAt.toISOString(),
        terminatedAt: stored.terminatedAt.toISOString(),
      },
    };
  }
}
