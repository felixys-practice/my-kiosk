/* eslint-disable @typescript-eslint/unbound-method -- jest 목(mock) 메서드를 expect로 검증할 때 생기는 오탐 */
import {
  PaymentCancelStatus,
  SeatReleaseReason,
  TicketStatus,
  TicketType,
} from '@prisma/client';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { DomainConflictError } from 'src/common/errors';
import { TransactionClient } from 'src/prisma/prisma.service';
import { TransactionLoggerService } from 'src/logger/transaction-logger.service';
import { PgService } from 'src/pg/pg.service';
import { PgCancelInquiryResult } from 'src/pg/pg.types';
import { RefundRepository } from './refund.repository';
import { RefundService } from './refund.service';

describe('RefundService', () => {
  const tx = {} as TransactionClient;
  const ticketId = 'ticket-1';

  let repository: jest.Mocked<RefundRepository>;
  let transactionLogger: jest.Mocked<TransactionLoggerService>;
  let pgService: jest.Mocked<PgService>;
  let seatAssignmentService: jest.Mocked<SeatAssignmentService>;
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
      getPaymentCancelById: jest.fn().mockResolvedValue({
        id: 'cancel-1',
        amount: 10000,
        status: PaymentCancelStatus.REQUESTED,
      }),
      confirmRefundSuccess: jest.fn(),
      deleteRefundLock: jest.fn(),
      failPaymentCancel: jest.fn(),
      findTicketIdByOrderItem: jest.fn().mockResolvedValue('ticket-1'),
      extendRefundLock: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<RefundRepository>;
    transactionLogger = {
      logRefund: jest.fn(),
    } as unknown as jest.Mocked<TransactionLoggerService>;
    pgService = {
      requestPaymentCancel: jest.fn(),
      inquiryPaymentCancel: jest.fn(),
    } as unknown as jest.Mocked<PgService>;
    seatAssignmentService = {
      releaseByTicket: jest.fn(),
    } as unknown as jest.Mocked<SeatAssignmentService>;
    service = new RefundService(
      repository,
      transactionLogger,
      pgService,
      seatAssignmentService,
    );
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

  describe('callback', () => {
    it('환불 콜백으로 확정되면 같은 트랜잭션에서 TICKET_REVOKED로 배정을 해제한다', async () => {
      await service.callback(true, 'cancel-1', 'item-1', 10000);

      expect(seatAssignmentService.releaseByTicket).toHaveBeenCalledWith(
        'ticket-1',
        SeatReleaseReason.TICKET_REVOKED,
        expect.any(Date),
        tx,
      );
    });

    it('낡은 락 정리에서 PG 취소 성공이 확인되면 TICKET_REVOKED로 배정을 해제한다', async () => {
      // 만료된 락(같은 요청이 남긴 미제 환불)과 PG 조회 결과 "성공"
      const staleLock = {
        orderItemId: 'item-1',
        paymentCancelId: 'cancel-1',
        expiresAt: new Date(Date.now() - 60 * 1000),
      };
      repository.getRefundLock.mockResolvedValue(
        staleLock as Awaited<ReturnType<RefundRepository['getRefundLock']>>,
      );
      repository.getPaymentCancelById.mockResolvedValue({
        id: 'cancel-1',
        amount: 10000,
        status: PaymentCancelStatus.REQUESTED,
        idempotencyKey: 'key-1',
      } as Awaited<ReturnType<RefundRepository['getPaymentCancelById']>>);
      pgService.inquiryPaymentCancel.mockResolvedValue({
        result: PgCancelInquiryResult.SUCCEEDED,
      });

      await service.refund('user-1', ticketId, 'key-1');

      expect(seatAssignmentService.releaseByTicket).toHaveBeenCalledWith(
        'ticket-1',
        SeatReleaseReason.TICKET_REVOKED,
        expect.any(Date),
        tx,
      );
    });

    it('환불이 실패로 끝나면 배정을 해제하지 않는다', async () => {
      await service.callback(false, 'cancel-1', 'item-1', 10000, 'PG 거절');

      expect(seatAssignmentService.releaseByTicket).not.toHaveBeenCalled();
    });
  });
});
