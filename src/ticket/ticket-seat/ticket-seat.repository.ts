import { Injectable } from '@nestjs/common';
import {
  SeatType,
  TicketSeatChange,
  TicketSeatChangeType,
  TicketStatus,
  UsageSessionStatus,
} from '@prisma/client';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';

/** 좌석 변경 판단에 쓰는 잠근 이용권 스냅샷 */
export type TicketForSeatChange = {
  id: string;
  status: TicketStatus;
  seatType: SeatType;
  shopId: string; // 이용권을 구매한 매장(주문의 매장)
};

/** 이용권 좌석 변경 이력 1행 */
export type TicketSeatChangeData = {
  ticketId: string;
  changeType: TicketSeatChangeType;
  fromSeatType: SeatType;
  toSeatType: SeatType;
  fromSeatId: string | null;
  toSeatId: string | null;
  reason: string;
  changedBy: string;
  endedSessionId: string | null;
};

@Injectable()
export class TicketSeatRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 트랜잭션 안에서 작업을 실행한다
   * @param work 트랜잭션 클라이언트를 받는 작업
   * @returns 작업의 반환값
   */
  async runInTransaction<T>(
    work: (tx: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.executeTransaction(work);
  }

  /**
   * 이용권을 잠그고(FOR UPDATE) 좌석 변경에 필요한 값을 조회한다
   * @param ticketId 이용권 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 이용권 스냅샷, 없으면 null
   */
  async getTicketForUpdate(
    ticketId: string,
    tx: TransactionClient,
  ): Promise<TicketForSeatChange | null> {
    // 같은 이용권의 동시 좌석 변경·일시정지·입실과 직렬화한다
    const [ticket] = await tx.$queryRaw<TicketForSeatChange[]>`
      SELECT t.id, t.status, t.seat_type AS "seatType", o.shop_id AS "shopId"
        FROM tickets t
        JOIN order_items oi ON oi.id = t.order_item_id
        JOIN orders o ON o.id = oi.order_id
       WHERE t.id = ${ticketId}
         FOR UPDATE OF t
    `;
    return ticket ?? null;
  }

  /**
   * 이용권의 좌석 타입을 바꾼다
   * @param ticketId 이용권 ID
   * @param seatType 바꿀 좌석 타입
   * @param tx 트랜잭션 클라이언트
   * @returns 없음
   */
  async updateSeatType(
    ticketId: string,
    seatType: SeatType,
    tx: TransactionClient,
  ): Promise<void> {
    await tx.ticket.update({ where: { id: ticketId }, data: { seatType } });
  }

  /**
   * 이용권 좌석 변경 이력을 남긴다
   * @param data 이력 데이터
   * @param tx 트랜잭션 클라이언트
   * @returns 없음
   */
  async createSeatChange(
    data: TicketSeatChangeData,
    tx: TransactionClient,
  ): Promise<void> {
    await tx.ticketSeatChange.create({ data });
  }

  /**
   * 이용권의 진행 중(ACTIVE) 이용 세션을 조회한다
   * @param ticketId 이용권 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 세션 ID·좌석 ID, 없으면 null
   */
  async findActiveSession(
    ticketId: string,
    tx: TransactionClient,
  ): Promise<{ id: string; seatId: string } | null> {
    return tx.usageSession.findFirst({
      where: { ticketId, status: UsageSessionStatus.ACTIVE },
      select: { id: true, seatId: true },
    });
  }

  /**
   * 이용 중인 세션의 좌석을 바꾼다(고정석 이동 시 세션 유지)
   * @param sessionId 세션 ID
   * @param seatId 옮길 좌석 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 없음
   */
  async updateSessionSeat(
    sessionId: string,
    seatId: string,
    tx: TransactionClient,
  ): Promise<void> {
    await tx.usageSession.update({
      where: { id: sessionId },
      data: { seatId },
    });
  }

  /**
   * 좌석에 다른 이용권의 진행 중(ACTIVE) 세션이 있는지 확인한다
   * @param seatId 좌석 ID
   * @param ticketId 제외할 이용권 ID(변경 대상 이용권)
   * @param tx 트랜잭션 클라이언트
   * @returns 다른 이용자가 이용 중이면 true
   */
  async hasOtherActiveSessionOnSeat(
    seatId: string,
    ticketId: string,
    tx: TransactionClient,
  ): Promise<boolean> {
    const session = await tx.usageSession.findFirst({
      where: {
        seatId,
        status: UsageSessionStatus.ACTIVE,
        ticketId: { not: ticketId },
      },
      select: { id: true },
    });
    return session !== null;
  }

  /**
   * 좌석의 타입과 매장을 조회한다
   * @param seatId 좌석 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 좌석 타입·매장, 없으면 null
   */
  async findSeat(
    seatId: string,
    tx: TransactionClient,
  ): Promise<{ type: SeatType; shopId: string } | null> {
    return tx.seat.findUnique({
      where: { id: seatId },
      select: { type: true, shopId: true },
    });
  }

  /**
   * 이용권이 일시정지 중인지(재개되지 않은 TicketPause가 있는지) 확인한다
   * @param ticketId 이용권 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 일시정지 중이면 true
   */
  async hasActivePause(
    ticketId: string,
    tx: TransactionClient,
  ): Promise<boolean> {
    const pause = await tx.ticketPause.findFirst({
      where: { ticketId, resumedAt: null },
      select: { id: true },
    });
    return pause !== null;
  }

  /**
   * 이용권의 좌석 변경 이력을 최신순으로 조회한다
   * @param ticketId 이용권 ID
   * @returns 변경 이력 목록(changedAt 내림차순)
   */
  async findSeatChanges(ticketId: string): Promise<TicketSeatChange[]> {
    return this.prisma.ticketSeatChange.findMany({
      where: { ticketId },
      orderBy: { changedAt: 'desc' },
    });
  }
}
