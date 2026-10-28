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
import { RefundSystemService } from 'src/refund/refund-system.service';
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';
import { PeriodPaymentData, TimePaymentData } from './payment.types';

describe('PaymentService', () => {
  const tx = {} as TransactionClient;

  let paymentRepository: jest.Mocked<PaymentRepository>;
  let orderItemRepository: jest.Mocked<OrderItemRepository>;
  let prisma: jest.Mocked<PrismaService>;
  let seatAssignmentService: jest.Mocked<SeatAssignmentService>;
  let transactionLogger: jest.Mocked<TransactionLoggerService>;
  let refundSystemService: jest.Mocked<RefundSystemService>;
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
      failApprovalMismatch: jest.fn(),
      lockForApproval: jest.fn().mockResolvedValue({
        status: PaymentStatus.REQUESTED,
        approvedAmount: null,
      }),
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
      releaseEndedHolds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SeatAssignmentService>;
    transactionLogger = {
      logTransaction: jest.fn(),
    } as unknown as jest.Mocked<TransactionLoggerService>;
    refundSystemService = {
      acceptPaymentMismatch: jest.fn(),
      acceptSeatAssignmentFailure: jest.fn(),
      sendAfterCommit: jest.fn(),
    } as unknown as jest.Mocked<RefundSystemService>;
    service = new PaymentService(
      paymentRepository,
      orderItemRepository,
      prisma,
      seatAssignmentService,
      transactionLogger,
      refundSystemService,
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

    it('좌석을 확정하지 못한 이용권은 승인과 같은 트랜잭션에서 상품 대상 시스템 환불로 확정하고 커밋 뒤 PG 취소를 보낸다', async () => {
      const secondFixed = { ...fixedItem, id: 'item-fixed-2' };
      orderItemRepository.getOrderItem.mockResolvedValue([
        fixedItem,
        secondFixed,
      ] as Awaited<ReturnType<OrderItemRepository['getOrderItem']>>);
      // 첫 항목만 좌석이 다른 이용권에 넘어가 확정 실패
      seatAssignmentService.activateByOrderItem.mockImplementation(
        (orderItemId) => Promise.resolve(orderItemId !== 'item-fixed'),
      );
      const pending = {
        paymentCancelId: 'cancel-1',
        amount: 10000,
        claimToken: 'claim-1',
        sentAt: new Date(),
      };
      const steps: [string, boolean][] = [];
      refundSystemService.acceptSeatAssignmentFailure.mockImplementation(() => {
        steps.push(['환불 확정', inTransaction]);
        return Promise.resolve(pending);
      });
      refundSystemService.sendAfterCommit.mockImplementation(() => {
        steps.push(['PG 취소 전송', inTransaction]);
        return Promise.resolve();
      });

      await service.callbackPayment(successPayload);

      expect({
        accepted: refundSystemService.acceptSeatAssignmentFailure.mock.calls,
        sent: refundSystemService.sendAfterCommit.mock.calls,
        steps,
      }).toEqual({
        accepted: [
          [
            tx,
            {
              paymentId: 'payment-1',
              orderItemId: 'item-fixed',
              ticketId: createdTicketId('item-fixed'),
              now: expect.any(Date) as Date,
            },
          ],
        ],
        sent: [[pending]],
        steps: [
          ['환불 확정', true],
          ['PG 취소 전송', false],
        ],
      });
    });

    it('좌석 배정 실패 환불의 PG 전송이 커밋 뒤 예외를 던져도 콜백은 성공하고 거래 로그를 남긴다', async () => {
      seatAssignmentService.activateByOrderItem.mockResolvedValue(false);
      refundSystemService.acceptSeatAssignmentFailure.mockResolvedValue({
        paymentCancelId: 'cancel-1',
        amount: 10000,
        claimToken: 'claim-1',
        sentAt: new Date(),
      });
      refundSystemService.sendAfterCommit.mockRejectedValue(
        new Error('PG 장애'),
      );

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

    it('승인 금액이 다르면 같은 트랜잭션에서 실제 승인액을 보존하고 승인액 전액의 결제 전체 대상 시스템 환불을 확정하며 커밋 뒤 PG 취소를 보낸다', async () => {
      /** PG가 실제로 승인했다고 알린 금액(요청액 20000원과 다름) */
      const approvedAmount = 15000;
      const pending = {
        paymentCancelId: 'cancel-1',
        amount: approvedAmount,
        claimToken: 'claim-1',
        sentAt: new Date(),
      };
      const steps: [string, boolean][] = [];
      paymentRepository.failApprovalMismatch.mockImplementation(() => {
        steps.push(['결제 실패·승인액 저장', inTransaction]);
        return Promise.resolve();
      });
      refundSystemService.acceptPaymentMismatch.mockImplementation(() => {
        steps.push(['환불 확정', inTransaction]);
        return Promise.resolve(pending);
      });
      refundSystemService.sendAfterCommit.mockImplementation(() => {
        steps.push(['PG 취소 전송', inTransaction]);
        return Promise.resolve();
      });

      await service.callbackPayment({
        ...successPayload,
        amount: approvedAmount,
      });

      expect({
        failed: paymentRepository.failApprovalMismatch.mock.calls,
        accepted: refundSystemService.acceptPaymentMismatch.mock.calls,
        sent: refundSystemService.sendAfterCommit.mock.calls,
        steps,
      }).toEqual({
        failed: [
          ['payment-1', approvedAmount, expect.any(String) as string, tx],
        ],
        accepted: [
          [
            tx,
            {
              paymentId: 'payment-1',
              approvedAmount,
              now: expect.any(Date) as Date,
            },
          ],
        ],
        sent: [[pending]],
        steps: [
          ['결제 실패·승인액 저장', true],
          ['환불 확정', true],
          ['PG 취소 전송', false],
        ],
      });
    });

    it('승인 금액이 다르면 이용권을 발행하지 않는다', async () => {
      await service.callbackPayment({ ...successPayload, amount: 15000 });

      expect({
        tickets: paymentRepository.createTickets.mock.calls.length,
        approved: paymentRepository.approvePayment.mock.calls.length,
      }).toEqual({ tickets: 0, approved: 0 });
    });

    it('이미 반영한 같은 승인 금액 불일치 콜백이 다시 오면 예외 없이 끝나고 시스템 환불을 다시 만들지 않는다', async () => {
      paymentRepository.getPaymentByPgTransactionId.mockResolvedValue({
        id: 'payment-1',
        amount: 20000,
        approvedAmount: 15000,
        status: PaymentStatus.FAILED,
        order: { id: 'order-1', userId: 'user-1' },
      });

      await expect(
        service.callbackPayment({ ...successPayload, amount: 15000 }),
      ).resolves.toBeUndefined();

      expect(refundSystemService.acceptPaymentMismatch).not.toHaveBeenCalled();
    });

    it('승인 금액이 다르면 선점을 PAYMENT_FAILED로 해제하고 콜백은 수신 확인으로 끝난다', async () => {
      await expect(
        service.callbackPayment({ ...successPayload, amount: 1 }),
      ).resolves.toBeUndefined();

      expect(seatAssignmentService.releaseByOrderItems).toHaveBeenCalledWith(
        ['item-fixed', 'item-free'],
        SeatReleaseReason.PAYMENT_FAILED,
        expect.any(Date),
        tx,
      );
    });
  });

  describe('requestPayment', () => {
    it('결제 요청 시 점유가 끝난 선점이 있으면 VAN 요청 전에 SeatHoldExpiredError다', async () => {
      seatAssignmentService.releaseEndedHolds.mockResolvedValue(['item-fixed']);

      await expect(
        service.requestPayment('order-1', 'user-1'),
      ).rejects.toBeInstanceOf(SeatHoldExpiredError);

      // 고정석 주문 항목만 확인하고, 결제는 만들지 않는다
      expect(seatAssignmentService.releaseEndedHolds).toHaveBeenCalledWith(
        ['item-fixed'],
        expect.any(Date),
        tx,
      );
      expect(paymentRepository.createPayment).not.toHaveBeenCalled();
    });
  });
});
