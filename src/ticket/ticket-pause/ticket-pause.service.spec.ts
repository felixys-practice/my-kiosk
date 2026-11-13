/* eslint-disable @typescript-eslint/unbound-method -- Vitest 목(mock) 메서드를 expect로 검증할 때 생기는 오탐 */
import { vi, type Mocked } from 'vitest';
import { Queue } from 'bullmq';
import {
  SeatReleaseReason,
  SeatType,
  TicketStatus,
  TicketType,
} from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';
import { DomainConflictError } from 'src/common/errors';
import { SeatSelectionRequiredError } from 'src/seat-assignment/errors/seat-selection-required.error';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { SessionLifecycleService } from 'src/session-lifecycle/session-lifecycle.service';
import { TicketPauseRepository } from './ticket-pause.repository';
import { TicketPauseService } from './ticket-pause.service';

describe('TicketPauseService', () => {
  const tx = {} as TransactionClient;
  const ticketId = 'ticket-1';
  const shopId = 'shop-1';
  const ownerId = 'owner-1';

  let repository: Mocked<TicketPauseRepository>;
  let sessionLifecycle: Mocked<SessionLifecycleService>;
  let queue: Mocked<Queue>;
  let seatAssignmentService: Mocked<SeatAssignmentService>;
  let service: TicketPauseService;

  /**
   * 잠근 활성 기간권 스냅샷을 만든다
   * @param seatType 좌석 타입
   * @returns 이용권 스냅샷
   */
  function activePeriodTicket(seatType: SeatType) {
    return {
      id: ticketId,
      type: TicketType.PERIOD,
      status: TicketStatus.ACTIVE,
      remainingMinutes: null,
      minuteExpireDeadline: null,
      expiresAt: new Date('2026-11-22T00:00:00Z'),
      seatType,
      shopId,
    };
  }

  beforeEach(() => {
    repository = {
      runInTransaction: vi.fn((work: (tx: TransactionClient) => unknown) =>
        Promise.resolve(work(tx)),
      ),
      getTicketForUpdate: vi
        .fn()
        .mockResolvedValue(activePeriodTicket(SeatType.FIXED)),
      findActivePause: vi.fn().mockResolvedValue(null),
      findActiveSessionId: vi.fn().mockResolvedValue(null),
      createPause: vi.fn(),
      resumePause: vi.fn(),
      extendTicketDeadline: vi.fn(),
    } as unknown as Mocked<TicketPauseRepository>;
    sessionLifecycle = {
      endSession: vi.fn(),
    } as unknown as Mocked<SessionLifecycleService>;
    queue = {
      remove: vi.fn().mockResolvedValue(1),
    } as unknown as Mocked<Queue>;
    seatAssignmentService = {
      releaseByTicket: vi.fn(),
      assign: vi.fn(),
    } as unknown as Mocked<SeatAssignmentService>;
    service = new TicketPauseService(
      repository,
      sessionLifecycle,
      queue,
      seatAssignmentService,
    );
  });

  describe('pauseTicket', () => {
    it('고정석 이용권을 일시정지하면 같은 트랜잭션에서 TICKET_PAUSED로 배정을 해제한다', async () => {
      await service.pauseTicket(ticketId, ownerId, '장기 출장');

      expect(seatAssignmentService.releaseByTicket).toHaveBeenCalledWith(
        ticketId,
        SeatReleaseReason.TICKET_PAUSED,
        expect.any(Date),
        tx,
      );
    });
  });

  describe('resumeTicket', () => {
    beforeEach(() => {
      repository.findActivePause.mockResolvedValue({
        id: 'pause-1',
        pausedAt: new Date('2026-10-20T00:00:00Z'),
      } as Awaited<ReturnType<TicketPauseRepository['findActivePause']>>);
    });

    it('환불로 종료된(REVOKED) 이용권의 재개는 정지 기록이 닫혔어도 TICKET_TERMINATED로 거절된다', async () => {
      repository.getTicketForUpdate.mockResolvedValue({
        ...activePeriodTicket(SeatType.FIXED),
        status: TicketStatus.REVOKED,
      });
      // 환불이 정지 기록을 닫았으므로 진행 중 정지가 없다
      repository.findActivePause.mockResolvedValue(null);

      const resume = service.resumeTicket(ticketId, ownerId, '복귀', 'seat-1');

      await expect(resume).rejects.toBeInstanceOf(DomainConflictError);
      await expect(resume).rejects.toMatchObject({ code: 'TICKET_TERMINATED' });
      expect(repository.resumePause).not.toHaveBeenCalled();
      expect(seatAssignmentService.assign).not.toHaveBeenCalled();
    });

    it('고정석 이용권을 재개하면 요청한 좌석으로 다시 배정한다', async () => {
      await service.resumeTicket(ticketId, ownerId, '복귀', 'seat-1');

      expect(seatAssignmentService.assign).toHaveBeenCalledWith(
        { seatId: 'seat-1', shopId, ticketId },
        expect.any(Date),
        tx,
      );
    });

    it('고정석 이용권을 좌석 없이 재개하면 SeatSelectionRequiredError다', async () => {
      await expect(
        service.resumeTicket(ticketId, ownerId, '복귀'),
      ).rejects.toBeInstanceOf(SeatSelectionRequiredError);
      expect(seatAssignmentService.assign).not.toHaveBeenCalled();
    });

    it('자유석 이용권은 좌석 없이 재개하고 배정을 만들지 않는다', async () => {
      repository.getTicketForUpdate.mockResolvedValue(
        activePeriodTicket(SeatType.FREE),
      );

      await service.resumeTicket(ticketId, ownerId, '복귀');

      expect(repository.resumePause).toHaveBeenCalled();
      expect(seatAssignmentService.assign).not.toHaveBeenCalled();
    });
  });
});
