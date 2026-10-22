/* eslint-disable @typescript-eslint/unbound-method -- jest 목(mock) 메서드를 expect로 검증할 때 생기는 오탐 */
import {
  Prisma,
  SeatAssignmentStatus,
  SeatReleaseReason,
  SeatType,
  TicketStatus,
  TicketType,
} from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';
import { SeatAssignmentService } from './seat-assignment.service';
import {
  OpenSeatAssignment,
  SeatAssignmentRepository,
} from './seat-assignment.repository';
import { SeatNotAssignableError, SeatTypeMismatchError } from './errors';
import { DomainBadRequestError, DomainNotFoundError } from 'src/common/errors';

describe('SeatAssignmentService', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const past = new Date('2026-10-21T11:00:00Z');
  const future = new Date('2026-10-21T13:00:00Z');
  const tx = {} as TransactionClient;

  const shopId = 'shop-1';
  const seatId = 'seat-1';

  let repository: jest.Mocked<SeatAssignmentRepository>;
  let service: SeatAssignmentService;

  /**
   * 열린(HELD·ACTIVE) 지정 행을 만든다
   * @param overrides 바꿀 필드
   * @returns 지정 행
   */
  function openRow(
    overrides: Partial<OpenSeatAssignment> = {},
  ): OpenSeatAssignment {
    return {
      id: 'assignment-1',
      seatId,
      orderItemId: 'order-item-1',
      ticketId: null,
      status: SeatAssignmentStatus.HELD,
      heldUntil: future,
      ticket: null,
      ...overrides,
    };
  }

  /** 기한이 남은 활성 기간권 스냅샷 */
  const validTicket = {
    type: TicketType.PERIOD,
    status: TicketStatus.ACTIVE,
    expiresAt: future,
    activationDeadline: null,
    minuteExpireDeadline: null,
  };

  /** 고유 제약 위반(P2002) 에러 */
  const uniqueViolation = new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });

  beforeEach(() => {
    repository = {
      lockSeat: jest.fn(),
      findOpenBySeat: jest.fn(),
      findOpenBySeatIds: jest.fn(),
      findActiveByTicket: jest.fn(),
      findHeldByOrderItems: jest.fn(),
      findLatestByOrderItem: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<SeatAssignmentRepository>;
    service = new SeatAssignmentService(repository);

    // 기본: 같은 매장의 고정석
    repository.lockSeat.mockResolvedValue({
      id: seatId,
      shopId,
      type: SeatType.FIXED,
    });
    repository.findOpenBySeat.mockResolvedValue([]);
  });

  describe('findValidBySeat', () => {
    it('무효 행은 같은 트랜잭션에서 사유와 함께 RELEASED로 바꾸고 유효 행만 반환한다', async () => {
      const expiredHold = openRow({ id: 'a-expired', heldUntil: past });
      const expiredTicket = openRow({
        id: 'a-ticket-expired',
        status: SeatAssignmentStatus.ACTIVE,
        heldUntil: null,
        ticketId: 't-1',
        ticket: { ...validTicket, expiresAt: past },
      });
      const valid = openRow({ id: 'a-valid' });
      repository.findOpenBySeat.mockResolvedValue([
        expiredHold,
        expiredTicket,
        valid,
      ]);

      const result = await service.findValidBySeat(seatId, now, tx);

      expect(result).toEqual(valid);
      expect(repository.updateStatus).toHaveBeenCalledWith(
        ['a-expired'],
        {
          status: SeatAssignmentStatus.RELEASED,
          releasedAt: now,
          releaseReason: SeatReleaseReason.HOLD_EXPIRED,
        },
        tx,
      );
      expect(repository.updateStatus).toHaveBeenCalledWith(
        ['a-ticket-expired'],
        {
          status: SeatAssignmentStatus.RELEASED,
          releasedAt: now,
          releaseReason: SeatReleaseReason.TICKET_EXPIRED,
        },
        tx,
      );
    });

    it('유효 행이 없으면 null을 반환한다', async () => {
      await expect(
        service.findValidBySeat(seatId, now, tx),
      ).resolves.toBeNull();
    });
  });

  describe('hold', () => {
    const input = {
      seatId,
      shopId,
      orderItemId: 'order-item-1',
      heldUntil: future,
    };

    it('대상 좌석을 잠그고 무효 지정을 해제한 뒤 새 HELD를 만든다', async () => {
      repository.findOpenBySeat.mockResolvedValue([
        openRow({ id: 'a-expired', heldUntil: past }),
      ]);

      await service.hold(input, now, tx);

      expect(repository.lockSeat).toHaveBeenCalledWith(seatId, tx);
      expect(repository.updateStatus).toHaveBeenCalledWith(
        ['a-expired'],
        expect.objectContaining({
          releaseReason: SeatReleaseReason.HOLD_EXPIRED,
        }),
        tx,
      );
      expect(repository.create).toHaveBeenCalledWith(
        {
          seatId,
          orderItemId: 'order-item-1',
          status: SeatAssignmentStatus.HELD,
          heldUntil: future,
        },
        tx,
      );
    });

    it('유효 지정이 있으면 SeatNotAssignableError(409)를 던진다', async () => {
      repository.findOpenBySeat.mockResolvedValue([openRow()]);

      await expect(service.hold(input, now, tx)).rejects.toBeInstanceOf(
        SeatNotAssignableError,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('좌석이 없으면 DomainNotFoundError를 던진다', async () => {
      repository.lockSeat.mockResolvedValue(null);

      await expect(service.hold(input, now, tx)).rejects.toBeInstanceOf(
        DomainNotFoundError,
      );
    });

    it('자유석이면 SeatTypeMismatchError(400)를 던진다', async () => {
      repository.lockSeat.mockResolvedValue({
        id: seatId,
        shopId,
        type: SeatType.FREE,
      });

      await expect(service.hold(input, now, tx)).rejects.toBeInstanceOf(
        SeatTypeMismatchError,
      );
    });

    it('다른 매장 좌석이면 DomainBadRequestError(400)를 던진다', async () => {
      repository.lockSeat.mockResolvedValue({
        id: seatId,
        shopId: 'other-shop',
        type: SeatType.FIXED,
      });

      await expect(service.hold(input, now, tx)).rejects.toBeInstanceOf(
        DomainBadRequestError,
      );
    });

    it('부분 유일 인덱스 위반(P2002)은 SeatNotAssignableError로 변환한다', async () => {
      repository.create.mockRejectedValue(uniqueViolation);

      await expect(service.hold(input, now, tx)).rejects.toBeInstanceOf(
        SeatNotAssignableError,
      );
    });
  });

  describe('activateByOrderItem', () => {
    it('이미 RELEASED인 행은 다시 바꾸지 않고, 좌석이 비어 있으면 새 ACTIVE 행을 만든다', async () => {
      repository.findLatestByOrderItem.mockResolvedValue(
        openRow({ status: SeatAssignmentStatus.RELEASED }),
      );

      await expect(
        service.activateByOrderItem('order-item-1', 'ticket-1', now, tx),
      ).resolves.toBe(true);
      expect(repository.updateStatus).not.toHaveBeenCalledWith(
        ['assignment-1'],
        expect.anything(),
        tx,
      );
      expect(repository.create).toHaveBeenCalledWith(
        {
          seatId,
          orderItemId: 'order-item-1',
          ticketId: 'ticket-1',
          status: SeatAssignmentStatus.ACTIVE,
          assignedAt: now,
        },
        tx,
      );
    });

    it('유효한 HELD는 ACTIVE로 바꾸고 ticketId·assignedAt을 설정한다', async () => {
      repository.findLatestByOrderItem.mockResolvedValue(openRow());

      await expect(
        service.activateByOrderItem('order-item-1', 'ticket-1', now, tx),
      ).resolves.toBe(true);
      expect(repository.updateStatus).toHaveBeenCalledWith(
        ['assignment-1'],
        {
          status: SeatAssignmentStatus.ACTIVE,
          ticketId: 'ticket-1',
          assignedAt: now,
        },
        tx,
      );
    });

    it('HELD가 만료됐어도 같은 좌석에 다른 유효 지정이 없으면 새 ACTIVE를 만들고 true를 반환한다', async () => {
      repository.findLatestByOrderItem.mockResolvedValue(
        openRow({ heldUntil: past }),
      );
      repository.findOpenBySeat.mockResolvedValue([
        openRow({ heldUntil: past }),
      ]);

      await expect(
        service.activateByOrderItem('order-item-1', 'ticket-1', now, tx),
      ).resolves.toBe(true);
      expect(repository.create).toHaveBeenCalledWith(
        {
          seatId,
          orderItemId: 'order-item-1',
          ticketId: 'ticket-1',
          status: SeatAssignmentStatus.ACTIVE,
          assignedAt: now,
        },
        tx,
      );
    });

    it('HELD가 만료되고 같은 좌석에 다른 유효 지정이 있으면 false를 반환하고 만들지 않는다', async () => {
      repository.findLatestByOrderItem.mockResolvedValue(
        openRow({ heldUntil: past }),
      );
      repository.findOpenBySeat.mockResolvedValue([
        openRow({ heldUntil: past }),
        openRow({ id: 'other', orderItemId: 'other-item' }),
      ]);

      await expect(
        service.activateByOrderItem('order-item-1', 'ticket-1', now, tx),
      ).resolves.toBe(false);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('새 ACTIVE 생성 중 P2002가 나면 false를 반환한다', async () => {
      repository.findLatestByOrderItem.mockResolvedValue(
        openRow({ heldUntil: past }),
      );
      repository.create.mockRejectedValue(uniqueViolation);

      await expect(
        service.activateByOrderItem('order-item-1', 'ticket-1', now, tx),
      ).resolves.toBe(false);
    });

    it('주문 항목에 선점 기록이 없으면 DomainNotFoundError를 던진다', async () => {
      repository.findLatestByOrderItem.mockResolvedValue(null);

      await expect(
        service.activateByOrderItem('order-item-1', 'ticket-1', now, tx),
      ).rejects.toBeInstanceOf(DomainNotFoundError);
    });
  });

  describe('assign', () => {
    const input = { seatId, shopId, ticketId: 'ticket-1' };

    it('orderItemId 없이 ACTIVE를 바로 만든다', async () => {
      await service.assign(input, now, tx);

      expect(repository.create).toHaveBeenCalledWith(
        {
          seatId,
          ticketId: 'ticket-1',
          status: SeatAssignmentStatus.ACTIVE,
          assignedAt: now,
        },
        tx,
      );
    });

    it('유효 지정이 있으면 SeatNotAssignableError를 던진다', async () => {
      repository.findOpenBySeat.mockResolvedValue([openRow()]);

      await expect(service.assign(input, now, tx)).rejects.toBeInstanceOf(
        SeatNotAssignableError,
      );
    });

    it('자유석이면 SeatTypeMismatchError를 던진다', async () => {
      repository.lockSeat.mockResolvedValue({
        id: seatId,
        shopId,
        type: SeatType.FREE,
      });

      await expect(service.assign(input, now, tx)).rejects.toBeInstanceOf(
        SeatTypeMismatchError,
      );
    });

    it('P2002는 SeatNotAssignableError로 변환한다', async () => {
      repository.create.mockRejectedValue(uniqueViolation);

      await expect(service.assign(input, now, tx)).rejects.toBeInstanceOf(
        SeatNotAssignableError,
      );
    });
  });

  describe('releaseByTicket', () => {
    it('이용권의 ACTIVE 지정을 사유와 함께 RELEASED로 바꾸고 해제한 행을 반환한다', async () => {
      const active = openRow({
        status: SeatAssignmentStatus.ACTIVE,
        ticketId: 'ticket-1',
      });
      repository.findActiveByTicket.mockResolvedValue(active);

      await expect(
        service.releaseByTicket(
          'ticket-1',
          SeatReleaseReason.TICKET_PAUSED,
          now,
          tx,
        ),
      ).resolves.toEqual(active);
      expect(repository.updateStatus).toHaveBeenCalledWith(
        ['assignment-1'],
        {
          status: SeatAssignmentStatus.RELEASED,
          releasedAt: now,
          releaseReason: SeatReleaseReason.TICKET_PAUSED,
        },
        tx,
      );
    });

    it('ACTIVE 지정이 없으면 아무것도 바꾸지 않고 null을 반환한다', async () => {
      repository.findActiveByTicket.mockResolvedValue(null);

      await expect(
        service.releaseByTicket(
          'ticket-1',
          SeatReleaseReason.TICKET_REVOKED,
          now,
          tx,
        ),
      ).resolves.toBeNull();
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('releaseByOrderItems', () => {
    it('주문 항목들의 HELD를 사유와 함께 RELEASED로 바꾼다', async () => {
      repository.findHeldByOrderItems.mockResolvedValue([
        openRow({ id: 'h1' }),
        openRow({ id: 'h2' }),
      ]);

      await service.releaseByOrderItems(
        ['order-item-1', 'order-item-2'],
        SeatReleaseReason.ORDER_CANCELLED,
        now,
        tx,
      );

      expect(repository.updateStatus).toHaveBeenCalledWith(
        ['h1', 'h2'],
        {
          status: SeatAssignmentStatus.RELEASED,
          releasedAt: now,
          releaseReason: SeatReleaseReason.ORDER_CANCELLED,
        },
        tx,
      );
    });

    it('해제할 HELD가 없으면 아무것도 바꾸지 않는다(멱등)', async () => {
      repository.findHeldByOrderItems.mockResolvedValue([]);

      await service.releaseByOrderItems(
        ['order-item-1'],
        SeatReleaseReason.ORDER_CANCELLED,
        now,
        tx,
      );

      expect(repository.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('getAssignableMap', () => {
    it('자유석은 false, 유효 지정 없는 고정석은 true, 유효 지정 있는 고정석은 false다', async () => {
      repository.findOpenBySeatIds.mockResolvedValue([
        openRow({ seatId: 'fixed-taken' }),
        openRow({ id: 'expired', seatId: 'fixed-expired', heldUntil: past }),
      ]);

      const map = await service.getAssignableMap(
        [
          { id: 'free', type: SeatType.FREE },
          { id: 'fixed-empty', type: SeatType.FIXED },
          { id: 'fixed-taken', type: SeatType.FIXED },
          { id: 'fixed-expired', type: SeatType.FIXED },
        ],
        now,
      );

      expect(map.get('free')).toBe(false);
      expect(map.get('fixed-empty')).toBe(true);
      expect(map.get('fixed-taken')).toBe(false);
      expect(map.get('fixed-expired')).toBe(true);
    });
  });
});
