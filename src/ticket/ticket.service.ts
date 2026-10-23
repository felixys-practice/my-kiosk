import { Injectable } from '@nestjs/common';
import { TicketRepository } from './ticket.repository';
import {
  SeatType,
  TicketStatus,
  TicketType,
  UsageSessionStatus,
} from '@prisma/client';
import { differenceInCalendarDays, differenceInMinutes } from 'date-fns';
import {
  PeriodTicketData,
  PeriodTicketOutData,
  TicketSummaryOutData,
  TimeTicketData,
  TimeTicketOutData,
} from './ticket.types';

// order.repository.ts의 getOrder select와 1:1로 대응하는 조회 원본 타입
type TicketSummarySource = {
  id: string;
  type: TicketType;
  status: TicketStatus;
  usageSessions: { status: UsageSessionStatus; seat: { number: number } }[];
  ticketPauses: { pausedAt: Date }[];
};

type TicketWithRelations = {
  type: TicketType;
  userId: string;
  status: TicketStatus;
  minuteExpireDeadline: Date | null;
  remainingMinutes: number | null;
  activationDeadline: Date | null;
  activatedAt: Date | null;
  expiresAt: Date | null;
  purchasedDurationDays: number | null;
  purchasedMinutes: number | null;
  seatType: SeatType;
  seatAssignments: { seat: { id: string; number: number; name: string } }[];
  usageSessions: {
    startedAt: Date;
    endedAt: Date | null;
    plannedEndAt: Date;
    seat: { number: number };
  }[];
  ticketPauses: {
    pausedAt: Date;
    pausedReason: string | null;
    pausedBy: string;
    resumedAt: Date | null;
    resumedBy: string | null;
    resumedReason: string | null;
  }[];
};

@Injectable()
export class TicketService {
  constructor(private readonly repository: TicketRepository) {}

  async getTicket(id: string) {
    const ticket = await this.repository.getTicketById(id);
    return this.toTicketOutData(ticket);
  }

  async getTicketByUser(userId: string) {
    throw new Error('아직 구현중인 작업니다');
  }

  async createTimeTicket(data: TimeTicketData) {
    return await this.repository.createTimeTicket(data);
  }

  async createPeriodTicket(data: PeriodTicketData) {
    return await this.repository.createPeriodTicket(data);
  }

  // order 도메인 등 금액/만료 상세가 필요 없는 소비처를 위한 최소 요약 변환
  toTicketSummaryOutData(ticket: TicketSummarySource): TicketSummaryOutData {
    return {
      id: ticket.id,
      type: ticket.type,
      status: ticket.status,
      isPaused: ticket.ticketPauses.length > 0,
      usingSeatNumber: ticket.usageSessions[0]?.seat?.number,
    };
  }

  /**
   * 이용권 조회 결과를 응답 형태로 바꾼다(좌석 타입·배정 좌석 포함)
   * @param ticket 이용권 조회 결과
   * @returns 시간권 또는 기간권 응답
   * @throws Error 시간권에 잔여시간, 기간권에 만료일이 없을 때
   */
  private toTicketOutData(
    ticket: TicketWithRelations,
  ): TimeTicketOutData | PeriodTicketOutData {
    if (ticket.type === 'PERIOD') {
      if (!ticket.expiresAt)
        throw new Error('정기권에서 expiresAt 값은 필수입니다');
      return {
        type: 'PERIOD',
        userId: ticket.userId,
        status: ticket.status,
        activationDeadline: ticket.activationDeadline!, // 유효일
        activatedAt: ticket.activatedAt!,
        expiresAt: ticket.expiresAt, // 만료일
        pausedAt: ticket.ticketPauses[0]?.pausedAt,
        remainingDays: this.calcRemainingDays(ticket.expiresAt),
        seatNumber: ticket.usageSessions[0]?.seat.number,
        lastEnteredAt: ticket.usageSessions[0]?.startedAt,
        lastExitedAt: ticket.usageSessions[0]?.endedAt,
        seatType: ticket.seatType,
        assignedSeat: ticket.seatAssignments[0]?.seat ?? null,
      } as PeriodTicketOutData;
    } else if (ticket.type === 'TIME') {
      if (ticket.remainingMinutes === null)
        throw new Error('시간권에서 remainingMinutes 값은 필수입니다');
      return {
        type: 'TIME',
        userId: ticket.userId,
        status: ticket.status,
        minuteExpireDeadline: ticket.minuteExpireDeadline!,
        remainingMinutes: this.calcRemainingMinutes(
          ticket.remainingMinutes,
          ticket.usageSessions[0], // 없으면 undefined → session 파라미터에 전달 안 됨
        ),
        seatNumber: ticket.usageSessions[0]?.seat.number,
        lastEnteredAt: ticket.usageSessions[0]?.startedAt,
        lastExitedAt: ticket.usageSessions[0]?.endedAt,
        seatType: ticket.seatType,
        assignedSeat: ticket.seatAssignments[0]?.seat ?? null,
      } as TimeTicketOutData;
    } else {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const _exhaustive: never = ticket.type;
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`처리되지 않은 TicketType: ${_exhaustive}`);
    }
  }

  // 시간권의 남은 시간을 구한다.(분)
  private calcRemainingMinutes(
    remainingMinutes: number,
    session?: { plannedEndAt: Date; endedAt: Date | null },
  ): number {
    if (session && !session.endedAt) {
      // 이용중인 티켓의 남은 시간(분) 계산
      return differenceInMinutes(session.plannedEndAt, new Date());
    } else {
      // 이용중 아님 티켓의 남은 시간(분)
      return remainingMinutes;
    }
  }

  // 정기권의 남은 일수를 구한다.(일수)
  private calcRemainingDays(expiresAt: Date): number {
    return differenceInCalendarDays(expiresAt, new Date());
  }
}
