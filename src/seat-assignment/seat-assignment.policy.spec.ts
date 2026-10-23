import {
  SeatAssignmentStatus,
  SeatReleaseReason,
  TicketStatus,
  TicketType,
} from '@prisma/client';
import {
  AssignmentTicketSnapshot,
  getExpiredReleaseReason,
  isOccupyingAssignment,
} from './seat-assignment.policy';

describe('좌석 점유 판정', () => {
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
    it('선점 유효시간이 남아 있으면 점유 중이다', () => {
      expect(
        isOccupyingAssignment(
          { status: SeatAssignmentStatus.HELD, heldUntil: future },
          null,
          now,
        ),
      ).toBe(true);
    });

    it('선점 유효시간이 지났으면 점유가 끝났고 사유는 HOLD_EXPIRED다', () => {
      const assignment = { status: SeatAssignmentStatus.HELD, heldUntil: past };
      expect(isOccupyingAssignment(assignment, null, now)).toBe(false);
      expect(getExpiredReleaseReason(assignment)).toBe(
        SeatReleaseReason.HOLD_EXPIRED,
      );
    });

    it('선점 유효시간이 정확히 지금이면 점유가 끝났다', () => {
      expect(
        isOccupyingAssignment(
          { status: SeatAssignmentStatus.HELD, heldUntil: now },
          null,
          now,
        ),
      ).toBe(false);
    });
  });

  describe('확정(ACTIVE)', () => {
    const active = { status: SeatAssignmentStatus.ACTIVE, heldUntil: null };

    it('활성화된 기간권의 만료일이 남아 있으면 점유 중이다', () => {
      expect(isOccupyingAssignment(active, ticket(), now)).toBe(true);
    });

    it('활성화 전 기간권은 활성화 기한으로 판정한다', () => {
      const unused = ticket({
        status: TicketStatus.UNUSED,
        expiresAt: null,
        activationDeadline: future,
      });
      expect(isOccupyingAssignment(active, unused, now)).toBe(true);
      expect(
        isOccupyingAssignment(
          active,
          { ...unused, activationDeadline: past },
          now,
        ),
      ).toBe(false);
    });

    it('기간권 만료일이 지났으면 점유가 끝났고 사유는 TICKET_EXPIRED다', () => {
      expect(
        isOccupyingAssignment(active, ticket({ expiresAt: past }), now),
      ).toBe(false);
      expect(getExpiredReleaseReason(active)).toBe(
        SeatReleaseReason.TICKET_EXPIRED,
      );
    });

    it('시간권은 소진 기한이 남아 있으면 점유 중이다', () => {
      const time = ticket({
        type: TicketType.TIME,
        expiresAt: null,
        minuteExpireDeadline: future,
      });
      expect(isOccupyingAssignment(active, time, now)).toBe(true);
      expect(
        isOccupyingAssignment(
          active,
          { ...time, minuteExpireDeadline: past },
          now,
        ),
      ).toBe(false);
    });

    it.each([
      TicketStatus.EXPIRED,
      TicketStatus.EXHAUSTED,
      TicketStatus.REVOKED,
    ])('이용권 상태가 %s이면 기한과 무관하게 점유가 끝났다', (status) => {
      expect(isOccupyingAssignment(active, ticket({ status }), now)).toBe(
        false,
      );
    });

    it('연결된 이용권이 없으면 점유가 끝났다', () => {
      expect(isOccupyingAssignment(active, null, now)).toBe(false);
    });
  });

  describe('해제(RELEASED)', () => {
    it('해제된 배정은 항상 점유가 끝났다', () => {
      expect(
        isOccupyingAssignment(
          { status: SeatAssignmentStatus.RELEASED, heldUntil: future },
          ticket(),
          now,
        ),
      ).toBe(false);
    });
  });
});
