import { Injectable } from '@nestjs/common';
import {
  Ticket,
  TicketStatus,
  TicketType,
  SeatAssignmentStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateTicketData,
  PeriodTicketOutData,
  TicketSortField,
  TicketSortOption,
  TimeTicketOutData,
  UpdateTicketData,
} from './ticket.types';

//REMIND: TicketSortField(db 컬럼명)가 외부에 그대로 노출되는걸 막기 위해(현재는 과도하지만 타입 문법 학습을 위해 우선 유지)
const SORT_FIELD_MAP: Record<TicketSortField, string> = {
  purchasedAt: 'createdAt', // 구매일
  updatedAt: 'updatedAt', // 변경일
  expiredAt: 'expiredAt', // 정기권 만료일
  remainingTime: 'minuteExpireDeadline', // 시간권 만료일
};

@Injectable()
export class TicketRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createTimeTicket(data: CreateTicketData) {
    return await this.prisma.ticket.create({
      data,
      select: {
        type: true,
        userId: true,
        status: true,
        purchasedMinutes: true,
        minuteExpireDeadline: true,
        remainingMinutes: true,
      },
    });
  }

  async createPeriodTicket(data: CreateTicketData) {
    return await this.prisma.ticket.create({
      data,
      select: {
        type: true,
        userId: true,
        status: true,
        purchasedDurationDays: true,
        activationDeadline: true,
      },
    });
  }

  async updateTicket(id: string, data: UpdateTicketData): Promise<Ticket> {
    return await this.prisma.ticket.update({
      where: { id },
      data,
    });
  }

  /**
   * 이용권을 조회한다(좌석 타입·배정 좌석·최근 세션·진행 중 정지 포함)
   * @param ticketId 이용권 ID
   * @returns 이용권
   * @throws Prisma.NotFoundError 이용권이 없을 때
   */
  async getTicketById(ticketId: string) {
    return await this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: {
        type: true,
        userId: true,
        status: true,
        minuteExpireDeadline: true,
        remainingMinutes: true,
        activationDeadline: true,
        activatedAt: true,
        expiresAt: true,
        purchasedMinutes: true,
        purchasedDurationDays: true,
        seatType: true,
        // 확정(ACTIVE)된 지정 좌석(이용권당 최대 1개)
        seatAssignments: {
          where: { status: SeatAssignmentStatus.ACTIVE },
          select: { seat: { select: { id: true, number: true, name: true } } },
          take: 1,
        },
        usageSessions: {
          where: { ticketId },
          select: {
            startedAt: true,
            endedAt: true,
            plannedEndAt: true,
            seat: { select: { number: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
        ticketPauses: {
          where: { resumedAt: null }, // 현재 정지 중인 것만
          select: {
            pausedAt: true,
            pausedReason: true,
            pausedBy: true,
            resumedAt: true,
            resumedBy: true,
            resumedReason: true,
          },
          orderBy: { updatedAt: 'desc' as const },
          take: 1,
        },
      },
    });
  }

  async getTicketBySessionId(sessionId: string) {
    return await this.prisma.ticket.findFirstOrThrow({
      where: {
        usageSessions: { some: { id: sessionId } },
      },
      select: {
        type: true,
        userId: true,
        status: true,
        minuteExpireDeadline: true,
        remainingMinutes: true,
        activationDeadline: true,
        activatedAt: true,
        expiresAt: true,
        purchasedMinutes: true,
        purchasedDurationDays: true,
        usageSessions: {
          where: { id: sessionId },
          select: {
            startedAt: true,
            endedAt: true,
            plannedEndAt: true,
            seat: { select: { number: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
        ticketPauses: {
          where: { resumedAt: null }, // 현재 정지 중인 것만
          select: {
            pausedAt: true,
            pausedReason: true,
            pausedBy: true,
            resumedAt: true,
            resumedBy: true,
            resumedReason: true,
          },
          orderBy: { updatedAt: 'desc' as const },
          take: 1,
        },
      },
    });
  }

  // 티켓의 사용 이력
  async getTicketUsedReport() {}

  // 사용자별 티켓 목록
}
