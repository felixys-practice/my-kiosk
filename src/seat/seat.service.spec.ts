/* eslint-disable @typescript-eslint/unbound-method -- jest 목(mock) 메서드를 expect로 검증할 때 생기는 오탐 */
import { SeatStatus, SeatType } from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { OpenSeatAssignment } from 'src/seat-assignment/seat-assignment.repository';
import { SeatAlreadyOccupiedError } from 'src/usage-session/errors/seat-already-occupied.error';
import { SeatHasAssignmentError } from './errors/seat-has-assignment.error';
import { SeatNotFoundError } from './errors/seat-not-found.error';
import { SeatRepository } from './seat.repository';
import { SeatService } from './seat.service';

describe('SeatService', () => {
  const tx = {} as TransactionClient;
  const seatId = 'seat-1';

  let repository: jest.Mocked<SeatRepository>;
  let seatAssignmentService: jest.Mocked<SeatAssignmentService>;
  let service: SeatService;

  /** 유효한 배정 1건 */
  const validAssignment: OpenSeatAssignment = {
    id: 'assignment-1',
    seatId,
    orderItemId: 'order-item-1',
    ticketId: null,
    status: 'HELD',
    heldUntil: new Date(Date.now() + 60_000),
    ticket: null,
  };

  beforeEach(() => {
    repository = {
      getSeat: jest.fn(),
      createSeat: jest.fn(),
      updateSeat: jest.fn(),
      deleteSeat: jest.fn(),
      getLastSeatNumber: jest.fn(),
      findByIdForUpdate: jest.fn(),
      hasActiveSession: jest.fn(),
      runInTransaction: jest.fn((work: (tx: TransactionClient) => unknown) =>
        Promise.resolve(work(tx)),
      ),
    } as unknown as jest.Mocked<SeatRepository>;
    seatAssignmentService = {
      findValidBySeat: jest.fn(),
      getAssignableMap: jest.fn(),
    } as unknown as jest.Mocked<SeatAssignmentService>;
    service = new SeatService(repository, seatAssignmentService);

    // 기본: 이용 중이 아닌 사용 가능한 고정석, 유효 배정 없음
    repository.findByIdForUpdate.mockResolvedValue({
      id: seatId,
      type: SeatType.FIXED,
      status: SeatStatus.AVAILABLE,
    });
    repository.hasActiveSession.mockResolvedValue(false);
    seatAssignmentService.findValidBySeat.mockResolvedValue(null);
  });

  describe('createSeat', () => {
    it('지정한 좌석 타입으로 좌석을 등록한다', async () => {
      await service.createSeat('shop-1', {
        name: 'A1',
        number: 1,
        type: SeatType.FIXED,
      });

      expect(repository.createSeat).toHaveBeenCalledWith({
        number: 1,
        name: 'A1',
        type: SeatType.FIXED,
        shop: { connect: { id: 'shop-1' } },
      });
    });

    it('좌석 번호가 없으면 마지막 번호 다음 값으로 등록한다', async () => {
      repository.getLastSeatNumber.mockResolvedValue(7);

      await service.createSeat('shop-1', { type: SeatType.FREE });

      expect(repository.createSeat).toHaveBeenCalledWith(
        expect.objectContaining({ number: 8, type: SeatType.FREE }),
      );
    });
  });

  describe('updateSeat', () => {
    it('이름·번호만 바꾸면 이용 중이어도 그대로 수정한다', async () => {
      repository.hasActiveSession.mockResolvedValue(true);

      await service.updateSeat(seatId, { name: 'B1' });

      expect(repository.updateSeat).toHaveBeenCalledWith(
        seatId,
        { name: 'B1' },
        tx,
      );
    });

    it('이용 중인 좌석의 타입을 바꾸면 SeatAlreadyOccupiedError(409)를 던진다', async () => {
      repository.hasActiveSession.mockResolvedValue(true);

      await expect(
        service.updateSeat(seatId, { type: SeatType.FREE }),
      ).rejects.toBeInstanceOf(SeatAlreadyOccupiedError);
      expect(repository.updateSeat).not.toHaveBeenCalled();
    });

    it('이용 중인 좌석의 상태를 바꾸면 SeatAlreadyOccupiedError(409)를 던진다', async () => {
      repository.findByIdForUpdate.mockResolvedValue({
        id: seatId,
        type: SeatType.FREE,
        status: SeatStatus.AVAILABLE,
      });
      repository.hasActiveSession.mockResolvedValue(true);

      await expect(
        service.updateSeat(seatId, { status: SeatStatus.UNAVAILABLE }),
      ).rejects.toBeInstanceOf(SeatAlreadyOccupiedError);
    });

    it('유효 배정이 있는 고정석을 자유석으로 바꾸면 SeatHasAssignmentError(409)를 던진다', async () => {
      seatAssignmentService.findValidBySeat.mockResolvedValue(validAssignment);

      await expect(
        service.updateSeat(seatId, { type: SeatType.FREE }),
      ).rejects.toBeInstanceOf(SeatHasAssignmentError);
      expect(repository.updateSeat).not.toHaveBeenCalled();
    });

    it('유효 배정이 있는 고정석을 이용 불가로 바꾸면 SeatHasAssignmentError(409)를 던진다', async () => {
      seatAssignmentService.findValidBySeat.mockResolvedValue(validAssignment);

      await expect(
        service.updateSeat(seatId, { status: SeatStatus.UNAVAILABLE }),
      ).rejects.toBeInstanceOf(SeatHasAssignmentError);
    });

    it('유효 배정이 없는 고정석은 자유석으로 바꿀 수 있다', async () => {
      await service.updateSeat(seatId, { type: SeatType.FREE });

      expect(seatAssignmentService.findValidBySeat).toHaveBeenCalledWith(
        seatId,
        expect.any(Date),
        tx,
      );
      expect(repository.updateSeat).toHaveBeenCalledWith(
        seatId,
        { type: SeatType.FREE },
        tx,
      );
    });

    it('현재와 같은 값으로 바꾸면 이용 중이어도 가드에 걸리지 않는다', async () => {
      repository.hasActiveSession.mockResolvedValue(true);

      await service.updateSeat(seatId, { type: SeatType.FIXED });

      expect(repository.updateSeat).toHaveBeenCalled();
    });

    it('좌석이 없으면 SeatNotFoundError를 던진다', async () => {
      repository.findByIdForUpdate.mockResolvedValue(null);

      await expect(
        service.updateSeat(seatId, { type: SeatType.FREE }),
      ).rejects.toBeInstanceOf(SeatNotFoundError);
    });
  });

  describe('getSeat', () => {
    it('조회 결과에 좌석 타입과 선택 가능 여부를 포함한다', async () => {
      repository.getSeat.mockResolvedValue([
        {
          id: 'fixed-1',
          number: 1,
          name: 'A1',
          type: SeatType.FIXED,
          usageSession: [],
        },
        {
          id: 'free-1',
          number: 2,
          name: 'A2',
          type: SeatType.FREE,
          usageSession: [],
        },
      ] as unknown as Awaited<ReturnType<SeatRepository['getSeat']>>);
      seatAssignmentService.getAssignableMap.mockResolvedValue(
        new Map([
          ['fixed-1', true],
          ['free-1', false],
        ]),
      );

      const seats = await service.getSeat('shop-1');

      expect(seats).toEqual([
        expect.objectContaining({
          id: 'fixed-1',
          type: SeatType.FIXED,
          isAssignable: true,
        }),
        expect.objectContaining({
          id: 'free-1',
          type: SeatType.FREE,
          isAssignable: false,
        }),
      ]);
    });
  });
});
