import { Injectable } from '@nestjs/common';
import {
  SeatReleaseReason,
  TicketStatus,
  UsageSessionStatus,
} from '@prisma/client';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { TransactionClient } from 'src/prisma/prisma.service';
import { DomainNotFoundError } from 'src/common/errors';

// endSession이 반환하는 종료 결과
export type EndSessionResult = {
  ticketId: string;
  bullmqJobId: string | null;
  alreadyEnded: boolean;
};

/**
 * 세션 종료 핵심 로직의 유일한 원천(Single Source of Truth).
 * UsageSession과 TicketPause 양쪽에서 공유한다.
 *
 * - FOR UPDATE 락으로 동시 종료 방지
 * - 이미 종료된 세션은 멱등 처리
 * - 시간권(TIME)은 소비 시간을 remainingMinutes에서 차감하고, 소진 시 EXHAUSTED로 전이하며 고정석 배정을 해제
 * - 정기권(PERIOD)은 세션 상태만 ENDED로 변경 (시간 차감 없음)
 */
@Injectable()
export class SessionLifecycleService {
  constructor(private readonly seatAssignmentService: SeatAssignmentService) {}

  /**
   * 세션을 종료한다. 외부 트랜잭션 내에서 호출해야 한다.
   * @param sessionId 종료할 세션 ID
   * @param now 종료 시각
   * @param tx Prisma 트랜잭션 클라이언트
   */
  async endSession(
    sessionId: string,
    now: Date,
    tx: TransactionClient,
  ): Promise<EndSessionResult> {
    const [session] = await tx.$queryRaw<
      {
        id: string;
        status: string;
        startedAt: Date;
        ticketId: string;
        ticketType: string;
        bullmqJobId: string | null;
      }[]
    >`
      SELECT us.id, us.status, us."started_at" AS "startedAt",
             us."ticket_id" AS "ticketId", t.type AS "ticketType",
             us."bullmqJobId"
        FROM usage_sessions us
        JOIN tickets t ON t.id = us."ticket_id"
        WHERE us.id = ${sessionId}
        FOR UPDATE OF us
    `;

    if (!session) {
      throw new DomainNotFoundError(`세션을 찾을 수 없습니다: ${sessionId}`);
    }

    // 이미 종료된 세션 — 멱등 처리
    if (session.status !== UsageSessionStatus.ACTIVE) {
      return {
        ticketId: session.ticketId,
        bullmqJobId: session.bullmqJobId,
        alreadyEnded: true,
      };
    }

    // 세션 상태 ENDED로 변경
    await tx.usageSession.update({
      where: { id: sessionId },
      data: { status: UsageSessionStatus.ENDED, endedAt: now },
    });

    // 시간권만 잔여시간 차감 + 소진 시 자동 상태 전이
    if (session.ticketType === 'TIME') {
      const consumedMinutes = Math.ceil(
        (now.getTime() - session.startedAt.getTime()) / 60000,
      );

      const [updated] = await tx.$queryRaw<{ status: TicketStatus }[]>`
        UPDATE tickets
        SET "remaining_minutes" = GREATEST(0, "remaining_minutes" - ${consumedMinutes}),
            status = CASE
              WHEN "remaining_minutes" - ${consumedMinutes} <= 0
              THEN ${TicketStatus.EXHAUSTED}
              ELSE status
            END
        WHERE id = ${session.ticketId}
        RETURNING status
      `;

      // 소진(EXHAUSTED)으로 바뀌었으면 같은 트랜잭션에서 고정석 배정을 해제한다(FR-017)
      if (updated?.status === TicketStatus.EXHAUSTED) {
        await this.seatAssignmentService.releaseByTicket(
          session.ticketId,
          SeatReleaseReason.TICKET_EXHAUSTED,
          now,
          tx,
        );
      }
    }

    return {
      ticketId: session.ticketId,
      bullmqJobId: session.bullmqJobId,
      alreadyEnded: false,
    };
  }
}
