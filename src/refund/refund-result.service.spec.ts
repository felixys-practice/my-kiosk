import { TransactionClient } from 'src/prisma/prisma.service';
import { TransactionLoggerService } from 'src/logger/transaction-logger.service';
import { RefundLedgerRepository } from 'src/ledger/refund-ledger.repository';
import { PgCallbackTargetNotFoundError } from './errors';
import { RefundEventRepository } from './refund-event.repository';
import { RefundLockingRepository } from './refund-locking.repository';
import { RefundRepository } from './refund.repository';
import { RefundResultService } from './refund-result.service';

describe('환불 콜백의 필수 연결', () => {
  it('U398 환불 기록에 연결되지 않은 취소 요청은 옛 경로로 처리하지 않고 대상 없음으로 거절한다', async () => {
    const repository = {
      findAttemptForResult: jest.fn().mockResolvedValue(null),
      runInTransaction: (work: (tx: TransactionClient) => Promise<unknown>) =>
        work({} as TransactionClient),
    } as unknown as RefundRepository;
    const service = new RefundResultService(
      repository,
      {} as RefundLockingRepository,
      {} as RefundLedgerRepository,
      {} as RefundEventRepository,
      {} as TransactionLoggerService,
    );
    await expect(
      service.receiveCallback({
        success: true,
        paymentCancelId: 'unlinked-attempt',
        pgTransactionId: 'pg-cancel',
        orderItemId: 'order-item',
        amount: 10000,
        reason: null,
      }),
    ).rejects.toBeInstanceOf(PgCallbackTargetNotFoundError);
  });
});
