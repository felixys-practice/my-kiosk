import {
  SeatAssignmentStatus,
  SeatReleaseReason,
  TicketStatus,
  TicketType,
} from '@prisma/client';
import {
  AssignmentTicketSnapshot,
  getInvalidReleaseReason,
  isValidAssignment,
} from './seat-assignment.policy';

describe('좌석 지정 유효 판정', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const past = new Date('2026-10-21T11:59:00Z');
  const future = new Date('2026-10-21T12:01:00Z');

  /**
   * 판정용 이용권 스냅샷을 만든다
   * @param overrides 바꿀 필드
   * @returns 이용권 스냅샷
   */
  function ticket(
    overrides: Partial<AssignmentTicketSnapshot> = {},
  ): AssignmentTicketSnapshot {
    return {
      type: TicketType.PERIOD,
      status: TicketStatus.ACTIVE,
      expiresAt: future,
      activationDeadline: null,
      minuteExpireDeadline: null,
      ...overrides,
    };
  }

  describe('선점(HELD)', () => {
    it('선점 유효시간이 남아 있으면 유효하다', () => {
      expect(
        isValidAssignment(
          { status: SeatAssignmentStatus.HELD, heldUntil: future },
          null,
          now,
        ),
      ).toBe(true);
    });

    it('선점 유효시간이 지났으면 무효이고 사유는 HOLD_EXPIRED다', () => {
      const assignment = { status: SeatAssignmentStatus.HELD, heldUntil: past };
      expect(isValidAssignment(assignment, null, now)).toBe(false);
      expect(getInvalidReleaseReason(assignment)).toBe(
        SeatReleaseReason.HOLD_EXPIRED,
      );
    });

    it('선점 유효시간이 정확히 지금이면 무효다', () => {
      expect(
        isValidAssignment(
          { status: SeatAssignmentStatus.HELD, heldUntil: now },
          null,
          now,
        ),
      ).toBe(false);
    });
  });

  describe('확정(ACTIVE)', () => {
    const active = { status: SeatAssignmentStatus.ACTIVE, heldUntil: null };

    it('활성화된 기간권의 만료일이 남아 있으면 유효하다', () => {
      expect(isValidAssignment(active, ticket(), now)).toBe(true);
    });

    it('활성화 전 기간권은 활성화 기한으로 판정한다', () => {
      const unused = ticket({
        status: TicketStatus.UNUSED,
        expiresAt: null,
        activationDeadline: future,
      });
      expect(isValidAssignment(active, unused, now)).toBe(true);
      expect(
        isValidAssignment(active, { ...unused, activationDeadline: past }, now),
      ).toBe(false);
    });

    it('기간권 만료일이 지났으면 무효이고 사유는 TICKET_EXPIRED다', () => {
      expect(isValidAssignment(active, ticket({ expiresAt: past }), now)).toBe(
        false,
      );
      expect(getInvalidReleaseReason(active)).toBe(
        SeatReleaseReason.TICKET_EXPIRED,
      );
    });

    it('시간권은 소진 기한이 남아 있으면 유효하다', () => {
      const time = ticket({
        type: TicketType.TIME,
        expiresAt: null,
        minuteExpireDeadline: future,
      });
      expect(isValidAssignment(active, time, now)).toBe(true);
      expect(
        isValidAssignment(active, { ...time, minuteExpireDeadline: past }, now),
      ).toBe(false);
    });

    it.each([
      TicketStatus.EXPIRED,
      TicketStatus.EXHAUSTED,
      TicketStatus.REVOKED,
    ])('이용권 상태가 %s이면 기한과 무관하게 무효다', (status) => {
      expect(isValidAssignment(active, ticket({ status }), now)).toBe(false);
    });

    it('연결된 이용권이 없으면 무효다', () => {
      expect(isValidAssignment(active, null, now)).toBe(false);
    });
  });

  describe('해제(RELEASED)', () => {
    it('해제된 지정은 항상 무효다', () => {
      expect(
        isValidAssignment(
          { status: SeatAssignmentStatus.RELEASED, heldUntil: future },
          ticket(),
          now,
        ),
      ).toBe(false);
    });
  });
});
