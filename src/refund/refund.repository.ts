import { Injectable } from '@nestjs/common';
import {
  PaymentCancelFailureCode,
  PaymentCancelStatus,
  TicketStatus,
  UsageSessionStatus,
} from '@prisma/client';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';
import { DomainConflictError } from 'src/common/errors';

@Injectable()
export class RefundRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  // 자동 처리(REQUESTED) 전용 - 승인 대기 생성은 createPendingApprovalPaymentCancel 참고
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
