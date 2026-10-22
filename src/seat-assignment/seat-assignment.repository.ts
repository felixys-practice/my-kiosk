import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SeatAssignmentStatus,
  SeatReleaseReason,
  SeatType,
} from '@prisma/client';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';
import { AssignmentTicketSnapshot } from './seat-assignment.policy';

/** 열린(HELD·ACTIVE) 지정 + 판정에 필요한 이용권 필드 */
export type OpenSeatAssignment = {
  id: string;
  seatId: string;
  orderItemId: string | null;
  ticketId: string | null;
  status: SeatAssignmentStatus;
  heldUntil: Date | null;
  ticket: AssignmentTicketSnapshot | null;
};

/** 잠근 좌석의 판정용 필드 */
export type LockedSeat = {
  id: string;
  shopId: string;
  type: SeatType;
};

/** 지정 상태 갱신 데이터 */
export type SeatAssignmentStatusUpdate =
  | {
      status: typeof SeatAssignmentStatus.RELEASED;
      releasedAt: Date;
      releaseReason: SeatReleaseReason;
    }
  | {
      status: typeof SeatAssignmentStatus.ACTIVE;
      ticketId: string;
      assignedAt: Date;
    };

// 열린 지정 상태
const openStatuses: SeatAssignmentStatus[] = [
  SeatAssignmentStatus.HELD,
  SeatAssignmentStatus.ACTIVE,
];

// 판정에 필요한 필드만 조회
const openAssignmentSelect = {
  id: true,
  seatId: true,
  orderItemId: true,
  ticketId: true,
  status: true,
  heldUntil: true,
  ticket: {
    select: {
      type: true,
      status: true,
      expiresAt: true,
      activationDeadline: true,
      minuteExpireDeadline: true,
    },
  },
} satisfies Prisma.SeatAssignmentSelect;

/**
 * 좌석 지정 데이터 접근
 * - 쿼리만 담당한다. 유효 판정·해제 결정·순서 조율은 SeatAssignmentService가 한다(헌법 원칙 I)
 */
@Injectable()
export class SeatAssignmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 좌석 행을 잠그고 판정용 필드를 조회한다
   * @param seatId 좌석 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 좌석(없으면 null)
   */
  async lockSeat(
    seatId: string,
    tx: TransactionClient,
  ): Promise<LockedSeat | null> {
    // 같은 좌석에 대한 동시 선점·지정을 직렬화
    const [seat] = await tx.$queryRaw<LockedSeat[]>`
      SELECT id, shop_id AS "shopId", type
        FROM seats
       WHERE id = ${seatId}
         FOR UPDATE
    `;
    return seat ?? null;
  }

  /**
   * 좌석의 열린(HELD·ACTIVE) 지정을 조회한다
   * @param seatId 좌석 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 열린 지정 목록
   */
  async findOpenBySeat(
    seatId: string,
    tx: TransactionClient,
  ): Promise<OpenSeatAssignment[]> {
    return tx.seatAssignment.findMany({
      where: { seatId, status: { in: openStatuses } },
      select: openAssignmentSelect,
    });
  }

  /**
   * 여러 좌석의 열린 지정을 조회한다(좌석 목록의 선택 가능 여부 계산용)
   * @param seatIds 좌석 ID 목록
   * @returns 열린 지정 목록
   */
  async findOpenBySeatIds(seatIds: string[]): Promise<OpenSeatAssignment[]> {
    return this.prisma.seatAssignment.findMany({
      where: { seatId: { in: seatIds }, status: { in: openStatuses } },
      select: openAssignmentSelect,
    });
  }

  /**
   * 이용권의 확정(ACTIVE) 지정을 조회한다
   * @param ticketId 이용권 ID
   * @param client 트랜잭션 클라이언트(없으면 기본 클라이언트)
   * @returns 확정 지정(없으면 null)
   */
  async findActiveByTicket(
    ticketId: string,
    client: TransactionClient | PrismaService = this.prisma,
  ): Promise<OpenSeatAssignment | null> {
    return client.seatAssignment.findFirst({
      where: { ticketId, status: SeatAssignmentStatus.ACTIVE },
      select: openAssignmentSelect,
    });
  }

  /**
   * 주문 항목들의 선점(HELD) 지정을 조회한다
   * @param orderItemIds 주문 항목 ID 목록
   * @param tx 트랜잭션 클라이언트
   * @returns 선점 지정 목록
   */
  async findHeldByOrderItems(
    orderItemIds: string[],
    tx: TransactionClient,
  ): Promise<OpenSeatAssignment[]> {
    return tx.seatAssignment.findMany({
      where: {
        orderItemId: { in: orderItemIds },
        status: SeatAssignmentStatus.HELD,
      },
      select: openAssignmentSelect,
    });
  }

  /**
   * 주문 항목의 가장 최근 지정을 상태와 무관하게 조회한다
   * @param orderItemId 주문 항목 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 가장 최근 지정(없으면 null)
   */
  async findLatestByOrderItem(
    orderItemId: string,
    tx: TransactionClient,
  ): Promise<OpenSeatAssignment | null> {
    return tx.seatAssignment.findFirst({
      where: { orderItemId },
      orderBy: { createdAt: 'desc' },
      select: openAssignmentSelect,
    });
  }

  /**
   * 지정을 생성한다
   * @param data 생성 데이터
   * @param tx 트랜잭션 클라이언트
   * @throws Prisma.PrismaClientKnownRequestError P2002 - 부분 유일 인덱스 위반
   */
  async create(
    data: Prisma.SeatAssignmentUncheckedCreateInput,
    tx: TransactionClient,
  ): Promise<void> {
    await tx.seatAssignment.create({ data });
  }

  /**
   * 지정 상태를 갱신한다
   * @param ids 지정 ID 목록
   * @param data 갱신 데이터
   * @param tx 트랜잭션 클라이언트
   * @throws Prisma.PrismaClientKnownRequestError P2002 - 부분 유일 인덱스 위반
   */
  async updateStatus(
    ids: string[],
    data: SeatAssignmentStatusUpdate,
    tx: TransactionClient,
  ): Promise<void> {
    await tx.seatAssignment.updateMany({ where: { id: { in: ids } }, data });
  }
}
