import { SeatType } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { UsageSessionRepository } from './usage-session.repository';
import { TicketRepository } from 'src/ticket/ticket.repository';
import { addDays, addMinutes } from 'date-fns';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SortOrder, FirstEntryTicketUpdate } from './usage-session.types';
import { withRetry, assertDefined } from '@felix_ys/ts-utils';
import { NotAssignedSeatError } from 'src/seat-assignment/errors/not-assigned-seat.error';
import { SeatTypeMismatchError } from 'src/seat-assignment/errors/seat-type-mismatch.error';
import { TicketSeatUnassignedError } from 'src/seat-assignment/errors/ticket-seat-unassigned.error';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';

const mockExternalApi = async (waitMs: number = 1000) => {
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  if (Math.random() < 0.3) {
    return false;
  }
  return true;
};

@Injectable()
export class UsageSessionService {
  constructor(
    private readonly repository: UsageSessionRepository,
    private readonly ticketRepository: TicketRepository,
    @InjectQueue('usage-session')
    private readonly jobQueue: Queue<{ sessionId: string }>,
    private readonly seatAssignmentService: SeatAssignmentService,
  ) {}

  private async addJob(sessionId: string, plannedEndAt: Date): Promise<string> {
    const delay = plannedEndAt.getTime() - Date.now();

    const job = await this.jobQueue.add(
      'expire-session',
      { sessionId }, // payload
      {
        delay: Math.max(delay, 0), // 만료 시점까지 지연
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return job.id!; // queue.add() 결과에서는 id 항상 존재 (런타임 보장)
  }

  private async removeJob(jobId: string): Promise<boolean> {
    const job = await this.jobQueue.getJob(jobId);
    if (!job) return false;
    await job.remove();
    return true;
  }

  /**
   * 입실한다(이용 세션 생성)
   * - 세션 생성
   * - 이용권과 좌석의 타입이 같아야 하고, 고정석 이용권은 배정 좌석에만 입실한다(FR-011)
   * @param ticketId 이용권 ID
   * @param shopId 매장 ID
   * @param seatId 좌석 ID
   * @param userId 이용자 ID
   * @returns 없음
   * @throws SeatTypeMismatchError 이용권과 좌석의 타입이 다를 때
   * @throws TicketSeatUnassignedError 고정석 이용권에 배정 좌석이 없을 때
   * @throws NotAssignedSeatError 고정석 이용권의 배정 좌석이 아닐 때
   */
  async createSession(
    ticketId: string,
    shopId: string,
    seatId: string,
    userId: string,
  ): Promise<void> {
    const ticket = await this.ticketRepository.getTicketById(ticketId);

    // 이용권과 좌석의 타입이 같아야 입실할 수 있다(FR-011)
    const seatType = await this.repository.findSeatType(seatId);
    if (seatType && seatType !== ticket.seatType) {
      throw new SeatTypeMismatchError(
        '이용권의 좌석 타입과 맞지 않는 좌석입니다',
      );
    }

    // 고정석 이용권은 배정 좌석에만 입실할 수 있다
    if (ticket.seatType === SeatType.FIXED) {
      const assignment =
        await this.seatAssignmentService.getActiveByTicket(ticketId);

      // 배정 좌석이 없으면(자동 결제 취소 대기 등) 입실할 수 없다(R12)
      if (!assignment) throw new TicketSeatUnassignedError();

      if (assignment.seatId !== seatId) {
        throw new NotAssignedSeatError();
      }
    }

    // 미사용(UNUSED) 이용권으로 첫 입실하면 이용권에 기록할 값을 만든다(ACTIVE = 첫 입실 이후)
    // - 기간권: activatedAt과 함께 expiresAt(첫 입실 시각 + 구매 일수)을 기록한다
    // - 시간권: activatedAt만 기록한다(기한은 결제 때 정한 minuteExpireDeadline을 그대로 쓴다)
    let firstEntryUpdate: FirstEntryTicketUpdate | undefined;
    if (ticket.status === 'UNUSED') {
      const now = new Date();
      firstEntryUpdate = { activatedAt: now };
      if (ticket.type === 'PERIOD') {
        firstEntryUpdate.expiresAt = addDays(
          now,
          ticket.purchasedDurationDays!,
        );
        ticket.expiresAt = firstEntryUpdate.expiresAt;
      }
    }

    let plannedEndAt: Date;

    // 만료 예상 시간 계산
    if (ticket.type === 'PERIOD') {
      assertDefined(ticket.expiresAt, 'PERIOD 티켓에 expiresAt이 없습니다');
      plannedEndAt = ticket.expiresAt;
    } else {
      assertDefined(
        ticket.remainingMinutes,
        'TIME 티켓에 remainingMinutes가 없습니다',
      );
      plannedEndAt = addMinutes(new Date(), ticket.remainingMinutes);
    }

    // Step 1. 세션 생성 (첫 입실이면 이용권 UNUSED → ACTIVE 변경도 같은 트랜잭션)
    const sessionId = await this.repository.createSession(
      ticketId,
      shopId,
      seatId,
      userId,
      plannedEndAt,
      new Date(),
      firstEntryUpdate,
      ticket.seatType === SeatType.FIXED
        ? async (tx) => {
            // 검증 이후 배정이 바뀌었으면(좌석 이동·해제) 입실하지 않고 롤백한다
            const assignedSeatId =
              await this.repository.findAssignedSeatIdForUpdate(ticketId, tx);
            if (assignedSeatId !== seatId) throw new NotAssignedSeatError();
          }
        : undefined,
    );

    let bullmqJobId: string;
    try {
      // Step 2. BullMQ Job 생성 (이용권 만료 시 종료 처리 등록)
      bullmqJobId = await this.addJob(sessionId, plannedEndAt);
    } catch (error) {
      await this.repository.failSession(
        sessionId,
        'JOB_CREATION_FAILED',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }

    try {
      // Step 3. BullMQ Job Id를 session에 등록
      await this.repository.registerJobId(sessionId, bullmqJobId);
    } catch (error) {
      await this.removeJob(bullmqJobId);
      await this.repository.failSession(
        sessionId,
        'JOB_REGISTER_FAILED',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }

    try {
      // Step 4. 외부 api 호출(문열림 등) - 실패 시 최대 3회 재시도
      await withRetry(() => mockExternalApi(), {
        maxRetries: 3,
        delayMs: 100,
        isSuccess: (success) => success,
      });
    } catch (error) {
      // 보상: Job 취소 + session 실패 처리
      await this.removeJob(bullmqJobId);
      await this.repository.failSession(
        sessionId,
        'EXTERNAL_API_FAILED',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  // 세션 종료(퇴실)
  async endUsageSession(sessionId: string) {
    const { bullmqJobId } = await this.repository.endUsageSession(
      sessionId,
      new Date(),
    );
    if (bullmqJobId) await this.removeJob(bullmqJobId);
  }

  async getUsageSessionByShop(
    shopId: string,
    sortOrder: SortOrder = 'desc',
    limit: number = 10,
  ) {
    return await this.repository.getUsageSessionByShop(
      shopId,
      sortOrder,
      limit,
    );
  }

  async getUsageSessionByUser(
    userId: string,
    sortOrder: SortOrder = 'desc',
    limit: number = 10,
  ) {
    return await this.repository.getUsageSessionByUser(
      userId,
      sortOrder,
      limit,
    );
  }
}
