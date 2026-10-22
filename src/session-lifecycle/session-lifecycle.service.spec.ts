/* eslint-disable @typescript-eslint/unbound-method -- jest 목(mock) 메서드를 expect로 검증할 때 생기는 오탐 */
import { SeatReleaseReason, TicketStatus } from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { SessionLifecycleService } from './session-lifecycle.service';

describe('SessionLifecycleService', () => {
  const now = new Date('2026-10-23T12:00:00Z');

  let tx: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    usageSession: { update: jest.Mock };
  };
  let seatAssignmentService: jest.Mocked<SeatAssignmentService>;
  let service: SessionLifecycleService;

  /** 이용 중인 시간권 세션(2분 전 시작) */
  const activeTimeSession = {
    id: 'session-1',
    status: 'ACTIVE',
    startedAt: new Date('2026-10-23T11:58:00Z'),
    ticketId: 'ticket-1',
    ticketType: 'TIME',
    bullmqJobId: 'job-1',
  };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      usageSession: { update: jest.fn() },
    };
    seatAssignmentService = {
      releaseByTicket: jest.fn(),
    } as unknown as jest.Mocked<SeatAssignmentService>;
    service = new SessionLifecycleService(seatAssignmentService);
  });

  describe('endSession', () => {
    it('시간권이 소진되면 같은 트랜잭션에서 TICKET_EXHAUSTED로 배정을 해제한다', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([activeTimeSession])
        .mockResolvedValueOnce([{ status: TicketStatus.EXHAUSTED }]);

      await service.endSession(
        'session-1',
        now,
        tx as unknown as TransactionClient,
      );

      expect(seatAssignmentService.releaseByTicket).toHaveBeenCalledWith(
        'ticket-1',
        SeatReleaseReason.TICKET_EXHAUSTED,
        now,
        tx,
      );
    });

    it('시간권이 소진되지 않으면 배정을 해제하지 않는다', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([activeTimeSession])
        .mockResolvedValueOnce([{ status: TicketStatus.ACTIVE }]);

      await service.endSession(
        'session-1',
        now,
        tx as unknown as TransactionClient,
      );

      expect(seatAssignmentService.releaseByTicket).not.toHaveBeenCalled();
    });
  });
});
