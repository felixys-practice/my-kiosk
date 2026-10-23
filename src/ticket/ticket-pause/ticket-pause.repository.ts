import { Injectable } from '@nestjs/common';
import {
  TicketPause,
  TicketStatus,
  TicketType,
  SeatType,
} from '@prisma/client';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';
import { DomainNotFoundError } from 'src/common/errors';

// getTicketForUpdate가 반환하는 티켓 스냅샷 타입
export type TicketForUpdate = {
  id: string;
  type: TicketType;
  status: TicketStatus;
  remainingMinutes: number | null;
  minuteExpireDeadline: Date | null;
  expiresAt: Date | null;
  seatType: SeatType; // 고정석이면 정지 시 배정 해제, 재개 시 재배정
  shopId: string; // 이용권을 구매한 매장(재배정 좌석 검증용)
};

@Injectable()
export class TicketPauseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async runInTransaction<T>(
    work: (tx: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.executeTransaction(work);
  }

  /**
   * 이용권을 잠그고(FOR UPDATE) 정지·재개에 필요한 값을 조회한다
   * - 티켓 조회 (FOR UPDATE 락) — 동시 정지/재개 요청 직렬화
   * @param ticketId 이용권 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 이용권 스냅샷(좌석 타입·구매 매장 포함)
   * @throws DomainNotFoundError 이용권이 없을 때
   */
  async getTicketForUpdate(
    ticketId: string,
    tx: TransactionClient,
  ): Promise<TicketForUpdate> {
    const [ticket] = await tx.$queryRaw<TicketForUpdate[]>`
      SELECT t.id, t.type, t.status,
             t."remaining_minutes" AS "remainingMinutes",
             t."minute_expire_deadline" AS "minuteExpireDeadline",
             t."expires_at" AS "expiresAt",
             t.seat_type AS "seatType",
             o.shop_id AS "shopId"
        FROM tickets t
        JOIN order_items oi ON oi.id = t.order_item_id
        JOIN orders o ON o.id = oi.order_id
        WHERE t.id = ${ticketId}
        FOR UPDATE OF t
    `;
    if (!ticket) {
      throw new DomainNotFoundError(`티켓을 찾을 수 없습니다: ${ticketId}`);
    }
    return ticket;
  }

  // 해당 티켓의 활성 정지(resumed_at IS NULL) 조회
  async findActivePause(
    ticketId: string,
    client: TransactionClient | PrismaService = this.prisma,
  ): Promise<TicketPause | null> {
    return client.ticketPause.findFirst({
      where: { ticketId, resumedAt: null },
    });
  }

  // 해당 티켓에 ACTIVE 상태 세션의 ID를 조회 (없으면 null)
  async findActiveSessionId(
    ticketId: string,
    tx: TransactionClient,
  ): Promise<string | null> {
    const session = await tx.usageSession.findFirst({
      where: { ticketId, endedAt: null },
      select: { id: true },
    });
    return session?.id ?? null;
  }

  // TicketPause 생성
  async createPause(
    data: {
      ticketId: string;
      pausedAt: Date;
      pausedReason?: string;
      pausedBy: string;
    },
    client: TransactionClient | PrismaService = this.prisma,
  ): Promise<TicketPause> {
    return client.ticketPause.create({ data });
  }

  // TicketPause 재개 (resumedAt 업데이트)
  async resumePause(
    pauseId: string,
    data: {
      resumedAt: Date;
      resumedReason?: string;
      resumedBy: string;
    },
    client: TransactionClient | PrismaService = this.prisma,
  ): Promise<TicketPause> {
    return client.ticketPause.update({
      where: { id: pauseId },
      data,
    });
  }

  // 티켓 기한 연장 (정지 기간만큼)
  async extendTicketDeadline(
    ticketId: string,
    data: { minuteExpireDeadline?: Date; expiresAt?: Date },
    client: TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    await client.ticket.update({
      where: { id: ticketId },
      data,
    });
  }
}
