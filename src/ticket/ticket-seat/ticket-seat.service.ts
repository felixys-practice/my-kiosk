import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  SeatReleaseReason,
  SeatType,
  TicketSeatChange,
  TicketSeatChangeType,
  TicketStatus,
} from '@prisma/client';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { SeatNotFoundError } from 'src/seat/errors/seat-not-found.error';
import { SeatShopMismatchError } from 'src/seat-assignment/errors/seat-shop-mismatch.error';
import { SeatTypeMismatchError } from 'src/seat-assignment/errors/seat-type-mismatch.error';
import { SessionLifecycleService } from 'src/session-lifecycle/session-lifecycle.service';
import { ChangeTicketSeatDto } from './dto/change-ticket-seat.dto';
import { SeatAlreadyOccupiedError } from 'src/usage-session/errors/seat-already-occupied.error';
import { TicketClosedError } from '../errors/ticket-closed.error';
import { TicketNotFoundError } from '../errors/ticket-not-found.error';
import { TicketPausedError } from '../errors/ticket-paused.error';
import { TicketSeatUnchangedError } from '../errors/ticket-seat-unchanged.error';
import { TicketSeatRepository } from './ticket-seat.repository';

@Injectable()
export class TicketSeatService {
  constructor(
    private readonly repository: TicketSeatRepository,
    private readonly seatAssignmentService: SeatAssignmentService,
    private readonly sessionLifecycle: SessionLifecycleService,
    @InjectQueue('usage-session') private readonly usageSessionQueue: Queue,
  ) {}

  /**
   * 점주가 이용권의 좌석을 바꾼다(타입 변경·고정석 이동, FR-013~015b)
   * @param ticketId 이용권 ID
   * @param dto 바꿀 좌석 타입·좌석·사유
   * @param changedBy 변경한 점주 ID
   * @returns 없음
   */
  async changeSeat(
    ticketId: string,
    dto: ChangeTicketSeatDto,
    changedBy: string,
  ): Promise<void> {
    const now = new Date();

    const { bullmqJobId } = await this.repository.runInTransaction(
      async (tx) => {
        // 이용권 잠금
        const ticket = await this.repository.getTicketForUpdate(ticketId, tx);

        // 이용권이 없으면 404
        if (!ticket) throw new TicketNotFoundError();

        // 종료된 이용권(만료·소진·환불 소멸)은 좌석을 바꿀 수 없다
        const closedStatuses: TicketStatus[] = [
          TicketStatus.EXPIRED,
          TicketStatus.EXHAUSTED,
          TicketStatus.REVOKED,
        ];
        if (closedStatuses.includes(ticket.status)) {
          throw new TicketClosedError();
        }

        // 일시정지 중인 이용권은 재개한 뒤 바꾼다
        if (await this.repository.hasActivePause(ticketId, tx)) {
          throw new TicketPausedError();
        }

        // 변경 전 배정 좌석
        const before = await this.seatAssignmentService.getActiveByTicket(
          ticketId,
          tx,
        );

        // 바뀌는 것이 없으면 거부한다(자유석 → 자유석, 고정석 → 같은 좌석)
        const unchangedFree =
          ticket.seatType === SeatType.FREE && dto.seatType === SeatType.FREE;
        const unchangedFixed =
          ticket.seatType === SeatType.FIXED &&
          dto.seatType === SeatType.FIXED &&
          before?.seatId === dto.seatId;
        if (unchangedFree || unchangedFixed) {
          throw new TicketSeatUnchangedError();
        }

        // 고정석 → 다른 고정석 이동 여부
        const isMove =
          ticket.seatType === SeatType.FIXED && dto.seatType === SeatType.FIXED;

        // 고정석으로 바꾸거나 옮기면 대상 좌석을 먼저 검증한다(헌법 VI 사유별 오류)
        if (dto.seatType === SeatType.FIXED) {
          const target = await this.repository.findSeat(dto.seatId!, tx);
          if (!target) throw new SeatNotFoundError();
          if (target.shopId !== ticket.shopId) {
            throw new SeatShopMismatchError();
          }
          if (target.type === SeatType.FREE) {
            throw new SeatTypeMismatchError(
              '고정석으로 바꿀 좌석은 고정석이어야 합니다',
            );
          }
        }

        // 이용 중이면 타입 변경은 즉시 퇴실시킨다(FR-019, 자동 입실은 하지 않는다).
        // 고정석 이동은 퇴실시키지 않고 세션 좌석만 바꾼다(FR-015b, research R5)
        let endedSessionId: string | null = null;
        let sessionJobId: string | null = null;
        const activeSession = await this.repository.findActiveSession(
          ticketId,
          tx,
        );
        if (activeSession && isMove) {
          await this.repository.updateSessionSeat(
            activeSession.id,
            dto.seatId!,
            tx,
          );
        } else if (activeSession) {
          const ended = await this.sessionLifecycle.endSession(
            activeSession.id,
            now,
            tx,
          );
          endedSessionId = activeSession.id;
          sessionJobId = ended.bullmqJobId;
        }

        // 고정석에서 자유석으로 바꾸면 기존 배정을 해제한다(FR-015)
        if (
          ticket.seatType === SeatType.FIXED &&
          dto.seatType === SeatType.FREE
        ) {
          await this.seatAssignmentService.releaseByTicket(
            ticketId,
            SeatReleaseReason.SEAT_TYPE_CHANGED,
            now,
            tx,
          );
        }

        // 옮길 좌석을 다른 이용자가 이용 중이면 옮길 수 없다
        if (
          isMove &&
          (await this.repository.hasOtherActiveSessionOnSeat(
            dto.seatId!,
            ticketId,
            tx,
          ))
        ) {
          throw new SeatAlreadyOccupiedError(dto.seatId!);
        }

        // 고정석 → 다른 고정석 이동이면 기존 배정을 먼저 해제한다(이용권당 ACTIVE 배정 1개, FR-015a)
        if (isMove) {
          await this.seatAssignmentService.releaseByTicket(
            ticketId,
            SeatReleaseReason.SEAT_MOVED,
            now,
            tx,
          );
        }

        // 고정석으로 바꾸거나 옮기면 요청 좌석을 배정한다
        if (dto.seatType === SeatType.FIXED) {
          await this.seatAssignmentService.assign(
            { seatId: dto.seatId!, shopId: ticket.shopId, ticketId },
            now,
            tx,
          );
        }

        // 이용권 좌석 타입 변경
        await this.repository.updateSeatType(ticketId, dto.seatType, tx);

        // 변경 이력(FR-021)
        await this.repository.createSeatChange(
          {
            ticketId,
            changeType: isMove
              ? TicketSeatChangeType.SEAT_MOVE
              : TicketSeatChangeType.TYPE_CHANGE,
            fromSeatType: ticket.seatType,
            toSeatType: dto.seatType,
            fromSeatId: before?.seatId ?? null,
            toSeatId: dto.seatType === SeatType.FIXED ? dto.seatId! : null,
            reason: dto.reason,
            changedBy,
            endedSessionId,
          },
          tx,
        );

        return { bullmqJobId: sessionJobId };
      },
    );

    // 커밋 후 자동 종료 Job 제거(실패해도 endSession의 멱등 처리로 이중 종료를 막는다, research R6)
    if (bullmqJobId) {
      await this.usageSessionQueue.remove(bullmqJobId).catch(() => {});
    }
  }

  /**
   * 이용권의 좌석 변경 이력을 최신순으로 조회한다(SC-005)
   * @param ticketId 이용권 ID
   * @returns 변경 이력(변경자·시각·전후 타입·좌석·사유)
   */
  async getSeatChanges(ticketId: string): Promise<TicketSeatChange[]> {
    return this.repository.findSeatChanges(ticketId);
  }
}
