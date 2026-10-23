/* eslint-disable @typescript-eslint/unbound-method -- jest 목(mock) 메서드를 expect로 검증할 때 생기는 오탐 */
import { Queue } from 'bullmq';
import {
  SeatReleaseReason,
  SeatType,
  TicketStatus,
  TicketType,
} from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';
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

  let repository: jest.Mocked<TicketPauseRepository>;
  let sessionLifecycle: jest.Mocked<SessionLifecycleService>;
  let queue: jest.Mocked<Queue>;
  let seatAssignmentService: jest.Mocked<SeatAssignmentService>;
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
      runInTransaction: jest.fn((work: (tx: TransactionClient) => unknown) =>
        Promise.resolve(work(tx)),
      ),
      getTicketForUpdate: jest
        .fn()
        .mockResolvedValue(activePeriodTicket(SeatType.FIXED)),
      findActivePause: jest.fn().mockResolvedValue(null),
      findActiveSessionId: jest.fn().mockResolvedValue(null),
      createPause: jest.fn(),
      resumePause: jest.fn(),
      extendTicketDeadline: jest.fn(),
    } as unknown as jest.Mocked<TicketPauseRepository>;
    sessionLifecycle = {
      endSession: jest.fn(),
    } as unknown as jest.Mocked<SessionLifecycleService>;
    queue = {
      remove: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<Queue>;
    seatAssignmentService = {
      releaseByTicket: jest.fn(),
      assign: jest.fn(),
    } as unknown as jest.Mocked<SeatAssignmentService>;
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
