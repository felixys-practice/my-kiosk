import { activePauseWhere } from 'src/ticket/ticket-pause/active-pause';
import { Injectable } from '@nestjs/common';
import {
  RefundPayoutMethod,
  ManualRefundPayoutStatus,
  LedgerStatus,
  PaymentCancelFailureCode,
  PaymentCancelStatus,
  PaymentStatus,
  RefundDecisionStatus,
  RefundPayoutStatus,
  RefundSource,
  RefundTargetKind,
  SeatAssignmentStatus,
  TicketPauseCloseReason,
  TicketStatus,
  UsageSessionStatus,
} from '@prisma/client';
import { CustomerRefundCandidate } from './refund-policy';
import { AcceptanceLockTargets } from './refund-locking.repository';
import { PayoutRetryState } from './refund-retry.policy';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';
import { DomainConflictError } from 'src/common/errors';

/** 신규 환불 확정에 기록하는 정책 버전 */
export const refundPolicyVersion = 'v0.4';

/** 고객 환불 판정 후보와 잠글 행 */
export type CustomerRefundTarget = {
  candidate: CustomerRefundCandidate;
  lockTargets: AcceptanceLockTargets;
  paymentId: string;
  orderItemId: string;
  orderId: string; // 원래 주문(원장 기록용)
  shopId: string; // 원래 주문의 매장(원장 기록용)
};

/** PG 결과를 반영할 PG 취소 요청과 그 환불 */
export type AttemptForResult = {
  id: string;
  status: PaymentCancelStatus;
  claimToken: string | null;
  claimUntil: Date | null; // 담당 작업자의 처리 기한
  amount: number; // 이 PG 취소 요청으로 보낼 금액
  resendCount: number; // 백그라운드 자동 재전송 횟수
  inquiryFailureCount: number; // 연속 조회 오류 횟수
  lastSendAttemptAt: Date | null; // 마지막 전송 시도 시각
  lastInquiryAt: Date | null; // 마지막 조회 시작 시각
  actualAmount: number | null; // 성공으로 확정됐으면 PG 실제 취소액
  pgTransactionId: string | null; // 성공으로 확정됐으면 PG 취소 거래 ID
  refund: {
    id: string;
    amount: number; // 확정된 환불 금액(불변)
    paidAmount: number; // 지금까지 실제 지급 합계
    payoutStatus: RefundPayoutStatus;
    reviewRequired: boolean; // 운영자 검토가 끝나지 않았으면 true
    orderItemId: string | null; // 환불 대상 주문 상품(PAYMENT 대상이면 null)
    source: RefundSource; // 고객·매장·시스템 경로(알림 수신 범위를 정한다)
    customerId: string; // 원래 주문한 고객
    approvalTransactionId: string | null; // 원결제 승인 거래 ID(PG 취소 거래 ID와 달라야 한다)
    orderId: string;
    shopId: string;
  };
};

/** 환불 지급 상태 갱신 내용 */
export type RefundPayoutUpdate = {
  paidAmount?: number;
  payoutStatus?: RefundPayoutStatus;
  paidAt?: Date | null;
  reviewRequired?: boolean;
  actionCode?: string | null;
  actionReason?: string | null;
};

/** 확정할 환불 내용 */
export type AcceptedRefundInput = {
  paymentId: string;
  orderItemId: string;
  orderId: string;
  shopId: string;
  source: RefundSource;
  amount: number;
  requestedById: string;
  now: Date; // 신청·확정·종료·동의 시각
  reason?: string;
  exitConsentedAt?: Date;
  endedSessionId?: string;
  // 커밋 뒤 바로 보낼 최초 PG 취소 요청의 담당(전송 직전 기록을 확정과 함께 저장, API 계약 §8)
  sendClaim?: { claimToken: string; claimUntil: Date };
};

/** 개별 확인으로 새 요청을 보낼 수 있는 실패 사유 (API 계약 §8) */
const retryableFailureCodes: readonly PaymentCancelFailureCode[] = [
  PaymentCancelFailureCode.RETRY_EXHAUSTED,
  PaymentCancelFailureCode.SEND_FAILED,
  PaymentCancelFailureCode.PG_REJECTED,
];

/** PG 재시도 판정·저장 대상 */
export type PayoutRetryTarget = {
  state: PayoutRetryState;
  paymentId: string;
  orderItemId: string | null; // 새 요청의 대상 상품(환불과 같음, 결제 전체 대상이면 null)
  nextAttemptNumber: number;
  paymentCancelIds: string[]; // 잠글 PG 취소 요청
  manualRefundPayoutIds: string[]; // 잠글 별도 환불금 지급
};

@Injectable()
export class RefundRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 고객 환불 판정·확정에 필요한 이용권·결제·기존 환불과 잠글 행을 조회한다
   * @param ticketId 이용권 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 판정 후보와 잠글 행, 이용권이 없으면 null
   */
  async findCustomerRefundTarget(
    ticketId: string,
    tx: TransactionClient,
  ): Promise<CustomerRefundTarget | null> {
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        userId: true,
        type: true,
        activatedAt: true,
        activationDeadline: true,
        purchasedMinutes: true,
        remainingMinutes: true,
        minuteExpireDeadline: true,
        usageSessions: {
          where: { status: UsageSessionStatus.ACTIVE },
          select: { id: true },
        },
        ticketPauses: {
          where: activePauseWhere,
          select: { id: true },
        },
        seatAssignments: {
          where: { status: SeatAssignmentStatus.ACTIVE },
          select: { id: true },
        },
        orderItem: {
          select: {
            id: true,
            amount: true,
            refunds: { select: { decisionStatus: true, payoutStatus: true } },
            order: {
              select: {
                id: true,
                shopId: true,
                payments: {
                  select: { id: true, status: true },
                  orderBy: { createdAt: 'desc' },
                },
              },
            },
          },
        },
      },
    });
    if (!ticket) return null;

    // 원래 결제: 성공한 결제가 있으면 그것, 없으면 가장 최근 결제로 상태를 판정한다
    const payments = ticket.orderItem.order.payments;
    const payment =
      payments.find((p) => p.status === PaymentStatus.SUCCESS) ?? payments[0];
    if (!payment) return null;

    return {
      paymentId: payment.id,
      orderItemId: ticket.orderItem.id,
      orderId: ticket.orderItem.order.id,
      shopId: ticket.orderItem.order.shopId,
      lockTargets: {
        paymentId: payment.id,
        ticketId: ticket.id,
        ticketPauseIds: ticket.ticketPauses.map((pause) => pause.id),
        usageSessionIds: ticket.usageSessions.map((session) => session.id),
        seatAssignmentIds: ticket.seatAssignments.map((row) => row.id),
      },
      candidate: {
        ownerId: ticket.userId,
        paymentStatus: payment.status,
        paidAmount: ticket.orderItem.amount,
        existingRefunds: ticket.orderItem.refunds,
        ticket: {
          type: ticket.type,
          inUse: ticket.usageSessions.length > 0,
          activatedAt: ticket.activatedAt,
          activationDeadline: ticket.activationDeadline,
          purchasedMinutes: ticket.purchasedMinutes,
          remainingMinutes: ticket.remainingMinutes,
          minuteExpireDeadline: ticket.minuteExpireDeadline,
        },
      },
    };
  }

  /**
   * 환불 확정으로 이용권을 종료(REVOKED)한다. 만료 시각·남은 시간은 바꾸지 않는다
   * @param ticketId 이용권 ID
   * @param now 종료 시각
   * @param tx 트랜잭션 클라이언트
   */
  async terminateTicket(
    ticketId: string,
    now: Date,
    tx: TransactionClient,
  ): Promise<void> {
    // 상태와 종료 시각만 바꾼다(만료 시각·남은 시간을 되돌리거나 늘리지 않는다)
    await tx.ticket.update({
      where: { id: ticketId },
      data: { status: TicketStatus.REVOKED, revokedAt: now },
    });
  }

  /**
   * 진행 중인 정지 기록을 재개 없이 환불 종료 사유로 닫는다
   * @param ticketId 이용권 ID
   * @param now 닫은 시각
   * @param tx 트랜잭션 클라이언트
   */
  async closeOpenPausesForRefund(
    ticketId: string,
    now: Date,
    tx: TransactionClient,
  ): Promise<void> {
    // 재개 없이 닫는다(resumedAt은 그대로 null, 이용 시간을 되돌리지 않는다)
    await tx.ticketPause.updateMany({
      where: { ticketId, ...activePauseWhere },
      data: {
        closedAt: now,
        closeReason: TicketPauseCloseReason.REFUND_TERMINATED,
      },
    });
  }

  /**
   * 확정된 환불과 최초 PG 취소 요청(시도 1, REQUESTED)을 저장한다
   * - 0원이면 PG 취소 요청 없이 지급 완료(PAID)와 0원 원장을 저장한다
   * @param input 환불 내용
   * @param tx 트랜잭션 클라이언트
   * @returns 환불 ID와 PG 취소 요청 ID(0원이면 null)
   */
  async createAcceptedRefund(
    input: AcceptedRefundInput,
    tx: TransactionClient,
  ): Promise<{ refundId: string; paymentCancelId: string | null }> {
    const isZero = input.amount === 0;
    // 업무 확정(Refund). 양수는 최초 PG 취소 요청(시도 1)을 함께, 0원은 PG 요청 없이 지급 완료로 만든다
    const refund = await tx.refund.create({
      data: {
        paymentId: input.paymentId,
        orderItemId: input.orderItemId,
        targetKind: RefundTargetKind.ORDER_ITEM,
        source: input.source,
        decisionStatus: RefundDecisionStatus.ACCEPTED,
        policyVersion: refundPolicyVersion,
        amount: input.amount,
        payoutStatus: isZero
          ? RefundPayoutStatus.PAID
          : RefundPayoutStatus.PENDING,
        paidAt: isZero ? input.now : null,
        requestedAt: input.now,
        acceptedAt: input.now,
        terminatedAt: input.now,
        requestedById: input.requestedById,
        terminationConsentedAt: input.now,
        exitConsentedAt: input.exitConsentedAt,
        reason: input.reason,
        endedSessionId: input.endedSessionId,
        paymentCancels: isZero
          ? undefined
          : {
              create: {
                paymentId: input.paymentId,
                orderItemId: input.orderItemId,
                attemptNumber: 1,
                amount: input.amount,
                status: PaymentCancelStatus.REQUESTED,
                requestedAt: input.now,
                ...(input.sendClaim && {
                  sendAttemptCount: 1,
                  lastSendAttemptAt: input.now,
                  claimToken: input.sendClaim.claimToken,
                  claimUntil: input.sendClaim.claimUntil,
                }),
              },
            },
      },
      select: { id: true, paymentCancels: { select: { id: true } } },
    });

    // 0원은 지급 연결 없는 0원 원장 1건을 같은 트랜잭션에 남긴다(data-model §8)
    if (isZero) {
      await tx.ledger.create({
        data: {
          shopId: input.shopId,
          orderId: input.orderId,
          refundId: refund.id,
          amount: 0,
          status: LedgerStatus.RELEASABLE,
        },
      });
    }
    return {
      refundId: refund.id,
      paymentCancelId: refund.paymentCancels[0]?.id ?? null,
    };
  }

  /**
   * PG 결과를 반영할 PG 취소 요청과 그 환불을 조회한다
   * @param paymentCancelId PG 취소 요청 ID
   * @param tx 지급 결과 반영 트랜잭션
   * @returns PG 취소 요청과 환불, 없거나 새 환불에 속하지 않으면 null
   */
  async findAttemptForResult(
    paymentCancelId: string,
    tx: TransactionClient,
  ): Promise<AttemptForResult | null> {
    const attempt = await tx.paymentCancel.findUnique({
      where: { id: paymentCancelId },
      select: {
        id: true,
        status: true,
        claimToken: true,
        claimUntil: true,
        amount: true,
        resendCount: true,
        inquiryFailureCount: true,
        lastSendAttemptAt: true,
        lastInquiryAt: true,
        actualAmount: true,
        pgTransactionId: true,
        refund: {
          select: {
            id: true,
            amount: true,
            paidAmount: true,
            payoutStatus: true,
            reviewRequired: true,
            orderItemId: true,
            source: true,
            payment: {
              select: {
                pgTransactionId: true,
                order: { select: { id: true, shopId: true, userId: true } },
              },
            },
          },
        },
      },
    });
    if (!attempt?.refund) return null;
    return {
      id: attempt.id,
      status: attempt.status,
      claimToken: attempt.claimToken,
      claimUntil: attempt.claimUntil,
      amount: attempt.amount,
      resendCount: attempt.resendCount,
      inquiryFailureCount: attempt.inquiryFailureCount,
      lastSendAttemptAt: attempt.lastSendAttemptAt,
      lastInquiryAt: attempt.lastInquiryAt,
      actualAmount: attempt.actualAmount,
      pgTransactionId: attempt.pgTransactionId,
      refund: {
        id: attempt.refund.id,
        amount: attempt.refund.amount,
        paidAmount: attempt.refund.paidAmount,
        payoutStatus: attempt.refund.payoutStatus,
        reviewRequired: attempt.refund.reviewRequired,
        orderItemId: attempt.refund.orderItemId,
        source: attempt.refund.source,
        customerId: attempt.refund.payment.order.userId,
        approvalTransactionId: attempt.refund.payment.pgTransactionId,
        orderId: attempt.refund.payment.order.id,
        shopId: attempt.refund.payment.order.shopId,
      },
    };
  }

  /**
   * 기존 경로가 만든(환불 기록에 연결되지 않은) PG 취소 요청인지 확인한다
   * @param paymentCancelId PG 취소 요청 ID
   * @returns 존재하고 refundId가 없으면 true
   */
  async isLegacyAttempt(paymentCancelId: string): Promise<boolean> {
    const attempt = await this.prisma.paymentCancel.findUnique({
      where: { id: paymentCancelId },
      select: { refundId: true },
    });
    return attempt !== null && attempt.refundId === null;
  }

  /**
   * PG 취소 거래 ID를 다른 PG 취소 요청이 이미 쓰고 있는지 확인한다
   * @param tx 지급 결과 반영 트랜잭션
   * @param pgTransactionId PG 취소 거래 ID
   * @param attemptId 결과를 반영하려는 PG 취소 요청 ID
   * @returns 다른 요청이 쓰고 있으면 true
   */
  async isCancelTransactionUsedByOther(
    tx: TransactionClient,
    pgTransactionId: string,
    attemptId: string,
  ): Promise<boolean> {
    const used = await tx.paymentCancel.findUnique({
      where: { pgTransactionId },
      select: { id: true },
    });
    return used !== null && used.id !== attemptId;
  }

  /**
   * 전송 직전에 전송 시도 횟수·시각과 담당을 저장한다 (API 계약 §8)
   * - 이 기록이 커밋된 뒤에만 PG에 보내므로, 전송 중 중단돼도 재기동 후 조회부터 처리할 수 있다
   * @param tx 전송 준비 트랜잭션
   * @param id PG 취소 요청 ID
   * @param claim 담당 토큰·처리 기한·전송 시각
   */
  async markSendStarted(
    tx: TransactionClient,
    id: string,
    claim: { claimToken: string; claimUntil: Date; now: Date },
  ): Promise<void> {
    await tx.paymentCancel.update({
      where: { id },
      data: {
        sendAttemptCount: { increment: 1 },
        lastSendAttemptAt: claim.now,
        claimToken: claim.claimToken,
        claimUntil: claim.claimUntil,
      },
    });
  }

  /**
   * 개별 확인할 환불의 미확정 PG 취소 요청(결과 확인 중·결과 확인 실패) 한 건과 조회 기록을 찾는다
   * @param refundId 환불 ID
   * @returns 가장 최근 미확정 시도, 개별 확인 대상이 아니면 null
   */
  async findPendingAttemptOfRefund(refundId: string): Promise<{
    id: string;
    lastInquiryAt: Date | null;
    lastInquiryError: string | null;
    claimUntil: Date | null;
  } | null> {
    return this.prisma.paymentCancel.findFirst({
      where: {
        refundId,
        status: {
          in: [PaymentCancelStatus.REQUESTED, PaymentCancelStatus.QUERY_FAILED],
        },
        // 개별 PG 조회 대상 환불: 확정·지급 처리 중·PG 방식, 금액 검토 중 아님, 별도 지급 예약 없음(API 계약 §8)
        refund: {
          decisionStatus: RefundDecisionStatus.ACCEPTED,
          payoutStatus: RefundPayoutStatus.PENDING,
          payoutMethod: RefundPayoutMethod.PG,
          reviewRequired: false,
          manualPayouts: {
            none: { status: ManualRefundPayoutStatus.RESERVED },
          },
        },
      },
      orderBy: { attemptNumber: 'desc' },
      select: {
        id: true,
        lastInquiryAt: true,
        lastInquiryError: true,
        claimUntil: true,
      },
    });
  }

  /**
   * 정기 탐색에서 조회할 PG 취소 요청을 찾는다(일정의 원천은 DB의 nextInquiryAt)
   * @param now 탐색 시각
   * @param limit 한 번에 처리할 최대 건수
   * @returns 조회 예정 시각이 지난 미확정 시도 ID(예정 시각 순)
   */
  async findDueInquiries(now: Date, limit: number): Promise<string[]> {
    const due = await this.prisma.paymentCancel.findMany({
      where: {
        status: PaymentCancelStatus.REQUESTED,
        OR: [
          // 조회 예정 시각이 지난 시도
          { nextInquiryAt: { lte: now } },
          // 커밋 뒤 전송 전후에 중단돼 예정 시각 없이 남은 시도: 담당 기한이 지나면 조회부터 한다(API 계약 §8)
          {
            nextInquiryAt: null,
            sendAttemptCount: { gt: 0 },
            lastSendAttemptAt: { lte: now },
            OR: [{ claimUntil: null }, { claimUntil: { lte: now } }],
          },
        ],
        // 자동 PG 처리 대상 환불: 확정·지급 처리 중·PG 방식(조치 필요·결과 모순 건은 운영자 목록에서 다룬다)
        // 별도 환불금 지급 예약이 있는 환불은 PG 자동 처리에서 빼고 담당자가 확인한다(API 계약 §8)
        refund: {
          decisionStatus: RefundDecisionStatus.ACCEPTED,
          payoutStatus: RefundPayoutStatus.PENDING,
          payoutMethod: RefundPayoutMethod.PG,
          manualPayouts: {
            none: { status: ManualRefundPayoutStatus.RESERVED },
          },
        },
      },
      orderBy: [{ nextInquiryAt: 'asc' }, { lastSendAttemptAt: 'asc' }],
      take: limit,
      select: { id: true },
    });
    return due.map((attempt) => attempt.id);
  }

  /**
   * 조회 직전에 조회 시작 시각·횟수와 담당을 저장한다 (API 계약 §8)
   * @param tx 조회 준비 트랜잭션
   * @param id PG 취소 요청 ID
   * @param claim 담당 토큰·처리 기한·조회 시각
   */
  async markInquiryStarted(
    tx: TransactionClient,
    id: string,
    claim: { claimToken: string; claimUntil: Date; now: Date },
  ): Promise<void> {
    await tx.paymentCancel.update({
      where: { id },
      data: {
        lastInquiryAt: claim.now,
        inquiryCount: { increment: 1 },
        claimToken: claim.claimToken,
        claimUntil: claim.claimUntil,
      },
    });
  }

  /**
   * 맡은 PG 취소 요청을 같은 ID·금액으로 다시 보내기 직전에 재전송 횟수·전송 시도를 저장한다
   * - 담당 토큰이 그대로일 때만 바꾼다
   * @param id PG 취소 요청 ID
   * @param claim 담당 토큰·새 처리 기한·전송 시각
   * @param counter 늘릴 재전송 횟수(자동 resendCount 또는 개별 확인 manualResendCount)
   * @returns 저장했으면 true
   */
  async markResendStarted(
    id: string,
    claim: { claimToken: string; claimUntil: Date; now: Date },
    counter: 'resendCount' | 'manualResendCount',
  ): Promise<boolean> {
    const { count } = await this.prisma.paymentCancel.updateMany({
      where: { id, claimToken: claim.claimToken },
      data: {
        [counter]: { increment: 1 },
        sendAttemptCount: { increment: 1 },
        lastSendAttemptAt: claim.now,
        claimUntil: claim.claimUntil,
      },
    });
    return count === 1;
  }

  /**
   * 결과가 아직 확정되지 않은 조회 뒤 다음 조회를 예약하고 담당을 내려놓는다
   * - 담당 토큰이 그대로일 때만 바꾼다
   * - 일반 조회 일정(REQUESTED)으로 두므로 결과 확인 실패 건이었다면 복귀한다
   * @param id PG 취소 요청 ID
   * @param claimToken 조회를 맡은 담당 토큰
   * @param update 다음 조회 예정 시각과 연속 조회 오류 기록
   */
  async scheduleNextInquiry(
    id: string,
    claimToken: string,
    update: {
      nextInquiryAt: Date;
      inquiryFailureCount: number;
      lastInquiryError: string | null;
    },
  ): Promise<void> {
    await this.prisma.paymentCancel.updateMany({
      where: { id, claimToken },
      data: {
        ...update,
        // 정상 응답을 받은 결과 확인 실패 건도 일반 조회 일정으로 돌아간다
        status: PaymentCancelStatus.REQUESTED,
        queryFailedAt: null,
        claimToken: null,
        claimUntil: null,
      },
    });
  }

  /**
   * 이미 결과 확인 실패인 PG 취소 요청의 재조회 오류를 기록하고 담당을 내려놓는다
   * - 진입 시각(queryFailedAt)과 상태는 그대로 두고, 다음 확인은 장애 복구 확인이 맡는다
   * @param id PG 취소 요청 ID
   * @param claimToken 조회를 맡은 담당 토큰
   * @param update 연속 오류 횟수·마지막 오류
   */
  async recordRepeatedQueryError(
    id: string,
    claimToken: string,
    update: { inquiryFailureCount: number; lastInquiryError: string },
  ): Promise<void> {
    await this.prisma.paymentCancel.updateMany({
      where: { id, claimToken },
      data: { ...update, claimToken: null, claimUntil: null },
    });
  }

  /**
   * 연속 조회 오류가 한도에 도달한 PG 취소 요청을 결과 확인 실패(QUERY_FAILED)로 바꾼다
   * - 이후 조회는 장애 복구 확인(PROBE/BATCH)이 맡으므로 개별 예정 시각과 담당을 지운다
   * @param tx 결과 반영 트랜잭션
   * @param id PG 취소 요청 ID
   * @param update 연속 오류 횟수·마지막 오류·전환 시각
   */
  async markQueryFailed(
    tx: TransactionClient,
    id: string,
    update: {
      inquiryFailureCount: number;
      lastInquiryError: string;
      now: Date;
    },
  ): Promise<void> {
    await tx.paymentCancel.update({
      where: { id },
      data: {
        status: PaymentCancelStatus.QUERY_FAILED,
        inquiryFailureCount: update.inquiryFailureCount,
        lastInquiryError: update.lastInquiryError,
        queryFailedAt: update.now,
        nextInquiryAt: null,
        claimToken: null,
        claimUntil: null,
      },
    });
  }

  /**
   * 응답이 확정되지 않은 전송 뒤 첫 조회를 예약하고 담당을 내려놓는다
   * - 담당 토큰이 그대로일 때만 바꾼다(그사이 콜백 등이 확정했으면 아무것도 하지 않는다)
   * @param id PG 취소 요청 ID
   * @param claimToken 전송을 맡은 담당 토큰
   * @param nextInquiryAt 첫 조회 예정 시각
   */
  async scheduleInquiryAfterSend(
    id: string,
    claimToken: string,
    nextInquiryAt: Date,
  ): Promise<void> {
    await this.prisma.paymentCancel.updateMany({
      where: { id, claimToken },
      data: {
        nextInquiryAt,
        // PG가 전송을 받았으므로 결과 확인 실패였던 건도 일반 조회 일정으로 돌아간다(연속 오류 초기화)
        status: PaymentCancelStatus.REQUESTED,
        queryFailedAt: null,
        inquiryFailureCount: 0,
        lastInquiryError: null,
        claimToken: null,
        claimUntil: null,
      },
    });
  }

  /**
   * PG 취소 요청이 속한 환불과 원래 주문을 찾는다(거래 로그용)
   * @param paymentCancelId PG 취소 요청 ID
   * @returns 환불·주문 ID
   */
  async findAttemptRefundIds(
    paymentCancelId: string,
  ): Promise<{ refundId: string; orderId: string }> {
    const attempt = await this.prisma.paymentCancel.findUniqueOrThrow({
      where: { id: paymentCancelId },
      select: {
        refundId: true,
        payment: { select: { orderId: true } },
      },
    });
    return { refundId: attempt.refundId!, orderId: attempt.payment.orderId };
  }

  /**
   * PG 취소 요청이 속한 환불의 현재 지급 상태를 읽는다
   * @param paymentCancelId PG 취소 요청 ID
   * @returns 지급 상태와 조치 사유 코드
   */
  async findPayoutStateByAttempt(
    paymentCancelId: string,
  ): Promise<{ payoutStatus: RefundPayoutStatus; actionCode: string | null }> {
    const attempt = await this.prisma.paymentCancel.findUniqueOrThrow({
      where: { id: paymentCancelId },
      select: { refund: { select: { payoutStatus: true, actionCode: true } } },
    });
    return attempt.refund!;
  }

  /**
   * PG 취소 요청을 성공으로 확정하고 실제 취소액을 기록한다
   * @param tx 지급 결과 반영 트랜잭션
   * @param id PG 취소 요청 ID
   * @param result PG 취소 거래 ID·실제 취소액·확정 시각
   */
  async markAttemptSucceeded(
    tx: TransactionClient,
    id: string,
    result: { pgTransactionId: string; actualAmount: number; now: Date },
  ): Promise<void> {
    await tx.paymentCancel.update({
      where: { id },
      data: {
        status: PaymentCancelStatus.SUCCEEDED,
        pgTransactionId: result.pgTransactionId,
        actualAmount: result.actualAmount,
        cancelledAt: result.now,
        nextInquiryAt: null,
        claimToken: null,
        claimUntil: null,
      },
    });
  }

  /**
   * PG 취소 요청을 실패로 확정한다(시도 실패이며 환불 실패·철회가 아니다)
   * - 자동 조회·재전송 대상에서 빠지도록 예정 시각과 담당을 지운다
   * @param tx 지급 결과 반영 트랜잭션
   * @param id PG 취소 요청 ID
   * @param failure 실패 사유 코드·설명·확정 시각
   */
  async markAttemptFailed(
    tx: TransactionClient,
    id: string,
    failure: {
      failureCode: PaymentCancelFailureCode;
      failureReason: string;
      now: Date;
    },
  ): Promise<void> {
    await tx.paymentCancel.update({
      where: { id },
      data: {
        status: PaymentCancelStatus.FAILED,
        failureCode: failure.failureCode,
        failureReason: failure.failureReason,
        failedAt: failure.now,
        nextInquiryAt: null,
        claimToken: null,
        claimUntil: null,
      },
    });
  }

  /**
   * 환불의 지급 합계와 지급 상태를 갱신한다
   * @param tx 지급 결과 반영 트랜잭션
   * @param refundId 환불 ID
   * @param update 새 지급 합계·상태·완료 시각·검토·조치 사유
   */
  async updateRefundPayout(
    tx: TransactionClient,
    refundId: string,
    update: RefundPayoutUpdate,
  ): Promise<void> {
    await tx.refund.update({ where: { id: refundId }, data: update });
  }

  /**
   * 환불이 속한 매장(원래 주문의 매장)을 찾는다
   * @param refundId 환불 ID
   * @returns 매장 ID, 환불이 없으면 null
   */
  async findRefundShopId(refundId: string): Promise<string | null> {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      select: { payment: { select: { order: { select: { shopId: true } } } } },
    });
    return refund?.payment.order.shopId ?? null;
  }

  /**
   * 결제 전체 대상(PAYMENT) 시스템 환불과 최초 PG 취소 요청을 저장한다(승인 금액 불일치 자동 취소, data-model §1)
   * - 확정·지급 처리 중으로 저장하고, 이용권이 없으므로 이용 종료·동의 시각과 실행자는 없다
   * - 커밋 뒤 바로 보낼 전송 기록(시도 1회·시각·담당)을 함께 저장한다
   * @param tx 결제 콜백 처리 트랜잭션
   * @param input 결제·금액(실제 승인액)·시각·전송 담당
   * @returns 환불·최초 PG 취소 요청 ID
   */
  async createPaymentTargetRefund(
    tx: TransactionClient,
    input: {
      paymentId: string;
      amount: number;
      now: Date;
      sendClaim: { claimToken: string; claimUntil: Date };
    },
  ): Promise<{ refundId: string; paymentCancelId: string }> {
    const refund = await tx.refund.create({
      data: {
        paymentId: input.paymentId,
        orderItemId: null,
        targetKind: RefundTargetKind.PAYMENT,
        source: RefundSource.SYSTEM,
        decisionStatus: RefundDecisionStatus.ACCEPTED,
        policyVersion: refundPolicyVersion,
        amount: input.amount,
        payoutStatus: RefundPayoutStatus.PENDING,
        requestedAt: input.now,
        acceptedAt: input.now,
        paymentCancels: {
          create: {
            paymentId: input.paymentId,
            orderItemId: null,
            attemptNumber: 1,
            amount: input.amount,
            status: PaymentCancelStatus.REQUESTED,
            requestedAt: input.now,
            sendAttemptCount: 1,
            lastSendAttemptAt: input.now,
            claimToken: input.sendClaim.claimToken,
            claimUntil: input.sendClaim.claimUntil,
          },
        },
      },
      select: { id: true, paymentCancels: { select: { id: true } } },
    });
    return {
      refundId: refund.id,
      paymentCancelId: refund.paymentCancels[0].id,
    };
  }

  /**
   * PG 재시도 판정과 새 요청 저장에 쓸 환불의 지급 상태를 읽는다
   * @param refundId 환불 ID
   * @param tx 트랜잭션(잠금 뒤 다시 읽을 때)
   * @returns 판정 상태·잠글 행·새 요청에 쓸 값, 없으면 null
   */
  async findPayoutRetryTarget(
    refundId: string,
    tx: TransactionClient | PrismaService = this.prisma,
  ): Promise<PayoutRetryTarget | null> {
    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        paymentId: true,
        orderItemId: true,
        decisionStatus: true,
        payoutStatus: true,
        amount: true,
        paidAmount: true,
        actionCode: true,
        paymentCancels: {
          orderBy: { attemptNumber: 'asc' },
          select: {
            id: true,
            status: true,
            claimUntil: true,
            attemptNumber: true,
          },
        },
        manualPayouts: { select: { id: true, status: true } },
      },
    });
    if (!refund) return null;
    const latest = refund.paymentCancels.at(-1);
    return {
      state: {
        decisionStatus: refund.decisionStatus,
        payoutStatus: refund.payoutStatus,
        amount: refund.amount,
        paidAmount: refund.paidAmount,
        actionCode: refund.actionCode,
        attempts: refund.paymentCancels.map((attempt) => ({
          status: attempt.status,
          claimUntil: attempt.claimUntil,
        })),
        activeManualPayout: refund.manualPayouts.some(
          (payout) => payout.status === ManualRefundPayoutStatus.RESERVED,
        ),
      },
      paymentId: refund.paymentId,
      // 새 요청의 대상 상품은 환불과 같다(결제 전체 대상이면 null, DB 검사 트리거가 일치를 보장)
      orderItemId: refund.orderItemId,
      nextAttemptNumber: (latest?.attemptNumber ?? 0) + 1,
      paymentCancelIds: refund.paymentCancels.map((attempt) => attempt.id),
      manualRefundPayoutIds: refund.manualPayouts.map((payout) => payout.id),
    };
  }

  /**
   * 개별 확인으로 새 요청을 보낼 수 있는 실패 확정 시도를 찾는다 (API 계약 §8, FR-057)
   * - 환불의 가장 최근 시도가 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED로 FAILED이고,
   *   환불이 확정·PG 방식·금액 검토 중 아님일 때만 대상이다(지급액·예약·미확정 지급은 재시도 판정에서 확인)
   * @param refundId 환불 ID
   * @param tx 트랜잭션(잠금 뒤 다시 읽을 때)
   * @returns 실패한 최근 시도의 조회 기록, 대상이 아니면 null
   */
  async findFailedRetryCandidate(
    refundId: string,
    tx: TransactionClient | PrismaService = this.prisma,
  ): Promise<{
    id: string;
    lastInquiryAt: Date | null;
    lastInquiryError: string | null;
    claimUntil: Date | null;
  } | null> {
    const refund = await tx.refund.findFirst({
      where: {
        id: refundId,
        decisionStatus: RefundDecisionStatus.ACCEPTED,
        payoutMethod: RefundPayoutMethod.PG,
        reviewRequired: false,
      },
      select: {
        paymentCancels: {
          orderBy: { attemptNumber: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            failureCode: true,
            lastInquiryAt: true,
            lastInquiryError: true,
            claimUntil: true,
          },
        },
      },
    });
    const latest = refund?.paymentCancels[0];
    if (
      !latest ||
      latest.status !== PaymentCancelStatus.FAILED ||
      latest.failureCode === null ||
      !retryableFailureCodes.includes(latest.failureCode)
    ) {
      return null;
    }
    return {
      id: latest.id,
      lastInquiryAt: latest.lastInquiryAt,
      lastInquiryError: latest.lastInquiryError,
      claimUntil: latest.claimUntil,
    };
  }

  /**
   * 환불의 가장 최근 PG 취소 요청의 조회 기록을 읽는다(개별 확인 응답용)
   * @param refundId 환불 ID
   * @returns 최근 조회 시각·마지막 조회 오류, 요청이 없으면 null
   */
  async findLatestAttemptInquiry(refundId: string): Promise<{
    lastInquiryAt: Date | null;
    lastInquiryError: string | null;
  } | null> {
    return this.prisma.paymentCancel.findFirst({
      where: { refundId },
      orderBy: { attemptNumber: 'desc' },
      select: { lastInquiryAt: true, lastInquiryError: true },
    });
  }

  /**
   * 맡았던 PG 취소 요청의 담당을 내려놓는다(담당 토큰이 같을 때만)
   * @param tx 트랜잭션
   * @param id PG 취소 요청 ID
   * @param claimToken 담당 토큰
   * @param lastInquiryError 이번 조회의 오류(정상 응답이면 null로 지운다, 생략하면 그대로 둔다)
   * @returns 아직 자기 담당이어서 내려놓았으면 true
   */
  async releaseAttemptClaim(
    tx: TransactionClient,
    id: string,
    claimToken: string,
    lastInquiryError?: string | null,
  ): Promise<boolean> {
    const { count } = await tx.paymentCancel.updateMany({
      where: { id, claimToken },
      data: { claimToken: null, claimUntil: null, lastInquiryError },
    });
    return count === 1;
  }

  /**
   * 확정된 환불 아래 새 PG 취소 요청을 저장하고 환불을 지급 처리 중(PENDING/PG)으로 되돌린다
   * - 이전 요청의 상태·실패 사유·횟수는 바꾸지 않는다. 자동 재전송 횟수는 0부터 시작한다
   * - 커밋 뒤 바로 보낼 전송 기록(시도 1회·시각·담당)을 함께 저장한다
   * @param tx 재시도 트랜잭션
   * @param input 환불·대상·시도 번호·금액·실행자·사유·시각·전송 담당
   * @returns 새 PG 취소 요청 ID
   */
  async createRetryAttempt(
    tx: TransactionClient,
    input: {
      refundId: string;
      paymentId: string;
      orderItemId: string | null;
      attemptNumber: number;
      amount: number;
      requestedById: string;
      retryReason: string;
      now: Date;
      sendClaim: { claimToken: string; claimUntil: Date };
      lastInquiryAt?: Date | null; // 개별 확인으로 만든 요청은 실패 시도의 조회 시각을 승계한다
    },
  ): Promise<string> {
    const attempt = await tx.paymentCancel.create({
      data: {
        refundId: input.refundId,
        paymentId: input.paymentId,
        orderItemId: input.orderItemId,
        attemptNumber: input.attemptNumber,
        amount: input.amount,
        status: PaymentCancelStatus.REQUESTED,
        requestedAt: input.now,
        requestedById: input.requestedById,
        retryReason: input.retryReason,
        sendAttemptCount: 1,
        lastSendAttemptAt: input.now,
        claimToken: input.sendClaim.claimToken,
        claimUntil: input.sendClaim.claimUntil,
        lastInquiryAt: input.lastInquiryAt,
      },
      select: { id: true },
    });
    await tx.refund.update({
      where: { id: input.refundId },
      data: {
        payoutStatus: RefundPayoutStatus.PENDING,
        payoutMethod: RefundPayoutMethod.PG,
        actionCode: null,
        actionReason: null,
      },
    });
    return attempt.id;
  }

  /**
   * 접수 응답을 다시 만들 환불의 저장 상태를 읽는다
   * @param refundId 환불 ID
   * @returns 접수 응답에 담을 값
   */
  async findAcceptanceSnapshot(refundId: string) {
    const refund = await this.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      select: {
        decisionStatus: true,
        amount: true,
        payoutStatus: true,
        actionCode: true,
        acceptedAt: true,
        terminatedAt: true,
        orderItem: { select: { ticket: { select: { id: true } } } },
        paymentCancels: {
          orderBy: { attemptNumber: 'desc' },
          take: 1,
          select: { id: true },
        },
      },
    });
    return {
      decisionStatus: refund.decisionStatus,
      amount: refund.amount,
      payoutStatus: refund.payoutStatus,
      actionCode: refund.actionCode,
      acceptedAt: refund.acceptedAt!,
      terminatedAt: refund.terminatedAt!,
      ticketId: refund.orderItem!.ticket!.id,
      paymentCancelId: refund.paymentCancels[0]?.id ?? null,
    };
  }

  /**
   * 개별 확인 응답에 담을 환불의 최신 지급 상태를 읽는다
   * @param refundId 환불 ID
   * @returns 환불 요약
   */
  async findRefundSummary(refundId: string) {
    return this.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      select: {
        id: true,
        decisionStatus: true,
        amount: true,
        paidAmount: true,
        payoutStatus: true,
        actionCode: true,
      },
    });
  }

  /**
   * 사용자가 지금 이 매장의 점주(ShopOwner)인지 확인한다
   * @param shopId 매장 ID
   * @param userId 사용자 ID
   * @returns 현재 점주면 true
   */
  async isCurrentShopOwner(shopId: string, userId: string): Promise<boolean> {
    const owner = await this.prisma.shopOwner.findUnique({
      where: { shopId_userId: { shopId, userId } },
    });
    return owner !== null;
  }

  async runInTransaction<T>(
    work: (tx: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.executeTransaction(work);
  }

  async getRefundLock(
    orderItemId: string,
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    return await client.refundLock.findFirst({
      where: {
        orderItemId,
      },
    });
  }

  async getTicketById(id: string) {
    return await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        userId: true,
        type: true,
        status: true,
        activatedAt: true,
        remainingMinutes: true,
        purchasedMinutes: true,
        // 진행 중인 세션이 있으면 remainingMinutes가 아직 차감 전(사후 정산 방식)이라도
        // 사용 이력이 있다고 판단해야 하므로 ACTIVE 세션 존재 여부를 함께 조회한다.
        usageSessions: {
          where: { status: UsageSessionStatus.ACTIVE },
          select: { id: true },
        },
        orderItem: {
          select: {
            id: true,
            order: {
              select: {
                id: true,
                payments: {
                  where: {
                    status: 'SUCCESS',
                  },
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * 결제 취소(환불) 요청 기록을 만든다
   * - 자동 처리(REQUESTED) 전용 - 승인 대기 생성은 createPendingApprovalPaymentCancel 참고
   * @param amount 취소 금액
   * @param paymentId 결제 ID
   * @param orderItemId 주문 항목 ID
   * @param requestedAt 요청 시각
   * @param idempotencyKey 멱등 키(선택)
   * @param client 트랜잭션 클라이언트(없으면 기본 클라이언트)
   * @param reason 취소 사유(시스템 자동 취소 시 기록)
   * @returns 생성한 결제 취소 기록
   */
  async createPaymentCancel(
    amount: number,
    paymentId: string,
    orderItemId: string,
    requestedAt: Date,
    idempotencyKey?: string,
    client: TransactionClient | PrismaService = this.prisma,
    reason?: string, // 취소 사유(시스템 자동 취소 시 기록, 이용자 요청은 기존처럼 비움)
  ) {
    return await client.paymentCancel.create({
      data: {
        amount,
        paymentId,
        orderItemId,
        requestedAt,
        idempotencyKey,
        reason,
        status: PaymentCancelStatus.REQUESTED,
      },
    });
  }

  // 같은 orderItemId로 이미 승인 대기 중인 요청이 있는지 확인한다(중복 신청 방지용).
  async getPendingApprovalPaymentCancel(
    orderItemId: string,
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    return await client.paymentCancel.findFirst({
      where: {
        orderItemId,
        status: PaymentCancelStatus.PENDING_APPROVAL,
      },
    });
  }

  // 사용 이력 있는 건 - 점주 승인 대기 상태로만 PaymentCancel을 생성한다.
  // 금액은 아직 확정되지 않으므로(점주가 승인 시점에 입력) 0으로 저장한다.
  // RefundLock은 만들지 않는다 - 아직 PG에 아무 요청도 나가지 않아 락으로 막을 대상(PG
  // 취소 실행 중복)이 없기 때문이다. 대신 같은 orderItemId의 중복 신청은 이 메서드
  // 안에서 확인한다. 중복 확인과 생성을 원자적으로 묶어야 하므로 항상 새 트랜잭션을 연다.
  async createPendingApprovalPaymentCancel(
    paymentId: string,
    orderItemId: string,
    requestedAt: Date,
    idempotencyKey?: string,
  ) {
    return this.runInTransaction(async (tx) => {
      const existing = await this.getPendingApprovalPaymentCancel(
        orderItemId,
        tx,
      );
      if (existing) {
        throw new DomainConflictError(
          '이미 승인 대기 중인 환불 요청이 있습니다',
        );
      }

      return await tx.paymentCancel.create({
        data: {
          amount: 0,
          paymentId,
          orderItemId,
          requestedAt,
          idempotencyKey,
          status: PaymentCancelStatus.PENDING_APPROVAL,
        },
      });
    });
  }

  async createRefundLock(
    orderItemId: string,
    paymentCancelId: string,
    expiresAt: Date = new Date(Date.now() + 1 * 60 * 1000),
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    await client.refundLock.create({
      data: {
        orderItemId,
        paymentCancelId,
        expiresAt,
      },
    });
  }

  // 만료된 락을 PG 조회 동안 선점하기 위해 만료 시각을 연장한다.
  // updateMany + paymentCancelId 소유권 조건 - 그 사이 다른 트랜잭션이 이미
  // 이 락을 처리(삭제)했다면 대상이 없어 0건으로 조용히 끝난다(에러 없음).
  // 반환값(연장된 행 수)으로 호출부가 선점 성공 여부를 판단할 수 있다.
  async extendRefundLock(
    orderItemId: string,
    paymentCancelId: string,
    expiresAt: Date,
    client: TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    const { count } = await client.refundLock.updateMany({
      where: {
        orderItemId,
        paymentCancelId,
      },
      data: {
        expiresAt,
      },
    });
    return count;
  }

  // 환불 가능 금액 계산 - 상품(OrderItem)은 환불 1회로 종료되므로(부분/재환불 없음),
  // "얼마나 환불 가능한지"가 아니라 "이미 환불된 적 있는지"만 확인하면 된다.
  // already_refunded가 true면 원가(refund_amount)와 무관하게 재환불은 항상 불가.
  async calculateRefundableAmount(
    orderItemId: string,
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    const [refund] = await client.$queryRaw<
      {
        order_item_id: string;
        refund_amount: number;
        already_refunded: boolean;
      }[]
    >`
      SELECT
        oi.id AS order_item_id,
        oi.amount AS refund_amount, -- "결제 예정/완료 금액"(원가, 상수)
        EXISTS(
          SELECT 1
          FROM payment_cancels pc
          WHERE pc.status = 'SUCCEEDED'
            AND pc.order_item_id = ${orderItemId}
        ) AS already_refunded
      FROM order_items oi
      WHERE oi.id = ${orderItemId}
    `;
    return refund;
  }

  // 환불이 확정(SUCCEEDED)된 시점에 해당 상품의 티켓을 무효화한다.
  // Ticket.orderItemId가 unique라 별도 조회 없이 바로 갱신 가능.
  // revokedAt은 호출부(succeedPaymentCancel과 같은 트랜잭션)의 now를 그대로
  // 넘겨받아 PaymentCancel.cancelledAt과 항상 같은 값을 갖도록 강제한다.
  // confirmRefundSuccess를 통해서만 호출되도록 private로 감춘다(위 참고).
  private async revokeTicket(
    orderItemId: string,
    revokedAt: Date,
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    await client.ticket.update({
      where: { orderItemId },
      data: { status: TicketStatus.REVOKED, revokedAt },
    });
  }

  async deleteRefundLock(
    orderItemId: string,
    paymentCancelId: string, // 본인이 처리 중이던 락이 맞는지 확인을 위해 where 절에 추가
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    // deleteMany 사용 - 소유권(paymentCancelId)이 안 맞아 대상이 없어도
    // (동시 요청이 이미 같은 락을 처리하고 지운 경우) 에러 없이 무시된다
    await client.refundLock.deleteMany({
      where: {
        orderItemId,
        paymentCancelId,
      },
    });
  }

  /**
   * 주문 항목으로 발급된 이용권 ID를 조회한다
   * @param orderItemId 주문 항목 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 이용권 ID, 없으면 null
   */
  async findTicketIdByOrderItem(
    orderItemId: string,
    tx: TransactionClient,
  ): Promise<string | null> {
    const ticket = await tx.ticket.findUnique({
      where: { orderItemId },
      select: { id: true },
    });
    return ticket?.id ?? null;
  }

  async getPaymentCancelById(
    id: string,
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    return await client.paymentCancel.findUniqueOrThrow({
      where: { id },
    });
  }

  // PaymentCancel 확정과 Ticket 무효화는 항상 함께 반영되어야 하는 원자적 세트다.
  // 이 둘을 개별 호출로 흩어두면 한쪽만 호출하는 실수를 막을 방법이 없으므로,
  // succeedPaymentCancel/revokeTicket을 private으로 감춰 이 메서드로만 호출되게
  // 강제한다. tx를 필수로 받아(기본값 없음) 호출부가 반드시 트랜잭션을 열게 한다.
  async confirmRefundSuccess(
    paymentCancelId: string,
    orderItemId: string,
    confirmedAt: Date,
    tx: TransactionClient,
  ) {
    await this.succeedPaymentCancel(paymentCancelId, confirmedAt, tx);
    await this.revokeTicket(orderItemId, confirmedAt, tx);
  }

  private async succeedPaymentCancel(
    paymentCancelId: string,
    now: Date = new Date(),
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    await client.paymentCancel.update({
      where: { id: paymentCancelId },
      data: {
        status: PaymentCancelStatus.SUCCEEDED,
        cancelledAt: now,
        // 이전 실패 시도(예: PG 호출 중 타임아웃)의 흔적이 남아있을 수 있으므로 명시적으로 초기화
        failedAt: null,
        failureReason: null,
        failureCode: null,
      },
    });
  }

  async failPaymentCancel(
    paymentCancelId: string,
    reason: string,
    failureCode?: PaymentCancelFailureCode,
    now: Date = new Date(),
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    await client.paymentCancel.update({
      where: { id: paymentCancelId },
      data: {
        status: PaymentCancelStatus.FAILED,
        failedAt: now,
        failureReason: reason,
        failureCode,
      },
    });
  }

  async getRefundHistoryByShop(
    shopId: string,
    status?: PaymentCancelStatus,
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    return client.paymentCancel.findMany({
      where: {
        payment: { order: { shopId } },
        status,
      },
      select: {
        id: true,
        amount: true,
        status: true,
        reason: true,
        requestedAt: true,
        cancelledAt: true,
        failureReason: true,
        orderItem: {
          select: {
            id: true,
            ticketType: true,
            product: { select: { name: true } },
            ticket: { select: { id: true, status: true } },
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async getRefundHistoryByUser(
    userId: string,
    status?: PaymentCancelStatus,
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    return client.user.findMany({
      where: {
        id: userId,
      },
      select: {
        orders: {
          select: {
            id: true,
            orderItems: {
              select: {
                id: true,
                amount: true,
                paymentCancels: {
                  where: status ? { status } : undefined,
                  select: {
                    id: true,
                    amount: true,
                    status: true,
                  },
                },
                product: {
                  select: {
                    id: true,
                    name: true,
                    ticketType: true,
                    amount: true,
                  },
                },
                ticket: {
                  select: {
                    id: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }
}
