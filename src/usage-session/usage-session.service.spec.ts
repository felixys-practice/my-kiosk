/* eslint-disable @typescript-eslint/unbound-method -- jest 목(mock) 메서드를 expect로 검증할 때 생기는 오탐 */
import { Queue } from 'bullmq';
import { TransactionClient } from 'src/prisma/prisma.service';
import { SeatType, TicketStatus, TicketType } from '@prisma/client';
import { NotAssignedSeatError } from 'src/seat-assignment/errors/not-assigned-seat.error';
import { SeatTypeMismatchError } from 'src/seat-assignment/errors/seat-type-mismatch.error';
import { TicketSeatUnassignedError } from 'src/seat-assignment/errors/ticket-seat-unassigned.error';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { TicketRepository } from 'src/ticket/ticket.repository';
import { UsageSessionRepository } from './usage-session.repository';
import { UsageSessionService } from './usage-session.service';

describe('UsageSessionService', () => {
  const shopId = 'shop-1';
  const userId = 'user-1';

  let repository: jest.Mocked<UsageSessionRepository>;
  let ticketRepository: jest.Mocked<TicketRepository>;
  let jobQueue: jest.Mocked<Queue<{ sessionId: string }>>;
  let seatAssignmentService: jest.Mocked<SeatAssignmentService>;
  let service: UsageSessionService;

  /**
   * 테스트용 미사용 시간권을 만든다
   * @param seatType 이용권 좌석 타입
   * @param assignedSeatId 배정 좌석 ID(고정석)
   * @returns 이용권 조회 결과
   */
  function timeTicket(seatType: SeatType, assignedSeatId?: string) {
    return {
      type: TicketType.TIME,
      userId,
      status: TicketStatus.UNUSED,
      minuteExpireDeadline: new Date('2026-11-22T00:00:00Z'),
      remainingMinutes: 600,
      activationDeadline: null,
      activatedAt: null,
      expiresAt: null,
      purchasedMinutes: 600,
      purchasedDurationDays: null,
      seatType,
      seatAssignments: assignedSeatId
        ? [{ seat: { id: assignedSeatId, number: 1, name: 'A1' } }]
        : [],
      usageSessions: [],
      ticketPauses: [],
    } as unknown as Awaited<ReturnType<TicketRepository['getTicketById']>>;
  }

  beforeEach(() => {
    repository = {
      createSession: jest.fn().mockResolvedValue('session-1'),
      registerJobId: jest.fn(),
      failSession: jest.fn(),
      findSeatType: jest.fn(),
      findAssignedSeatIdForUpdate: jest.fn(),
    } as unknown as jest.Mocked<UsageSessionRepository>;
    ticketRepository = {
      getTicketById: jest.fn(),
    } as unknown as jest.Mocked<TicketRepository>;
    jobQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn(),
    } as unknown as jest.Mocked<Queue<{ sessionId: string }>>;
    seatAssignmentService = {
      getActiveByTicket: jest.fn(),
    } as unknown as jest.Mocked<SeatAssignmentService>;
    service = new UsageSessionService(
      repository,
      ticketRepository,
      jobQueue,
      seatAssignmentService,
    );
  });

  describe('createSession', () => {
    it('자유석 이용권으로 고정석에 입실하면 SeatTypeMismatchError다', async () => {
      ticketRepository.getTicketById.mockResolvedValue(
        timeTicket(SeatType.FREE),
      );
      repository.findSeatType.mockResolvedValue(SeatType.FIXED);

      await expect(
        service.createSession('ticket-1', shopId, 'seat-fixed', userId),
      ).rejects.toBeInstanceOf(SeatTypeMismatchError);
      expect(repository.createSession).not.toHaveBeenCalled();
    });

    it('고정석 이용권으로 자유석에 입실하면 SeatTypeMismatchError다', async () => {
      ticketRepository.getTicketById.mockResolvedValue(
        timeTicket(SeatType.FIXED, 'seat-fixed'),
      );
      repository.findSeatType.mockResolvedValue(SeatType.FREE);

      await expect(
        service.createSession('ticket-1', shopId, 'seat-free', userId),
      ).rejects.toBeInstanceOf(SeatTypeMismatchError);
      expect(repository.createSession).not.toHaveBeenCalled();
    });

    it('고정석 이용권으로 배정되지 않은 고정석에 입실하면 NotAssignedSeatError다', async () => {
      ticketRepository.getTicketById.mockResolvedValue(
        timeTicket(SeatType.FIXED, 'seat-assigned'),
      );
      repository.findSeatType.mockResolvedValue(SeatType.FIXED);
      seatAssignmentService.getActiveByTicket.mockResolvedValue({
        seatId: 'seat-assigned',
      } as Awaited<ReturnType<SeatAssignmentService['getActiveByTicket']>>);

      await expect(
        service.createSession('ticket-1', shopId, 'seat-other', userId),
      ).rejects.toBeInstanceOf(NotAssignedSeatError);
      expect(repository.createSession).not.toHaveBeenCalled();
    });

    it('고정석 이용권으로 배정 좌석에 입실하면 세션을 만든다', async () => {
      // 외부 API 스텁(무작위 실패)이 항상 성공하도록 고정한다
      jest.spyOn(Math, 'random').mockReturnValue(0.99);
      ticketRepository.getTicketById.mockResolvedValue(
        timeTicket(SeatType.FIXED, 'seat-assigned'),
      );
      repository.findSeatType.mockResolvedValue(SeatType.FIXED);
      seatAssignmentService.getActiveByTicket.mockResolvedValue({
        seatId: 'seat-assigned',
      } as Awaited<ReturnType<SeatAssignmentService['getActiveByTicket']>>);

      await service.createSession('ticket-1', shopId, 'seat-assigned', userId);

      expect(repository.createSession).toHaveBeenCalled();
      jest.restoreAllMocks();
    }, 10000);

    it('배정 좌석이 없는 고정석 이용권으로 입실하면 TicketSeatUnassignedError다', async () => {
      ticketRepository.getTicketById.mockResolvedValue(
        timeTicket(SeatType.FIXED),
      );
      repository.findSeatType.mockResolvedValue(SeatType.FIXED);
      seatAssignmentService.getActiveByTicket.mockResolvedValue(null);

      await expect(
        service.createSession('ticket-1', shopId, 'seat-1', userId),
      ).rejects.toBeInstanceOf(TicketSeatUnassignedError);
      expect(repository.createSession).not.toHaveBeenCalled();
    });

    it('세션 생성 트랜잭션에서 다시 조회한 배정 좌석이 다르면 NotAssignedSeatError다', async () => {
      const tx = {} as TransactionClient;
      ticketRepository.getTicketById.mockResolvedValue(
        timeTicket(SeatType.FIXED, 'seat-assigned'),
      );
      repository.findSeatType.mockResolvedValue(SeatType.FIXED);
      // 트랜잭션 전 조회: 요청 좌석 / 트랜잭션 안 재조회: 다른 좌석
      seatAssignmentService.getActiveByTicket.mockResolvedValue({
        seatId: 'seat-assigned',
      } as Awaited<ReturnType<SeatAssignmentService['getActiveByTicket']>>);
      repository.findAssignedSeatIdForUpdate.mockResolvedValue('seat-moved');
      // 트랜잭션 시작 직후 확인 함수를 실행하는 Repository 동작을 흉내 낸다
      repository.createSession.mockImplementation(
        async (
          ...args: Parameters<UsageSessionRepository['createSession']>
        ) => {
          const beforeCreate = args[7];
          await beforeCreate?.(tx);
          return 'session-1';
        },
      );

      await expect(
        service.createSession('ticket-1', shopId, 'seat-assigned', userId),
      ).rejects.toBeInstanceOf(NotAssignedSeatError);
      expect(repository.findAssignedSeatIdForUpdate).toHaveBeenCalledWith(
        'ticket-1',
        tx,
      );
    }, 10000);

    it('미사용 기간권으로 처음 입실하면 activatedAt과 expiresAt을 함께 넘긴다', async () => {
      // 외부 API 스텁(무작위 실패)이 항상 성공하도록 고정한다
      jest.spyOn(Math, 'random').mockReturnValue(0.99);
      ticketRepository.getTicketById.mockResolvedValue({
        ...timeTicket(SeatType.FREE),
        type: TicketType.PERIOD,
        minuteExpireDeadline: null,
        remainingMinutes: null,
        purchasedMinutes: null,
        purchasedDurationDays: 30,
      });
      repository.findSeatType.mockResolvedValue(SeatType.FREE);

      await service.createSession('ticket-1', shopId, 'seat-free', userId);

      // repository createSession의 7번째 인자: activatedAt(첫 입실 시각)과 30일 뒤 expiresAt
      const firstEntryUpdate = repository.createSession.mock.calls[0][6];
      expect(firstEntryUpdate?.activatedAt).toBeInstanceOf(Date);
      expect(firstEntryUpdate?.expiresAt).toBeInstanceOf(Date);
      expect(
        (firstEntryUpdate?.expiresAt?.getTime() ?? 0) -
          (firstEntryUpdate?.activatedAt.getTime() ?? 0),
      ).toBe(30 * 24 * 60 * 60 * 1000);
      jest.restoreAllMocks();
    }, 10000);

    it('미사용 시간권으로 처음 입실하면 activatedAt만 넘기고 expiresAt은 넘기지 않는다', async () => {
      // 외부 API 스텁(무작위 실패)이 항상 성공하도록 고정한다
      jest.spyOn(Math, 'random').mockReturnValue(0.99);
      ticketRepository.getTicketById.mockResolvedValue(
        timeTicket(SeatType.FREE),
      );
      repository.findSeatType.mockResolvedValue(SeatType.FREE);

      await service.createSession('ticket-1', shopId, 'seat-free', userId);

      // 시간권 기한(minuteExpireDeadline)은 결제 때 정해지므로 첫 입실 때 expiresAt을 계산하지 않는다
      const firstEntryUpdate = repository.createSession.mock.calls[0][6];
      expect(firstEntryUpdate?.activatedAt).toBeInstanceOf(Date);
      expect(firstEntryUpdate).not.toHaveProperty('expiresAt');
      jest.restoreAllMocks();
    }, 10000);

    it('이미 ACTIVE인 시간권으로 다시 입실하면 7번째 인자를 넘기지 않는다', async () => {
      // 외부 API 스텁(무작위 실패)이 항상 성공하도록 고정한다
      jest.spyOn(Math, 'random').mockReturnValue(0.99);
      ticketRepository.getTicketById.mockResolvedValue({
        ...timeTicket(SeatType.FREE),
        status: TicketStatus.ACTIVE,
        activatedAt: new Date('2026-10-20T00:00:00Z'),
      });
      repository.findSeatType.mockResolvedValue(SeatType.FREE);

      await service.createSession('ticket-1', shopId, 'seat-free', userId);

      // 첫 입실 시각(activatedAt)을 덮어쓰지 않는다
      expect(repository.createSession.mock.calls[0][6]).toBeUndefined();
      jest.restoreAllMocks();
    }, 10000);

    it('자유석 이용권으로 자유석에 입실하면 세션을 만든다', async () => {
      // 외부 API 스텁(무작위 실패)이 항상 성공하도록 고정한다
      jest.spyOn(Math, 'random').mockReturnValue(0.99);
      ticketRepository.getTicketById.mockResolvedValue(
        timeTicket(SeatType.FREE),
      );
      repository.findSeatType.mockResolvedValue(SeatType.FREE);

      await service.createSession('ticket-1', shopId, 'seat-free', userId);

      expect(repository.createSession).toHaveBeenCalled();
      jest.restoreAllMocks();
    }, 10000);
  });
});
