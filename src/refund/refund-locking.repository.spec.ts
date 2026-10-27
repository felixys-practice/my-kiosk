import { Prisma } from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';
import { RefundLockingRepository } from './refund-locking.repository';

/**
 * 실행한 잠금 쿼리의 테이블과 ID를 순서대로 기록하는 트랜잭션 대역
 */
class LockRecordingTx {
  readonly locked: string[] = [];

  $queryRaw = (sql: Prisma.Sql): Promise<unknown[]> => {
    const table = /FROM "(\w+)"/.exec(sql.sql)?.[1] ?? '알 수 없음';
    this.locked.push(`${table}:${sql.values.join(',')}`);
    return Promise.resolve([]);
  };
}

describe('RefundLockingRepository', () => {
  let tx: LockRecordingTx;
  let repository: RefundLockingRepository;

  beforeEach(() => {
    tx = new LockRecordingTx();
    repository = new RefundLockingRepository();
  });

  it('환불 확정 잠금은 Payment → Ticket → TicketPause → UsageSession → SeatAssignment 순서로 실행된다', async () => {
    await repository.lockForAcceptance(tx as unknown as TransactionClient, {
      paymentId: 'payment-1',
      ticketId: 'ticket-1',
      ticketPauseIds: ['pause-1'],
      usageSessionIds: ['session-1'],
      seatAssignmentIds: ['assignment-1'],
    });

    expect(tx.locked).toEqual([
      'payments:payment-1',
      'tickets:ticket-1',
      'ticket_pauses:pause-1',
      'usage_sessions:session-1',
      'seat_assignments:assignment-1',
    ]);
  });

  it('같은 종류의 행 여러 개는 ID 오름차순으로 잠긴다', async () => {
    await repository.lockForAcceptance(tx as unknown as TransactionClient, {
      paymentId: 'payment-1',
      ticketId: 'ticket-1',
      ticketPauseIds: [],
      usageSessionIds: ['session-b', 'session-a'],
      seatAssignmentIds: [],
    });

    expect(tx.locked.filter((row) => row.startsWith('usage_sessions'))).toEqual(
      ['usage_sessions:session-a', 'usage_sessions:session-b'],
    );
  });
});
