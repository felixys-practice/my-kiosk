/* eslint-disable @typescript-eslint/unbound-method -- jest 목(mock) 메서드를 expect로 검증할 때 생기는 오탐 */
import { Queue } from 'bullmq';
import {
  SeatReleaseReason,
  SeatType,
  TicketSeatChangeType,
  TicketStatus,
} from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { SeatNotFoundError } from 'src/seat/errors/seat-not-found.error';
import { SeatShopMismatchError } from 'src/seat-assignment/errors/seat-shop-mismatch.error';
import { SeatTypeMismatchError } from 'src/seat-assignment/errors/seat-type-mismatch.error';
import { SessionLifecycleService } from 'src/session-lifecycle/session-lifecycle.service';
import { SeatAlreadyOccupiedError } from 'src/usage-session/errors/seat-already-occupied.error';
import { TicketClosedError } from '../errors/ticket-closed.error';
import { TicketNotFoundError } from '../errors/ticket-not-found.error';
import { TicketPausedError } from '../errors/ticket-paused.error';
import { TicketSeatUnchangedError } from '../errors/ticket-seat-unchanged.error';
import { TicketSeatRepository } from './ticket-seat.repository';
import { TicketSeatService } from './ticket-seat.service';

describe('TicketSeatService', () => {
  const tx = {} as TransactionClient;
  const ticketId = 'ticket-1';
  const shopId = 'shop-1';
  const ownerId = 'owner-1';

  let repository: jest.Mocked<TicketSeatRepository>;
  let seatAssignmentService: jest.Mocked<SeatAssignmentService>;
  let sessionLifecycle: jest.Mocked<SessionLifecycleService>;
  let queue: jest.Mocked<Queue>;
  let service: TicketSeatService;

  /**
   * 잠근 이용권 스냅샷을 만든다
   * @param seatType 현재 좌석 타입
   * @returns 이용권 스냅샷
   */
  function lockedTicket(seatType: SeatType) {
    return { id: ticketId, status: TicketStatus.UNUSED, seatType, shopId };
  }

  beforeEach(() => {
    repository = {
      runInTransaction: jest.fn((work: (tx: TransactionClient) => unknown) =>
        Promise.resolve(work(tx)),
      ),
      getTicketForUpdate: jest
        .fn()
        .mockResolvedValue(lockedTicket(SeatType.FREE)),
      updateSeatType: jest.fn(),
      createSeatChange: jest.fn(),
      findActiveSession: jest.fn().mockResolvedValue(null),
      updateSessionSeat: jest.fn(),
      hasOtherActiveSessionOnSeat: jest.fn().mockResolvedValue(false),
      hasActivePause: jest.fn().mockResolvedValue(false),
      findSeatChanges: jest.fn(),
      findSeat: jest
        .fn()
        .mockResolvedValue({ type: SeatType.FIXED, shopId: 'shop-1' }),
    } as unknown as jest.Mocked<TicketSeatRepository>;
    seatAssignmentService = {
      assign: jest.fn(),
      releaseByTicket: jest.fn(),
      getActiveByTicket: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<SeatAssignmentService>;
    sessionLifecycle = {
      endSession: jest.fn().mockResolvedValue({
        ticketId,
        bullmqJobId: null,
        alreadyEnded: false,
      }),
    } as unknown as jest.Mocked<SessionLifecycleService>;
    queue = {
      remove: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<Queue>;
    service = new TicketSeatService(
      repository,
      seatAssignmentService,
      sessionLifecycle,
      queue,
    );
  });

  describe('changeSeat', () => {
    it('자유석 이용권을 고정석으로 바꾸면 새 배정을 만들고 이력 1행을 남긴다', async () => {
      await service.changeSeat(
        ticketId,
        { seatType: SeatType.FIXED, seatId: 'seat-1', reason: '이용자 요청' },
        ownerId,
      );

      expect(seatAssignmentService.assign).toHaveBeenCalledWith(
        { seatId: 'seat-1', shopId, ticketId },
        expect.any(Date),
        tx,
      );
      expect(repository.updateSeatType).toHaveBeenCalledWith(
        ticketId,
        SeatType.FIXED,
        tx,
      );
      expect(repository.createSeatChange).toHaveBeenCalledTimes(1);
      expect(repository.createSeatChange).toHaveBeenCalledWith(
        {
          ticketId,
          changeType: TicketSeatChangeType.TYPE_CHANGE,
          fromSeatType: SeatType.FREE,
          toSeatType: SeatType.FIXED,
          fromSeatId: null,
          toSeatId: 'seat-1',
          reason: '이용자 요청',
          changedBy: ownerId,
          endedSessionId: null,
        },
        tx,
      );
    });

    it('이용 중에 타입을 바꾸면 세션을 종료하고 이력에 종료 세션 ID를 남긴다', async () => {
      repository.findActiveSession.mockResolvedValue({
        id: 'session-1',
        seatId: 'seat-free',
      });
      sessionLifecycle.endSession.mockResolvedValue({
        ticketId,
        bullmqJobId: 'job-1',
        alreadyEnded: false,
      });

      await service.changeSeat(
        ticketId,
        { seatType: SeatType.FIXED, seatId: 'seat-1', reason: '고정석 전환' },
        ownerId,
      );

      expect(sessionLifecycle.endSession).toHaveBeenCalledWith(
        'session-1',
        expect.any(Date),
        tx,
      );
      expect(repository.createSeatChange).toHaveBeenCalledWith(
        expect.objectContaining({ endedSessionId: 'session-1' }),
        tx,
      );
      // 커밋 후 자동 종료 Job 제거
      expect(queue.remove).toHaveBeenCalledWith('job-1');
    });

    it('고정석 이용권을 자유석으로 바꾸면 배정을 SEAT_TYPE_CHANGED로 해제한다', async () => {
      repository.getTicketForUpdate.mockResolvedValue(
        lockedTicket(SeatType.FIXED),
      );
      seatAssignmentService.getActiveByTicket.mockResolvedValue({
        seatId: 'seat-1',
      } as Awaited<ReturnType<SeatAssignmentService['getActiveByTicket']>>);

      await service.changeSeat(
        ticketId,
        { seatType: SeatType.FREE, reason: '자유석 전환' },
        ownerId,
      );

      expect(seatAssignmentService.releaseByTicket).toHaveBeenCalledWith(
        ticketId,
        SeatReleaseReason.SEAT_TYPE_CHANGED,
        expect.any(Date),
        tx,
      );
      expect(repository.createSeatChange).toHaveBeenCalledWith(
        expect.objectContaining({
          changeType: TicketSeatChangeType.TYPE_CHANGE,
          fromSeatType: SeatType.FIXED,
          toSeatType: SeatType.FREE,
          fromSeatId: 'seat-1',
          toSeatId: null,
        }),
        tx,
      );
    });

    it('고정석을 다른 고정석으로 옮기면 기존 배정을 SEAT_MOVED로 해제하고 새 배정을 만든다', async () => {
      repository.getTicketForUpdate.mockResolvedValue(
        lockedTicket(SeatType.FIXED),
      );
      seatAssignmentService.getActiveByTicket.mockResolvedValue({
        seatId: 'seat-old',
      } as Awaited<ReturnType<SeatAssignmentService['getActiveByTicket']>>);
      const calls: string[] = [];
      seatAssignmentService.releaseByTicket.mockImplementation(() => {
        calls.push('release');
        return Promise.resolve(null);
      });
      seatAssignmentService.assign.mockImplementation(() => {
        calls.push('assign');
        return Promise.resolve();
      });

      await service.changeSeat(
        ticketId,
        { seatType: SeatType.FIXED, seatId: 'seat-new', reason: '좌석 이동' },
        ownerId,
      );

      expect(seatAssignmentService.releaseByTicket).toHaveBeenCalledWith(
        ticketId,
        SeatReleaseReason.SEAT_MOVED,
        expect.any(Date),
        tx,
      );
      // 기존 배정을 먼저 해제해야 이용권당 ACTIVE 1개 제약에 걸리지 않는다
      expect(calls).toEqual(['release', 'assign']);
      expect(repository.createSeatChange).toHaveBeenCalledWith(
        expect.objectContaining({
          changeType: TicketSeatChangeType.SEAT_MOVE,
          fromSeatId: 'seat-old',
          toSeatId: 'seat-new',
        }),
        tx,
      );
    });

    it('이용 중에 고정석을 옮기면 세션을 종료하지 않고 세션 좌석만 바꾼다', async () => {
      repository.getTicketForUpdate.mockResolvedValue(
        lockedTicket(SeatType.FIXED),
      );
      seatAssignmentService.getActiveByTicket.mockResolvedValue({
        seatId: 'seat-old',
      } as Awaited<ReturnType<SeatAssignmentService['getActiveByTicket']>>);
      repository.findActiveSession.mockResolvedValue({
        id: 'session-1',
        seatId: 'seat-old',
      });

      await service.changeSeat(
        ticketId,
        { seatType: SeatType.FIXED, seatId: 'seat-new', reason: '좌석 이동' },
        ownerId,
      );

      expect(sessionLifecycle.endSession).not.toHaveBeenCalled();
      expect(repository.updateSessionSeat).toHaveBeenCalledWith(
        'session-1',
        'seat-new',
        tx,
      );
      expect(repository.createSeatChange).toHaveBeenCalledWith(
        expect.objectContaining({ endedSessionId: null }),
        tx,
      );
    });

    it('옮길 좌석에 다른 활성 세션이 있으면 SeatAlreadyOccupiedError다', async () => {
      repository.getTicketForUpdate.mockResolvedValue(
        lockedTicket(SeatType.FIXED),
      );
      seatAssignmentService.getActiveByTicket.mockResolvedValue({
        seatId: 'seat-old',
      } as Awaited<ReturnType<SeatAssignmentService['getActiveByTicket']>>);
      repository.hasOtherActiveSessionOnSeat.mockResolvedValue(true);

      await expect(
        service.changeSeat(
          ticketId,
          { seatType: SeatType.FIXED, seatId: 'seat-new', reason: '좌석 이동' },
          ownerId,
        ),
      ).rejects.toBeInstanceOf(SeatAlreadyOccupiedError);
      expect(repository.createSeatChange).not.toHaveBeenCalled();
    });

    it('고정석으로 바꿀 좌석이 자유석이면 SeatTypeMismatchError다', async () => {
      repository.findSeat.mockResolvedValue({ type: SeatType.FREE, shopId });

      await expect(
        service.changeSeat(
          ticketId,
          { seatType: SeatType.FIXED, seatId: 'seat-free', reason: '요청' },
          ownerId,
        ),
      ).rejects.toBeInstanceOf(SeatTypeMismatchError);
    });

    it('고정석으로 바꿀 좌석이 다른 매장 좌석이면 SeatShopMismatchError다', async () => {
      repository.findSeat.mockResolvedValue({
        type: SeatType.FIXED,
        shopId: 'other-shop',
      });

      await expect(
        service.changeSeat(
          ticketId,
          { seatType: SeatType.FIXED, seatId: 'seat-other', reason: '요청' },
          ownerId,
        ),
      ).rejects.toBeInstanceOf(SeatShopMismatchError);
    });

    it('자유석 이용권을 자유석으로 바꾸면 TicketSeatUnchangedError다', async () => {
      await expect(
        service.changeSeat(
          ticketId,
          { seatType: SeatType.FREE, reason: '변경 없음' },
          ownerId,
        ),
      ).rejects.toBeInstanceOf(TicketSeatUnchangedError);
      expect(repository.createSeatChange).not.toHaveBeenCalled();
    });

    it('고정석 이용권을 같은 좌석으로 바꾸면 TicketSeatUnchangedError다', async () => {
      repository.getTicketForUpdate.mockResolvedValue(
        lockedTicket(SeatType.FIXED),
      );
      seatAssignmentService.getActiveByTicket.mockResolvedValue({
        seatId: 'seat-1',
      } as Awaited<ReturnType<SeatAssignmentService['getActiveByTicket']>>);

      await expect(
        service.changeSeat(
          ticketId,
          { seatType: SeatType.FIXED, seatId: 'seat-1', reason: '변경 없음' },
          ownerId,
        ),
      ).rejects.toBeInstanceOf(TicketSeatUnchangedError);
      expect(seatAssignmentService.releaseByTicket).not.toHaveBeenCalled();
    });

    it.each([
      TicketStatus.EXPIRED,
      TicketStatus.EXHAUSTED,
      TicketStatus.REVOKED,
    ])(
      '종료 상태(EXPIRED·EXHAUSTED·REVOKED) 이용권이면 TicketClosedError다 (%s)',
      async (status) => {
        repository.getTicketForUpdate.mockResolvedValue({
          ...lockedTicket(SeatType.FREE),
          status,
        });

        await expect(
          service.changeSeat(
            ticketId,
            { seatType: SeatType.FIXED, seatId: 'seat-1', reason: '요청' },
            ownerId,
          ),
        ).rejects.toBeInstanceOf(TicketClosedError);
      },
    );

    it('일시정지 중인 이용권이면 TicketPausedError다', async () => {
      repository.hasActivePause.mockResolvedValue(true);

      await expect(
        service.changeSeat(
          ticketId,
          { seatType: SeatType.FIXED, seatId: 'seat-1', reason: '요청' },
          ownerId,
        ),
      ).rejects.toBeInstanceOf(TicketPausedError);
    });

    it('이용권이 없으면 TicketNotFoundError다', async () => {
      repository.getTicketForUpdate.mockResolvedValue(null);

      await expect(
        service.changeSeat(
          ticketId,
          { seatType: SeatType.FIXED, seatId: 'seat-1', reason: '요청' },
          ownerId,
        ),
      ).rejects.toBeInstanceOf(TicketNotFoundError);
    });

    it('고정석으로 바꿀 좌석이 없으면 SeatNotFoundError다', async () => {
      repository.findSeat.mockResolvedValue(null);

      await expect(
        service.changeSeat(
          ticketId,
          { seatType: SeatType.FIXED, seatId: 'seat-x', reason: '요청' },
          ownerId,
        ),
      ).rejects.toBeInstanceOf(SeatNotFoundError);
    });
  });

  describe('getSeatChanges', () => {
    it('이용권의 좌석 변경 이력을 최신순으로 반환한다', async () => {
      const rows = [
        { id: 'change-2', changedAt: new Date('2026-10-23T02:00:00Z') },
        { id: 'change-1', changedAt: new Date('2026-10-23T01:00:00Z') },
      ];
      repository.findSeatChanges.mockResolvedValue(
        rows as Awaited<ReturnType<TicketSeatRepository['findSeatChanges']>>,
      );

      const result = await service.getSeatChanges(ticketId);

      expect(repository.findSeatChanges).toHaveBeenCalledWith(ticketId);
      expect(result).toEqual(rows);
    });
  });
});
