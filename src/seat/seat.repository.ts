import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SeatStatus,
  SeatType,
  UsageSessionStatus,
} from '@prisma/client';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';

/** 수정 가드 판단에 쓰는 잠근 좌석의 현재 값 */
export type LockedSeatForUpdate = {
  id: string;
  type: SeatType;
  status: SeatStatus;
};

@Injectable()
export class SeatRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 매장별 좌석 조회
  async getSeat(
    shopId: string,
  ): Promise<Prisma.SeatGetPayload<{ include: { usageSession: true } }>[]> {
    return await this.prisma.seat.findMany({
      where: {
        shopId,
      },
      include: {
        usageSession: true,
      },
    });
  }

  // 좌석 등록
  async createSeat(data: Prisma.SeatCreateInput): Promise<void> {
    await this.prisma.seat.create({
      data,
    });
  }

  /**
   * 트랜잭션 안에서 작업을 실행한다
   * @param work 트랜잭션 클라이언트를 받는 작업
   * @returns 작업의 반환값
   */
  async runInTransaction<T>(
    work: (tx: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.executeTransaction(work);
  }

  /**
   * 좌석을 잠그고(FOR UPDATE) 현재 타입·상태를 조회한다
   * @param seatId 좌석 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 잠근 좌석의 ID·타입·상태, 없으면 null
   */
  async findByIdForUpdate(
    seatId: string,
    tx: TransactionClient,
  ): Promise<LockedSeatForUpdate | null> {
    // 같은 좌석의 동시 수정·지정을 직렬화한다
    const [seat] = await tx.$queryRaw<LockedSeatForUpdate[]>`
      SELECT id, type, status
        FROM seats
       WHERE id = ${seatId}
         FOR UPDATE
    `;
    return seat ?? null;
  }

  /**
   * 좌석에 진행 중(ACTIVE)인 이용 세션이 있는지 확인한다
   * @param seatId 좌석 ID
   * @param tx 트랜잭션 클라이언트
   * @returns 이용 중이면 true
   */
  async hasActiveSession(
    seatId: string,
    tx: TransactionClient,
  ): Promise<boolean> {
    // 진행 중 세션 1건만 확인한다
    const session = await tx.usageSession.findFirst({
      where: { seatId, status: UsageSessionStatus.ACTIVE },
      select: { id: true },
    });
    return session !== null;
  }

  /**
   * 좌석 정보를 수정한다
   * @param seatId 좌석 ID
   * @param data 수정할 필드
   * @param tx 트랜잭션 클라이언트(없으면 기본 클라이언트)
   * @returns 없음
   */
  async updateSeat(
    seatId: string,
    data: Omit<Prisma.SeatUpdateInput, 'id'>,
    tx?: TransactionClient,
  ): Promise<void> {
    // 트랜잭션이 있으면 같은 트랜잭션에서 수정한다
    await (tx ?? this.prisma).seat.update({
      where: {
        id: seatId,
      },
      data,
    });
  }

  // 좌석 삭제
  async deleteSeat(seatId: string): Promise<void> {
    await this.prisma.seat.delete({
      where: {
        id: seatId,
      },
    });
  }

  // 마지막 좌석 번호 조회
  async getLastSeatNumber(shopId: string): Promise<number> {
    const seat = await this.prisma.seat.findFirst({
      where: {
        shopId,
      },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    return seat?.number ?? 0;
  }
}
