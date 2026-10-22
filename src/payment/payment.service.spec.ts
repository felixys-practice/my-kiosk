/* eslint-disable @typescript-eslint/unbound-method -- jest 목(mock) 메서드를 expect로 검증할 때 생기는 오탐 */
import {
  PaymentStatus,
  SeatReleaseReason,
  SeatType,
  TicketType,
} from '@prisma/client';
import { OrderItemRepository } from 'src/order-item/order-item.repository';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';
import { SeatHoldExpiredError } from 'src/seat-assignment/errors/seat-hold-expired.error';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { TransactionLoggerService } from 'src/logger/transaction-logger.service';
import { RefundService } from 'src/refund/refund.service';
import { PaymentAmountMismatchError } from './errors';
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';
import { PeriodPaymentData, TimePaymentData } from './payment.types';

describe('PaymentService', () => {
  const tx = {} as TransactionClient;

  let paymentRepository: jest.Mocked<PaymentRepository>;
  let orderItemRepository: jest.Mocked<OrderItemRepository>;
  let prisma: jest.Mocked<PrismaService>;
  let seatAssignmentService: jest.Mocked<SeatAssignmentService>;
  let refundService: jest.Mocked<RefundService>;
  let transactionLogger: jest.Mocked<TransactionLoggerService>;
  /** 트랜잭션 안에서 실행 중인지(커밋 후 호출 검증용) */
  let inTransaction: boolean;
  let service: PaymentService;

  /** 고정석 시간권 주문 항목 */
  const fixedItem = {
    id: 'item-fixed',
    ticketType: TicketType.TIME,
    seatType: SeatType.FIXED,
    purchasedMinutes: 600,
    purchasedDurationDays: null,
    usableDays: 30,
  };
  /** 자유석 기간권 주문 항목 */
  const freeItem = {
    id: 'item-free',
    ticketType: TicketType.PERIOD,
    seatType: SeatType.FREE,
    purchasedMinutes: null,
    purchasedDurationDays: 30,
    usableDays: 30,
  };

  /** 승인 성공 콜백 */
  const successPayload = {
    success: true,
    pgTransactionId: 'pg-1',
    amount: 20000,
    reason: null,
  };

  /**
   * 이용권 생성 데이터에서 주문 항목의 이용권 ID를 찾는다
   * @param orderItemId 주문 항목 ID
   * @returns 이용권 ID
   */
  function createdTicketId(orderItemId: string): string | undefined {
    const [, data] = paymentRepository.createTickets.mock.calls[0];
    const ticket = (
      data as ((TimePaymentData | PeriodPaymentData) & {
        id?: string;
      })[]
    ).find((item) => item.orderItemId === orderItemId);
    return ticket?.id;
  }

  beforeEach(() => {
    paymentRepository = {
      getPaymentByPgTransactionId: jest.fn().mockResolvedValue({
        id: 'payment-1',
        amount: 20000,
        status: PaymentStatus.REQUESTED,
        order: { id: 'order-1', userId: 'user-1' },
      }),
      approvePayment: jest.fn(),
      createTickets: jest.fn(),
      failedPayment: jest.fn(),
      createPayment: jest.fn().mockResolvedValue({ id: 'payment-1' }),
      requestedPayment: jest.fn(),
    } as unknown as jest.Mocked<PaymentRepository>;
    orderItemRepository = {
      getOrderItem: jest.fn().mockResolvedValue([fixedItem, freeItem]),
    } as unknown as jest.Mocked<OrderItemRepository>;
    inTransaction = false;
    prisma = {
      executeTransaction: jest.fn(
        async (work: (tx: TransactionClient) => Promise<unknown>) => {
          inTransaction = true;
          try {
            return await work(tx);
          } finally {
            inTransaction = false;
          }
        },
      ),
    } as unknown as jest.Mocked<PrismaService>;
    seatAssignmentService = {
      activateByOrderItem: jest.fn().mockResolvedValue(true),
      releaseByOrderItems: jest.fn(),
      releaseInvalidHolds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SeatAssignmentService>;
    refundService = {
      refundBySystem: jest.fn(),
    } as unknown as jest.Mocked<RefundService>;
    transactionLogger = {
      logTransaction: jest.fn(),
    } as unknown as jest.Mocked<TransactionLoggerService>;
    service = new PaymentService(
      paymentRepository,
      orderItemRepository,
      prisma,
      seatAssignmentService,
      refundService,
      transactionLogger,
    );
  });

  describe('callbackPayment', () => {
    it('승인 성공 시 같은 트랜잭션에서 고정석 주문 항목의 선점을 확정한다', async () => {
      await service.callbackPayment(successPayload);

      expect(seatAssignmentService.activateByOrderItem).toHaveBeenCalledTimes(
        1,
      );
      expect(seatAssignmentService.activateByOrderItem).toHaveBeenCalledWith(
        'item-fixed',
        createdTicketId('item-fixed'),
        expect.any(Date),
        tx,
      );
      expect(createdTicketId('item-fixed')).toEqual(expect.any(String));
    });

    it('승인 성공 시 이용권 좌석 타입은 주문 항목 스냅샷을 따른다', async () => {
      await service.callbackPayment(successPayload);

      const [, data] = paymentRepository.createTickets.mock.calls[0];
      expect(
        (data as { orderItemId: string; seatType?: SeatType }[]).map(
          (ticket) => [ticket.orderItemId, ticket.seatType],
        ),
      ).toEqual([
        ['item-fixed', SeatType.FIXED],
        ['item-free', SeatType.FREE],
      ]);
    });

    it('좌석을 확정하지 못한 이용권은 커밋 후 시스템 자동 취소를 요청한다', async () => {
      const secondFixed = { ...fixedItem, id: 'item-fixed-2' };
      orderItemRepository.getOrderItem.mockResolvedValue([
        fixedItem,
        secondFixed,
      ] as Awaited<ReturnType<OrderItemRepository['getOrderItem']>>);
      // 첫 항목만 좌석이 다른 이용권에 넘어가 확정 실패
      seatAssignmentService.activateByOrderItem.mockImplementation(
        (orderItemId) => Promise.resolve(orderItemId !== 'item-fixed'),
      );
      const calledInTransaction: boolean[] = [];
      refundService.refundBySystem.mockImplementation(() => {
        calledInTransaction.push(inTransaction);
        return Promise.resolve();
      });

      await service.callbackPayment(successPayload);

      expect(refundService.refundBySystem).toHaveBeenCalledTimes(1);
      expect(refundService.refundBySystem).toHaveBeenCalledWith(
        createdTicketId('item-fixed'),
        '좌석 선점 만료로 좌석 배정 불가 - 자동 결제 취소',
      );
      expect(calledInTransaction).toEqual([false]);
    });

    it('자동 취소 요청이 예외를 던져도 콜백은 성공하고 거래 로그를 남긴다', async () => {
      seatAssignmentService.activateByOrderItem.mockResolvedValue(false);
      refundService.refundBySystem.mockRejectedValue(new Error('PG 장애'));

      await expect(
        service.callbackPayment(successPayload),
      ).resolves.toBeUndefined();

      expect(transactionLogger.logTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'REFUND',
          orderId: 'order-1',
          status: 'SYSTEM_REFUND_REQUEST_FAILED',
        }),
      );
    });

    it('승인 실패 콜백이면 주문 항목의 선점을 PAYMENT_FAILED로 해제한다', async () => {
      await service.callbackPayment({
        ...successPayload,
        success: false,
        reason: '한도 초과',
      });

      expect(paymentRepository.failedPayment).toHaveBeenCalledWith(
        'payment-1',
        '한도 초과',
        tx,
      );
      expect(seatAssignmentService.releaseByOrderItems).toHaveBeenCalledWith(
        ['item-fixed', 'item-free'],
        SeatReleaseReason.PAYMENT_FAILED,
        expect.any(Date),
        tx,
      );
    });

    it('승인 금액이 다르면 선점을 PAYMENT_FAILED로 해제한다', async () => {
      await expect(
        service.callbackPayment({ ...successPayload, amount: 1 }),
      ).rejects.toBeInstanceOf(PaymentAmountMismatchError);

      expect(seatAssignmentService.releaseByOrderItems).toHaveBeenCalledWith(
        ['item-fixed', 'item-free'],
        SeatReleaseReason.PAYMENT_FAILED,
        expect.any(Date),
        tx,
      );
    });
  });

  describe('requestPayment', () => {
    it('결제 요청 시 무효 선점이 있으면 VAN 요청 전에 SeatHoldExpiredError다', async () => {
      seatAssignmentService.releaseInvalidHolds.mockResolvedValue([
        'item-fixed',
      ]);

      await expect(
        service.requestPayment('order-1', 'user-1'),
      ).rejects.toBeInstanceOf(SeatHoldExpiredError);

      // 고정석 주문 항목만 확인하고, 결제는 만들지 않는다
      expect(seatAssignmentService.releaseInvalidHolds).toHaveBeenCalledWith(
        ['item-fixed'],
        expect.any(Date),
        tx,
      );
      expect(paymentRepository.createPayment).not.toHaveBeenCalled();
    });
  });
});
