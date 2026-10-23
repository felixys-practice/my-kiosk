/* eslint-disable @typescript-eslint/unbound-method -- jest 목(mock) 메서드를 expect로 검증할 때 생기는 오탐 */
import { ConfigService } from '@nestjs/config';
import {
  PaymentStatus,
  Product,
  SeatReleaseReason,
  SeatType,
  TicketType,
} from '@prisma/client';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';
import { SeatSelectionRequiredError } from 'src/seat-assignment/errors/seat-selection-required.error';
import { SeatShopMismatchError } from 'src/seat-assignment/errors/seat-shop-mismatch.error';
import { SeatTypeMismatchError } from 'src/seat-assignment/errors/seat-type-mismatch.error';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { TicketService } from 'src/ticket/ticket.service';
import { DuplicateSeatInOrderError } from './errors/duplicate-seat-in-order.error';
import { OrderAlreadyPaidError } from './errors/order-already-paid.error';
import { OrderNotFoundError } from './errors/order-not-found.error';
import { FixedSeatQuantityError } from './errors/fixed-seat-quantity.error';
import { SeatNotAllowedError } from './errors/seat-not-allowed.error';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';

describe('OrderService', () => {
  const tx = {} as TransactionClient;
  const shopId = 'shop-1';
  const userId = 'user-1';

  let repository: jest.Mocked<OrderRepository>;
  let prisma: jest.Mocked<PrismaService>;
  let seatAssignmentService: jest.Mocked<SeatAssignmentService>;
  let configService: jest.Mocked<ConfigService>;
  let service: OrderService;

  /**
   * 테스트용 상품을 만든다
   * @param id 상품 ID
   * @param seatType 좌석 타입
   * @returns 상품
   */
  function product(id: string, seatType: SeatType): Product {
    return {
      id,
      shopId,
      name: `${seatType} 시간권`,
      ticketType: TicketType.TIME,
      seatType,
      amount: 10000,
      usableDays: 30,
      isActive: true,
      purchasedMinutes: 600,
      purchasedDurationDays: null,
    } as Product;
  }

  beforeEach(() => {
    repository = {
      findActiveProducts: jest.fn(),
      findSeats: jest.fn().mockResolvedValue([]),
      findOrderWithPayments: jest.fn().mockResolvedValue({
        id: 'order-1',
        orderItems: [{ id: 'item-1' }, { id: 'item-2' }],
        payments: [{ status: PaymentStatus.REQUESTED }],
      }),
      createOrderWithItems: jest.fn().mockResolvedValue({ id: 'order-1' }),
      getOrder: jest.fn(),
    } as unknown as jest.Mocked<OrderRepository>;
    prisma = {
      executeTransaction: jest.fn((work: (tx: TransactionClient) => unknown) =>
        Promise.resolve(work(tx)),
      ),
    } as unknown as jest.Mocked<PrismaService>;
    seatAssignmentService = {
      hold: jest.fn(),
      releaseByOrderItems: jest.fn(),
    } as unknown as jest.Mocked<SeatAssignmentService>;
    configService = {
      get: jest.fn().mockReturnValue(10),
    } as unknown as jest.Mocked<ConfigService>;
    service = new OrderService(
      repository,
      {} as TicketService,
      prisma,
      seatAssignmentService,
      configService,
    );
  });

  describe('createOrder', () => {
    it('고정석 상품 줄에 좌석이 없으면 SeatSelectionRequiredError다', async () => {
      repository.findActiveProducts.mockResolvedValue([
        product('fixed-1', SeatType.FIXED),
      ]);

      await expect(
        service.createOrder(shopId, userId, [
          { productId: 'fixed-1', quantity: 1 },
        ]),
      ).rejects.toBeInstanceOf(SeatSelectionRequiredError);
      expect(repository.createOrderWithItems).not.toHaveBeenCalled();
    });

    it('고정석 상품 줄의 수량이 1이 아니면 FixedSeatQuantityError다', async () => {
      repository.findActiveProducts.mockResolvedValue([
        product('fixed-1', SeatType.FIXED),
      ]);

      await expect(
        service.createOrder(shopId, userId, [
          { productId: 'fixed-1', quantity: 2, seatId: 'seat-1' },
        ]),
      ).rejects.toBeInstanceOf(FixedSeatQuantityError);
      expect(repository.createOrderWithItems).not.toHaveBeenCalled();
    });

    it('자유석 상품 줄에 좌석이 있으면 SeatNotAllowedError다', async () => {
      repository.findActiveProducts.mockResolvedValue([
        product('free-1', SeatType.FREE),
      ]);

      await expect(
        service.createOrder(shopId, userId, [
          { productId: 'free-1', quantity: 1, seatId: 'seat-1' },
        ]),
      ).rejects.toBeInstanceOf(SeatNotAllowedError);
      expect(repository.createOrderWithItems).not.toHaveBeenCalled();
    });

    it('고정석 상품 줄의 좌석이 자유석이면 SeatTypeMismatchError다', async () => {
      repository.findActiveProducts.mockResolvedValue([
        product('fixed-1', SeatType.FIXED),
      ]);
      repository.findSeats.mockResolvedValue([
        { id: 'seat-1', shopId, type: SeatType.FREE },
      ]);

      await expect(
        service.createOrder(shopId, userId, [
          { productId: 'fixed-1', quantity: 1, seatId: 'seat-1' },
        ]),
      ).rejects.toBeInstanceOf(SeatTypeMismatchError);
      expect(repository.createOrderWithItems).not.toHaveBeenCalled();
    });

    it('고정석 상품 줄의 좌석이 다른 매장 좌석이면 SeatShopMismatchError다', async () => {
      repository.findActiveProducts.mockResolvedValue([
        product('fixed-1', SeatType.FIXED),
      ]);
      repository.findSeats.mockResolvedValue([
        { id: 'seat-1', shopId: 'other-shop', type: SeatType.FIXED },
      ]);

      await expect(
        service.createOrder(shopId, userId, [
          { productId: 'fixed-1', quantity: 1, seatId: 'seat-1' },
        ]),
      ).rejects.toBeInstanceOf(SeatShopMismatchError);
      expect(repository.createOrderWithItems).not.toHaveBeenCalled();
    });

    it('같은 주문 안에서 같은 좌석을 중복 선택하면 DuplicateSeatInOrderError다', async () => {
      repository.findActiveProducts.mockResolvedValue([
        product('fixed-1', SeatType.FIXED),
      ]);
      repository.findSeats.mockResolvedValue([
        { id: 'seat-1', shopId, type: SeatType.FIXED },
      ]);

      await expect(
        service.createOrder(shopId, userId, [
          { productId: 'fixed-1', quantity: 1, seatId: 'seat-1' },
          { productId: 'fixed-1', quantity: 1, seatId: 'seat-1' },
        ]),
      ).rejects.toBeInstanceOf(DuplicateSeatInOrderError);
      expect(repository.createOrderWithItems).not.toHaveBeenCalled();
    });

    it('고정석 줄마다 선점 유효시간만큼 좌석을 선점한다', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-22T10:00:00Z'));
      repository.findActiveProducts.mockResolvedValue([
        product('fixed-1', SeatType.FIXED),
        product('free-1', SeatType.FREE),
      ]);
      repository.findSeats.mockResolvedValue([
        { id: 'seat-1', shopId, type: SeatType.FIXED },
      ]);

      await service.createOrder(shopId, userId, [
        { productId: 'fixed-1', quantity: 1, seatId: 'seat-1' },
        { productId: 'free-1', quantity: 1 },
      ]);

      const [orderData] = repository.createOrderWithItems.mock.calls[0];
      const fixedItem = orderData.orderItems.find(
        (item) => item.productId === 'fixed-1',
      );
      expect(seatAssignmentService.hold).toHaveBeenCalledTimes(1);
      expect(seatAssignmentService.hold).toHaveBeenCalledWith(
        {
          seatId: 'seat-1',
          shopId,
          orderItemId: fixedItem?.id,
          heldUntil: new Date('2026-10-22T10:10:00Z'),
        },
        new Date('2026-10-22T10:00:00Z'),
        tx,
      );
      jest.useRealTimers();
    });

    it('주문 항목에 구매 시점 상품의 좌석 타입을 저장한다', async () => {
      repository.findActiveProducts.mockResolvedValue([
        product('fixed-1', SeatType.FIXED),
        product('free-1', SeatType.FREE),
      ]);
      repository.findSeats.mockResolvedValue([
        { id: 'seat-1', shopId, type: SeatType.FIXED },
      ]);

      await service.createOrder(shopId, userId, [
        { productId: 'fixed-1', quantity: 1, seatId: 'seat-1' },
        { productId: 'free-1', quantity: 1 },
      ]);

      const [orderData] = repository.createOrderWithItems.mock.calls[0];
      expect(
        orderData.orderItems.map((item) => [item.productId, item.seatType]),
      ).toEqual([
        ['fixed-1', SeatType.FIXED],
        ['free-1', SeatType.FREE],
      ]);
    });
  });

  describe('cancelOrder', () => {
    it('주문을 취소하면 주문 항목의 선점을 ORDER_CANCELLED로 해제한다', async () => {
      await service.cancelOrder('order-1');

      expect(seatAssignmentService.releaseByOrderItems).toHaveBeenCalledWith(
        ['item-1', 'item-2'],
        SeatReleaseReason.ORDER_CANCELLED,
        expect.any(Date),
        tx,
      );
    });

    it('없는 주문을 취소하면 OrderNotFoundError다', async () => {
      repository.findOrderWithPayments.mockResolvedValue(null);

      await expect(service.cancelOrder('order-x')).rejects.toBeInstanceOf(
        OrderNotFoundError,
      );
    });

    it('결제가 성공한 주문을 취소하면 OrderAlreadyPaidError다', async () => {
      repository.findOrderWithPayments.mockResolvedValue({
        id: 'order-1',
        orderItems: [{ id: 'item-1' }],
        payments: [{ status: PaymentStatus.SUCCESS }],
      });

      await expect(service.cancelOrder('order-1')).rejects.toBeInstanceOf(
        OrderAlreadyPaidError,
      );
      expect(seatAssignmentService.releaseByOrderItems).not.toHaveBeenCalled();
    });
  });
});
