/* eslint-disable @typescript-eslint/unbound-method -- jest 목(mock) 메서드를 expect로 검증할 때 생기는 오탐 */
import { TicketStatus, TicketType } from '@prisma/client';
import { DomainConflictError } from 'src/common/errors';
import { TransactionClient } from 'src/prisma/prisma.service';
import { TransactionLoggerService } from 'src/logger/transaction-logger.service';
import { PgService } from 'src/pg/pg.service';
import { RefundRepository } from './refund.repository';
import { RefundService } from './refund.service';

describe('RefundService', () => {
  const tx = {} as TransactionClient;
  const ticketId = 'ticket-1';

  let repository: jest.Mocked<RefundRepository>;
  let transactionLogger: jest.Mocked<TransactionLoggerService>;
  let pgService: jest.Mocked<PgService>;
  let service: RefundService;

  /** 미사용 시간권(사용자 user-1 소유) */
  const unusedTicket = {
    userId: 'user-1',
    type: TicketType.TIME,
    status: TicketStatus.UNUSED,
    activatedAt: null,
    remainingMinutes: 600,
    purchasedMinutes: 600,
    usageSessions: [],
    orderItem: {
      id: 'item-1',
      order: { id: 'order-1', payments: [{ id: 'payment-1' }] },
    },
  };

  beforeEach(() => {
    repository = {
      getTicketById: jest.fn().mockResolvedValue(unusedTicket),
      runInTransaction: jest.fn((work: (tx: TransactionClient) => unknown) =>
        Promise.resolve(work(tx)),
      ),
      getRefundLock: jest.fn().mockResolvedValue(null),
      calculateRefundableAmount: jest
        .fn()
        .mockResolvedValue({ already_refunded: false, refund_amount: 10000 }),
      createPaymentCancel: jest
        .fn()
        .mockResolvedValue({ id: 'cancel-1', amount: 10000 }),
      createRefundLock: jest.fn(),
    } as unknown as jest.Mocked<RefundRepository>;
    transactionLogger = {
      logRefund: jest.fn(),
    } as unknown as jest.Mocked<TransactionLoggerService>;
    pgService = {
      requestPaymentCancel: jest.fn(),
    } as unknown as jest.Mocked<PgService>;
    service = new RefundService(repository, transactionLogger, pgService);
  });

  describe('refundBySystem', () => {
    it('시스템 자동 취소는 소유자 검사 없이 PG 취소를 요청한다', async () => {
      await service.refundBySystem(ticketId, '좌석 지정 실패로 자동 취소');

      expect(pgService.requestPaymentCancel).toHaveBeenCalledWith(
        'cancel-1',
        'order-1',
        'item-1',
        'user-1',
        10000,
      );
    });

    it('시스템 자동 취소 사유를 결제 취소 기록에 남긴다', async () => {
      await service.refundBySystem(ticketId, '좌석 지정 실패로 자동 취소');

      expect(repository.createPaymentCancel).toHaveBeenCalledWith(
        10000,
        'payment-1',
        'item-1',
        expect.any(Date),
        undefined,
        tx,
        '좌석 지정 실패로 자동 취소',
      );
    });

    it('이미 환불된 이용권을 자동 취소하면 DomainConflictError다', async () => {
      repository.getTicketById.mockResolvedValue({
        ...unusedTicket,
        status: TicketStatus.REVOKED,
      });

      await expect(
        service.refundBySystem(ticketId, '자동 취소'),
      ).rejects.toBeInstanceOf(DomainConflictError);
      expect(pgService.requestPaymentCancel).not.toHaveBeenCalled();
    });

    it('사용 이력이 있는 이용권을 자동 취소하면 승인 대기로 가지 않고 예외다', async () => {
      repository.getTicketById.mockResolvedValue({
        ...unusedTicket,
        remainingMinutes: 300,
      });

      await expect(
        service.refundBySystem(ticketId, '자동 취소'),
      ).rejects.toBeInstanceOf(DomainConflictError);
      expect(pgService.requestPaymentCancel).not.toHaveBeenCalled();
    });
  });
});
