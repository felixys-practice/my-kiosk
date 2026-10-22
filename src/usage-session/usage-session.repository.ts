import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SeatStatus,
  TicketStatus,
  UsageSessionStatus,
  SeatType,
} from '@prisma/client';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';
import { SeatAlreadyOccupiedError } from './errors/seat-already-occupied.error';
import { JobRegistrationFailedError } from './errors/job-registration-failed.error';
import { SessionLifecycleService } from 'src/session-lifecycle/session-lifecycle.service';

@Injectable()
export class UsageSessionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionLifecycle: SessionLifecycleService,
  ) {}

  async createSession(
    ticketId: string,
    shopId: string,
    seatId: string,
    userId: string,
    plannedEndAt: Date, // ⭐️ 남은 시간
    startedAt: Date,
    updatePeriodTicketData?: {
      activatedAt: Date; // 첫 입장(활성화) 시각
      expiresAt: Date; // ⭐️ 정기권 실제 만료 시각(activatedAt + purchasedDurationDays)
    },
    beforeCreate?: (tx: TransactionClient) => Promise<void>, // 같은 트랜잭션에서 세션 생성 전에 실행할 확인(서비스가 판단)
  ): Promise<string> {
    return await this.prisma.executeTransaction(async (tx) => {
      // Step 0. 호출 측 확인(예: 고정석 배정 재확인)
      if (beforeCreate) await beforeCreate(tx);

      // Step 1. 좌석 이용 가능 유무 확인 (AVAILABLE 상태이고 ACTIVE 세션 없음)
      const availableSeat = await tx.seat.findFirst({
        where: {
          id: seatId,
          status: SeatStatus.AVAILABLE,
          usageSession: {
            none: { status: UsageSessionStatus.ACTIVE },
          },
        },
      });
      if (!availableSeat) {
        throw new SeatAlreadyOccupiedError(seatId);
      }

      // Step 2. 미사용 기간권 업데이트
      if (updatePeriodTicketData) {
        await tx.ticket.update({
          where: {
            id: ticketId,
            status: TicketStatus.UNUSED,
          },
          data: {
            status: TicketStatus.ACTIVE,
            activatedAt: updatePeriodTicketData.activatedAt,
            expiresAt: updatePeriodTicketData.expiresAt,
          },
        });
      }

      // Step 3. 세션 생성
      const session = await tx.usageSession.create({
        data: {
          ticket: { connect: { id: ticketId } },
          shop: { connect: { id: shopId } },
          seat: { connect: { id: seatId } },
          user: { connect: { id: userId } },
          startedAt,
          plannedEndAt,
        },
      });
      return session.id;
    });
  }

  /**
   * 이용권의 확정(ACTIVE) 배정 행을 잠그고 배정 좌석 ID를 조회한다
   * @param ticketId 이용권 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 배정 좌석 ID, 배정이 없으면 null
   */
  async findAssignedSeatIdForUpdate(
    ticketId: string,
    tx: TransactionClient,
  ): Promise<string | null> {
    // 입실 확인과 배정 변경(좌석 이동·해제)을 직렬화한다
    const [row] = await tx.$queryRaw<{ seatId: string }[]>`
      SELECT seat_id AS "seatId"
        FROM seat_assignments
       WHERE ticket_id = ${ticketId}
         AND status = 'ACTIVE'
         FOR UPDATE
    `;
    return row?.seatId ?? null;
  }

  /**
   * 좌석의 타입을 조회한다
   * @param seatId 좌석 ID
   * @returns 좌석 타입, 좌석이 없으면 null
   */
  async findSeatType(seatId: string): Promise<SeatType | null> {
    const seat = await this.prisma.seat.findUnique({
      where: { id: seatId },
      select: { type: true },
    });
    return seat?.type ?? null;
  }

  async registerJobId(sessionId: string, bullmqJobId: string): Promise<void> {
    try {
      await this.prisma.usageSession.update({
        where: { id: sessionId, status: TicketStatus.ACTIVE },
        data: { bullmqJobId },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new JobRegistrationFailedError(sessionId);
      }
      throw error;
    }
  }

  // 세션 종료 — SessionLifecycleService에 위임
  async endUsageSession(
    sessionId: string,
    now: Date,
  ): Promise<{ bullmqJobId: string | null }> {
    return await this.prisma.executeTransaction(async (tx) => {
      const result = await this.sessionLifecycle.endSession(sessionId, now, tx);
      return { bullmqJobId: result.bullmqJobId };
    });
  }

  async failSession(
    sessionId: string,
    status: UsageSessionStatus,
    failureReason?: string,
  ): Promise<void> {
    await this.prisma.usageSession.update({
      where: { id: sessionId },
      data: { status, failureReason },
    });
  }

  async getUsageSession(id: string) {
    return await this.prisma.usageSession.findUnique({
      where: {
        id,
      },
      include: {
        ticket: true,
        shop: true,
        seat: true,
        user: { select: { id: true } },
      },
    });
  }

  async getUsageSessionByShop(
    shopId: string,
    sortOrder: Prisma.SortOrder = 'asc',
    limit: number = 10,
  ) {
    return await this.prisma.usageSession.findMany({
      where: {
        shopId,
      },
      select: {
        id: true,
        status: true,
        seat: { select: { id: true, number: true } },
        ticket: { select: { id: true, type: true, status: true } },
        shop: { select: { id: true, name: true } },
        user: { select: { id: true, email: true } },
      },
      orderBy: [{ createdAt: sortOrder }],
      take: limit,
    });
  }

  async getUsageSessionByUser(
    userId: string,
    sortOrder: Prisma.SortOrder = 'asc',
    limit: number = 10,
  ) {
    return await this.prisma.usageSession.findMany({
      where: {
        userId,
      },
      select: {
        id: true,
        status: true,
        seat: { select: { id: true, number: true } },
        ticket: { select: { id: true, type: true, status: true } },
        shop: { select: { id: true, name: true } },
        user: { select: { id: true, email: true } },
      },
      orderBy: [{ createdAt: sortOrder }],
      take: limit,
    });
  }

  // ❌ delete: UsageSession은 사용 이력이기 때문에 삭제하면 안된다.
}
