import { SeatType, TicketStatus, TicketType } from '@prisma/client';
import { TicketRepository } from './ticket.repository';
import { TicketService } from './ticket.service';

describe('TicketService', () => {
  let repository: jest.Mocked<TicketRepository>;
  let service: TicketService;

  /** 미사용 시간권 기본값 */
  const timeTicket = {
    type: TicketType.TIME,
    userId: 'user-1',
    status: TicketStatus.UNUSED,
    minuteExpireDeadline: new Date('2026-11-22T00:00:00Z'),
    remainingMinutes: 600,
    activationDeadline: null,
    activatedAt: null,
    expiresAt: null,
    purchasedMinutes: 600,
    purchasedDurationDays: null,
    usageSessions: [],
    ticketPauses: [],
  };

  beforeEach(() => {
    repository = {
      getTicketById: jest.fn(),
    } as unknown as jest.Mocked<TicketRepository>;
    service = new TicketService(repository);
  });

  describe('getTicket', () => {
    it('이용권 조회 결과에 좌석 타입과 지정 좌석을 포함한다', async () => {
      repository.getTicketById.mockResolvedValueOnce({
        ...timeTicket,
        seatType: SeatType.FIXED,
        seatAssignments: [{ seat: { id: 'seat-1', number: 3, name: 'A3' } }],
      });
      repository.getTicketById.mockResolvedValueOnce({
        ...timeTicket,
        seatType: SeatType.FREE,
        seatAssignments: [],
      });

      const fixed = await service.getTicket('ticket-fixed');
      const free = await service.getTicket('ticket-free');

      expect(fixed).toMatchObject({
        seatType: SeatType.FIXED,
        assignedSeat: { id: 'seat-1', number: 3, name: 'A3' },
      });
      expect(free).toMatchObject({
        seatType: SeatType.FREE,
        assignedSeat: null,
      });
    });
  });
});
