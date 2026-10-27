import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';

/** 잠금 대상 테이블 */
type LockedTable =
  | 'payments'
  | 'tickets'
  | 'ticket_pauses'
  | 'usage_sessions'
  | 'seat_assignments';

/** 환불 확정 때 잠글 행들 */
export type AcceptanceLockTargets = {
  paymentId: string;
  ticketId: string;
  ticketPauseIds: string[];
  usageSessionIds: string[];
  seatAssignmentIds: string[];
};

/**
 * 환불 처리의 공유 잠금 순서 (data-model §7)
 * - Payment → Ticket → TicketPause → UsageSession → SeatAssignment → Refund → PaymentCancel → ManualRefundPayout
 * - 같은 종류의 행이 여러 개면 ID 오름차순으로 잠근다
 * - Service에 직접 잠금 쿼리를 두지 않고 이 저장소를 통해 같은 순서를 지킨다
 */
@Injectable()
export class RefundLockingRepository {
  /**
   * 환불 확정에 필요한 행을 공유 순서대로 잠근다
   * @param tx 트랜잭션 클라이언트
   * @param targets 잠글 결제·이용권·정지·세션·좌석 배정
   */
  async lockForAcceptance(
    tx: TransactionClient,
    targets: AcceptanceLockTargets,
  ): Promise<void> {
    // 공유 순서대로 잠근다
    await this.lockRows(tx, 'payments', [targets.paymentId]);
    await this.lockRows(tx, 'tickets', [targets.ticketId]);
    await this.lockRows(tx, 'ticket_pauses', targets.ticketPauseIds);
    await this.lockRows(tx, 'usage_sessions', targets.usageSessionIds);
    await this.lockRows(tx, 'seat_assignments', targets.seatAssignmentIds);
  }

  /**
   * 한 테이블의 행들을 잠근다
   * @param tx 트랜잭션 클라이언트
   * @param table 잠글 테이블(이 파일의 상수만 넘긴다)
   * @param ids 잠글 행 ID
   */
  private async lockRows(
    tx: TransactionClient,
    table: LockedTable,
    ids: string[],
  ): Promise<void> {
    for (const id of ids) {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id = ${id} FOR UPDATE`,
      );
    }
  }
}
