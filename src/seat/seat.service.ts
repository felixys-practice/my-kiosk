import { Injectable } from '@nestjs/common';
import { SeatStatus, SeatType } from '@prisma/client';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { SeatRepository } from './seat.repository';
import { GetSeatOutDto } from './dto/get-seat-out.dto';
import { CreateSeatDto } from './dto/create-seat.dto';
import { UpdateSeatDto } from './dto/update-seat.dto';
import { SeatAlreadyOccupiedError } from 'src/usage-session/errors/seat-already-occupied.error';
import { SeatHasAssignmentError } from './errors/seat-has-assignment.error';
import { SeatNotFoundError } from './errors/seat-not-found.error';

@Injectable()
export class SeatService {
  constructor(
    private readonly repository: SeatRepository,
    private readonly seatAssignmentService: SeatAssignmentService,
  ) {}

  /**
   * 매장의 좌석 목록을 조회한다
   * @param shopId 매장 ID
   * @returns 좌석 목록(타입·선택 가능 여부·이용 세션 포함)
   */
  async getSeat(shopId: string): Promise<GetSeatOutDto[]> {
    const seats = await this.repository.getSeat(shopId);

    // 조회 시점 기준으로 고정석 선택 가능 여부를 계산한다(research R3)
    const assignableMap = await this.seatAssignmentService.getAssignableMap(
      seats,
      new Date(),
    );

    return seats.map((seat) => ({
      id: seat.id,
      number: seat.number,
      name: seat.name,
      type: seat.type,
      isAssignable: assignableMap.get(seat.id) ?? false,
      usageSession: seat.usageSession.map((session) => ({
        id: session.id,
        status: session.status,
        startedAt: session.startedAt,
        plannedEndAt: session.plannedEndAt,
        endedAt: session.endedAt,
      })),
    }));
  }

  /**
   * 매장에 좌석을 등록한다
   * @param shopId 매장 ID
   * @param dto 좌석 이름·번호·타입
   * @returns 없음
   */
  async createSeat(shopId: string, dto: CreateSeatDto): Promise<void> {
    // 좌석 번호가 없으면 마지막 좌석 번호 다음 값으로 채운다.
    const newSeatNumber = dto.number
      ? dto.number
      : (await this.repository.getLastSeatNumber(shopId)) + 1;

    // 좌석 타입과 함께 저장한다(FR-002)
    await this.repository.createSeat({
      number: newSeatNumber,
      name: dto.name,
      type: dto.type,
      shop: {
        connect: { id: shopId },
      },
    });
  }

  // 배석 / 배석 해제는 usageSession에 의해서 이루어 진다.

  /**
   * 좌석 정보를 수정한다
   * @param seatId 좌석 ID
   * @param dto 수정할 이름·번호·타입·상태
   * @returns 없음
   * @throws SeatNotFoundError 좌석이 없을 때
   * @throws SeatAlreadyOccupiedError 이용 중인 좌석의 타입·상태를 바꿀 때
   * @throws SeatHasAssignmentError 유효 지정이 있는 고정석을 자유석·이용 불가로 바꿀 때
   */
  async updateSeat(seatId: string, dto: UpdateSeatDto): Promise<void> {
    await this.repository.runInTransaction(async (tx) => {
      // 좌석을 잠가 동시 수정·지정과 직렬화한다
      const seat = await this.repository.findByIdForUpdate(seatId, tx);

      // 좌석이 없으면 404
      if (!seat) throw new SeatNotFoundError();

      // 이용 중인 좌석은 타입·상태를 바꿀 수 없다(FR-003, R8·R9)
      const changesType = dto.type !== undefined && dto.type !== seat.type;
      const changesStatus =
        dto.status !== undefined && dto.status !== seat.status;
      if (
        (changesType || changesStatus) &&
        (await this.repository.hasActiveSession(seatId, tx))
      ) {
        throw new SeatAlreadyOccupiedError(seatId);
      }

      // 고정석을 자유석·이용 불가로 바꾸면 유효 지정을 확인한다(FR-022)
      const releasesFixedSeat =
        seat.type === SeatType.FIXED &&
        (dto.type === SeatType.FREE || dto.status === SeatStatus.UNAVAILABLE);
      if (releasesFixedSeat) {
        const validAssignment =
          await this.seatAssignmentService.findValidBySeat(
            seatId,
            new Date(),
            tx,
          );

        // 유효 지정이 있으면 자유석으로 바꿀 수 없다
        if (validAssignment && dto.type === SeatType.FREE) {
          throw new SeatHasAssignmentError(
            '유효한 지정이 있는 고정석은 자유석으로 바꿀 수 없습니다',
          );
        }

        // 유효 지정이 있으면 이용 불가로 바꿀 수 없다(FR-022)
        if (validAssignment && dto.status === SeatStatus.UNAVAILABLE) {
          throw new SeatHasAssignmentError(
            '유효한 이용권에 지정된 고정석은 이용 불가로 바꿀 수 없습니다. 먼저 이용권의 좌석을 변경하세요',
          );
        }
      }

      // 같은 트랜잭션에서 수정한다
      await this.repository.updateSeat(seatId, dto, tx);
    });
  }

  async deleteSeat(seatId: string): Promise<void> {
    await this.repository.deleteSeat(seatId);
  }
}
