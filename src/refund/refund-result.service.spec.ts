import { vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { TransactionClient } from 'src/prisma/prisma.service';
import { TransactionLoggerService } from 'src/logger/transaction-logger.service';
import { RefundLedgerRepository } from 'src/ledger/refund-ledger.repository';
import {
  PaymentCancelResultTargetMissingError,
  PgCallbackTargetNotFoundError,
  RefundStorageUnavailableError,
} from './errors';
import { RefundEventRepository } from './refund-event.repository';
import { RefundLockingRepository } from './refund-locking.repository';
import { RefundRepository } from './refund.repository';
import { RefundResultService } from './refund-result.service';

describe('환불 콜백의 필수 연결', () => {
  it('U398 환불 기록에 연결되지 않은 취소 요청은 옛 경로로 처리하지 않고 대상 없음으로 거절한다', async () => {
    const repository = {
      findPaymentCancelForResult: vi.fn().mockResolvedValue(null),
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
        amount: 10000,
        reason: null,
      }),
    ).rejects.toBeInstanceOf(PgCallbackTargetNotFoundError);
  });
});

describe('PG 취소 결과 반영 대상 누락', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup(afterLock = false) {
    const find = vi.fn().mockResolvedValue(null);
    if (afterLock)
      find.mockResolvedValueOnce({ id: 'cancel', refund: { id: 'refund' } });
    const ledger = { recordPayout: vi.fn() };
    const events = { createNotification: vi.fn() };
    const repository = {
      findPaymentCancelForResult: find,
      runInTransaction: (work: (tx: TransactionClient) => Promise<unknown>) =>
        work({} as TransactionClient),
    } as unknown as RefundRepository;
    const service = new RefundResultService(
      repository,
      { lockForPayout: vi.fn() } as unknown as RefundLockingRepository,
      ledger,
      events as unknown as RefundEventRepository,
      { logTransaction: vi.fn() } as unknown as TransactionLoggerService,
    );
    return { service, ledger };
  }

  it.each([
    ['DISPATCH', false],
    ['DISPATCH', true],
    ['RECOVERY', false],
    ['RECOVERY', true],
  ] as const)(
    '내부 결과 반영에서 대상이 없으면 예외와 장애 로그를 남긴다(경로: %s, 락 이후: %s)',
    async (source, afterLock) => {
      const log = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      const { service, ledger } = setup(afterLock);
      const pgCancelResult = {
        kind: 'SUCCEEDED' as const,
        pgTransactionId: 'pg-cancel',
        actualAmount: 10000,
      };
      await expect(
        service.applyPgResult({
          source,
          paymentCancelId: 'cancel',
          claimToken: 'claim',
          pgCancelResult,
        }),
      ).rejects.toMatchObject({
        name: PaymentCancelResultTargetMissingError.name,
        paymentCancelId: 'cancel',
      });
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentCancelId: 'cancel',
          source,
          pgCancelResult,
        }),
      );
      expect(ledger.recordPayout).not.toHaveBeenCalled();
    },
  );

  it('락 이후 대상이 없어져도 콜백은 기존 대상 없음 오류로 응답한다', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const { service } = setup(true);
    await expect(
      service.receiveCallback({
        success: true,
        paymentCancelId: 'cancel',
        pgTransactionId: 'pg-cancel',
        amount: 10000,
      }),
    ).rejects.toBeInstanceOf(PgCallbackTargetNotFoundError);
    expect(log).not.toHaveBeenCalled();
  });

  it('콜백의 다른 저장 오류는 대상 없음으로 바꾸지 않는다', async () => {
    const { service } = setup();
    vi.spyOn(service, 'applyPgResult').mockRejectedValue(
      new Error('저장 실패'),
    );
    await expect(
      service.receiveCallback({
        success: true,
        paymentCancelId: 'cancel',
        pgTransactionId: 'pg-cancel',
        amount: 10000,
      }),
    ).rejects.toBeInstanceOf(RefundStorageUnavailableError);
  });
});
