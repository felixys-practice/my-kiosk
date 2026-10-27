import { TransactionLoggerService } from '../logger/transaction-logger.service';
import { PgService } from './pg.service';
import { PgCancelInquiryResult } from './pg.types';

describe('PgService', () => {
  let service: PgService;

  beforeEach(() => {
    const transactionLogger = {
      logTransaction: jest.fn(),
      logPaymentRequest: jest.fn(),
      logRefundRequest: jest.fn(),
    } as unknown as TransactionLoggerService;
    service = new PgService(transactionLogger);
  });

  describe('현재 동작 기록(특성화)', () => {
    it('PG 거래조회는 지금 어떤 입력이든 NOT_FOUND를 반환한다', async () => {
      const inquiry = await service.inquiryPaymentCancel(
        'order-1',
        'order-item-1',
        'user-1',
        'payment-cancel-1',
      );

      expect(inquiry).toEqual({ result: PgCancelInquiryResult.NOT_FOUND });
    });
  });
});
