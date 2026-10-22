import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SeatAssignmentStatus,
  SeatReleaseReason,
  SeatType,
} from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';
import { DomainBadRequestError, DomainNotFoundError } from 'src/common/errors';
import {
  LockedSeat,
  OpenSeatAssignment,
  SeatAssignmentRepository,
} from './seat-assignment.repository';
import {
  getInvalidReleaseReason,
  isValidAssignment,
} from './seat-assignment.policy';
import { SeatNotAssignableError, SeatTypeMismatchError } from './errors';

/**
 * 좌석 배정(선점·확정·해제) 업무 로직
 * - 다른 모듈은 Repository가 아니라 이 Service를 사용한다
 * - 모든 쓰기 메서드는 호출부의 트랜잭션(tx) 안에서 실행된다
 */
@Injectable()
export class SeatAssignmentService {
  constructor(private readonly repository: SeatAssignmentRepository) {}

  /**
   * 좌석의 유효한 배정을 찾는다. 기한이 지난 배정은 같은 트랜잭션에서 해제한다(지연 해제)
   * @param seatId 좌석 ID
   * @param now 판정 기준 시각
   * @param tx 트랜잭션 클라이언트
   * @returns 유효한 배정(없으면 null)
   */
  async findValidBySeat(
    seatId: string,
    now: Date,
    tx: TransactionClient,
  ): Promise<OpenSeatAssignment | null> {
    // 열린 배정을 유효/무효로 나눈다
    const rows = await this.repository.findOpenBySeat(seatId, tx);
    let valid: OpenSeatAssignment | null = null;
    const invalidByReason = new Map<SeatReleaseReason, string[]>();
    for (const row of rows) {
      if (isValidAssignment(row, row.ticket, now)) {
        valid = row;
        continue;
      }
      const reason = getInvalidReleaseReason(row);
      invalidByReason.set(reason, [
        ...(invalidByReason.get(reason) ?? []),
        row.id,
      ]);
    }

    // 무효 배정은 사유별로 해제
    for (const [reason, ids] of invalidByReason) {
      await this.repository.updateStatus(
        ids,
        {
          status: SeatAssignmentStatus.RELEASED,
          releasedAt: now,
          releaseReason: reason,
        },
        tx,
      );
    }

    return valid;
  }

  /**
   * 고정석 상품 주문 시 좌석을 선점(HELD)한다
   * @param input 좌석·매장·주문 항목·선점 유효시간
   * @param now 기준 시각
   * @param tx 트랜잭션 클라이언트
   * @throws DomainNotFoundError 좌석이 없음
   * @throws SeatTypeMismatchError 고정석이 아님
   * @throws DomainBadRequestError 다른 매장의 좌석
   * @throws SeatNotAssignableError 이미 유효한 배정이 있음
   */
  async hold(
    input: {
      seatId: string;
      shopId: string;
      orderItemId: string;
      heldUntil: Date;
    },
    now: Date,
    tx: TransactionClient,
  ): Promise<void> {
    // 좌석 잠금 + 고정석·매장 검증 + 유효 배정 확인
    await this.lockAssignableFixedSeat(input.seatId, input.shopId, now, tx);

    // 선점 생성 (동시 요청은 부분 유일 인덱스가 최종 방어)
    await this.createOrConflict(
      {
        seatId: input.seatId,
        orderItemId: input.orderItemId,
        status: SeatAssignmentStatus.HELD,
        heldUntil: input.heldUntil,
      },
      input.seatId,
      tx,
    );
  }

  /**
   * 결제 성공 시 주문 항목의 선점을 이용권에 확정(ACTIVE)한다
   * @param orderItemId 주문 항목 ID
   * @param ticketId 발급된 이용권 ID
   * @param now 기준 시각
   * @param tx 트랜잭션 클라이언트
   * @returns 확정했으면 true, 좌석이 다른 이용권에 넘어가 확정하지 못했으면 false
   * @throws DomainNotFoundError 주문 항목에 선점 기록이 없음
   */
  async activateByOrderItem(
    orderItemId: string,
    ticketId: string,
    now: Date,
    tx: TransactionClient,
  ): Promise<boolean> {
    // 주문 항목의 최근 배정 조회
    const row = await this.repository.findLatestByOrderItem(orderItemId, tx);
    if (!row) {
      throw new DomainNotFoundError(
        `좌석 선점 기록이 없는 주문 항목입니다: ${orderItemId}`,
      );
    }

    // 선점이 유효하면 그대로 확정
    if (
      row.status === SeatAssignmentStatus.HELD &&
      isValidAssignment(row, null, now)
    ) {
      await this.repository.updateStatus(
        [row.id],
        { status: SeatAssignmentStatus.ACTIVE, ticketId, assignedAt: now },
        tx,
      );
      return true;
    }

    // 선점이 만료·해제됐으면 좌석이 아직 비어 있을 때만 새로 확정
    await this.repository.lockSeat(row.seatId, tx);
    const valid = await this.findValidBySeat(row.seatId, now, tx);
    if (valid && valid.id !== row.id) return false;

    try {
      await this.repository.create(
        {
          seatId: row.seatId,
          orderItemId,
          ticketId,
          status: SeatAssignmentStatus.ACTIVE,
          assignedAt: now,
        },
        tx,
      );
      return true;
    } catch (error) {
      // 그 사이 다른 요청이 좌석을 차지함
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /**
   * 점주 변경·일시정지 재개 시 이용권에 고정석을 바로 확정(ACTIVE)한다
   * @param input 좌석·매장·이용권
   * @param now 기준 시각
   * @param tx 트랜잭션 클라이언트
   * @throws DomainNotFoundError 좌석이 없음
   * @throws SeatTypeMismatchError 고정석이 아님
   * @throws DomainBadRequestError 다른 매장의 좌석
   * @throws SeatNotAssignableError 이미 유효한 배정이 있음
   */
  async assign(
    input: { seatId: string; shopId: string; ticketId: string },
    now: Date,
    tx: TransactionClient,
  ): Promise<void> {
    // 좌석 잠금 + 고정석·매장 검증 + 유효 배정 확인
    await this.lockAssignableFixedSeat(input.seatId, input.shopId, now, tx);

    // 확정 생성
    await this.createOrConflict(
      {
        seatId: input.seatId,
        ticketId: input.ticketId,
        status: SeatAssignmentStatus.ACTIVE,
        assignedAt: now,
      },
      input.seatId,
      tx,
    );
  }

  /**
   * 이용권의 확정 배정을 해제한다
   * @param ticketId 이용권 ID
   * @param reason 해제 사유
   * @param now 기준 시각
   * @param tx 트랜잭션 클라이언트
   * @returns 해제한 배정(없었으면 null)
   */
  async releaseByTicket(
    ticketId: string,
    reason: SeatReleaseReason,
    now: Date,
    tx: TransactionClient,
  ): Promise<OpenSeatAssignment | null> {
    // 확정 배정이 없으면 할 일 없음(자유석 이용권 등)
    const row = await this.repository.findActiveByTicket(ticketId, tx);
    if (!row) return null;

    // 해제
    await this.repository.updateStatus(
      [row.id],
      {
        status: SeatAssignmentStatus.RELEASED,
        releasedAt: now,
        releaseReason: reason,
      },
      tx,
    );
    return row;
  }

  /**
   * 주문 항목들의 선점을 해제한다(주문 취소, 결제 실패, 결제 요청 시 만료)
   * @param orderItemIds 주문 항목 ID 목록
   * @param reason 해제 사유
   * @param now 기준 시각
   * @param tx 트랜잭션 클라이언트
   */
  async releaseByOrderItems(
    orderItemIds: string[],
    reason: SeatReleaseReason,
    now: Date,
    tx: TransactionClient,
  ): Promise<void> {
    // 해제할 선점이 없으면 그대로 성공(멱등)
    const rows = await this.repository.findHeldByOrderItems(orderItemIds, tx);
    if (rows.length === 0) return;

    // 해제
    await this.repository.updateStatus(
      rows.map((row) => row.id),
      {
        status: SeatAssignmentStatus.RELEASED,
        releasedAt: now,
        releaseReason: reason,
      },
      tx,
    );
  }

  /**
   * 이용권의 확정 배정을 조회한다
   * @param ticketId 이용권 ID
   * @param tx 트랜잭션 클라이언트(선택)
   * @returns 확정 배정(없으면 null)
   */
  async getActiveByTicket(
    ticketId: string,
    tx?: TransactionClient,
  ): Promise<OpenSeatAssignment | null> {
    return this.repository.findActiveByTicket(ticketId, tx);
  }

  /**
   * 좌석 목록의 선택 가능 여부를 조회 시점 기준으로 계산한다
   * @param seats 좌석 ID·타입 목록
   * @param now 판정 기준 시각
   * @returns 좌석 ID → 선택 가능 여부(자유석은 항상 false)
   */
  async getAssignableMap(
    seats: { id: string; type: SeatType }[],
    now: Date,
  ): Promise<Map<string, boolean>> {
    // 고정석만 배정 조회 대상
    const fixedIds = seats
      .filter((seat) => seat.type === SeatType.FIXED)
      .map((seat) => seat.id);
    const rows =
      fixedIds.length > 0
        ? await this.repository.findOpenBySeatIds(fixedIds)
        : [];

    // 유효 배정이 있는 좌석 집합
    const taken = new Set(
      rows
        .filter((row) => isValidAssignment(row, row.ticket, now))
        .map((row) => row.seatId),
    );

    return new Map(
      seats.map((seat) => [
        seat.id,
        seat.type === SeatType.FIXED && !taken.has(seat.id),
      ]),
    );
  }

  /**
   * 좌석을 잠그고, 같은 매장의 고정석이며 유효 배정이 없는지 확인한다
   * @param seatId 좌석 ID
   * @param shopId 매장 ID
   * @param now 기준 시각
   * @param tx 트랜잭션 클라이언트
   * @returns 잠근 좌석
   * @throws DomainNotFoundError 좌석이 없음
   * @throws SeatTypeMismatchError 고정석이 아님
   * @throws DomainBadRequestError 다른 매장의 좌석
   * @throws SeatNotAssignableError 이미 유효한 배정이 있음
   */
  private async lockAssignableFixedSeat(
    seatId: string,
    shopId: string,
    now: Date,
    tx: TransactionClient,
  ): Promise<LockedSeat> {
    // 좌석 잠금
    const seat = await this.repository.lockSeat(seatId, tx);
    if (!seat) throw new DomainNotFoundError(`좌석이 없습니다: ${seatId}`);

    // 고정석·매장 검증
    if (seat.type !== SeatType.FIXED) {
      throw new SeatTypeMismatchError(`고정석이 아닌 좌석입니다: ${seatId}`);
    }
    if (seat.shopId !== shopId) {
      throw new DomainBadRequestError(`다른 매장의 좌석입니다: ${seatId}`);
    }

    // 유효 배정 확인(만료된 배정은 이 안에서 해제됨)
    if (await this.findValidBySeat(seatId, now, tx)) {
      throw new SeatNotAssignableError(seatId);
    }
    return seat;
  }

  /**
   * 배정을 생성하고, 부분 유일 인덱스 위반은 SeatNotAssignableError로 바꾼다
   * @param data 생성 데이터
   * @param seatId 오류 메시지용 좌석 ID
   * @param tx 트랜잭션 클라이언트
   * @throws SeatNotAssignableError 동시 요청으로 이미 배정됨
   */
  private async createOrConflict(
    data: Prisma.SeatAssignmentUncheckedCreateInput,
    seatId: string,
    tx: TransactionClient,
  ): Promise<void> {
    try {
      await this.repository.create(data, tx);
    } catch (error) {
      if (isUniqueViolation(error)) throw new SeatNotAssignableError(seatId);
      throw error;
    }
  }
}

/**
 * Prisma 고유 제약 위반(P2002) 여부
 * @param error 잡은 예외
 * @returns P2002이면 true
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
