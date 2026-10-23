/* eslint-disable @typescript-eslint/unbound-method -- jest 목(mock) 메서드를 expect로 검증할 때 생기는 오탐 */
import { SeatType, TicketType } from '@prisma/client';
import { ProductFieldMismatchError } from './errors/product-field-mismatch.error';
import { ProductNotFoundError } from './errors/product-not-found.error';
import { ProductRepository } from './product.repository';
import { ProductService } from './product.service';

describe('ProductService', () => {
  const shopId = 'shop-1';
  const productId = 'product-1';
  const userId = 'user-1';

  let repository: jest.Mocked<ProductRepository>;
  let service: ProductService;

  /** 수정 전 시간권 상품 */
  const timeProduct = {
    id: productId,
    name: '자유석 시간권',
    ticketType: TicketType.TIME,
    amount: 10000,
    usableDays: 30,
    isActive: true,
    purchasedMinutes: 600,
    purchasedDurationDays: null,
    seatType: SeatType.FREE,
  };

  beforeEach(() => {
    repository = {
      createProduct: jest.fn(),
      getProduct: jest.fn(),
      findProductForUpdate: jest.fn().mockResolvedValue(timeProduct),
      updateProductWithHistories: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;
    service = new ProductService(repository);
  });

  describe('updateProduct', () => {
    it('상품 수정 시 바뀐 필드마다 같은 변경 묶음 ID로 이력을 만든다', async () => {
      await service.updateProduct(
        shopId,
        productId,
        { seatType: SeatType.FIXED, amount: 10000, name: '고정석 시간권' },
        userId,
      );

      expect(repository.updateProductWithHistories).toHaveBeenCalledTimes(1);
      const [calledId, data, histories] =
        repository.updateProductWithHistories.mock.calls[0];
      expect(calledId).toBe(productId);
      expect(data).toEqual({
        seatType: SeatType.FIXED,
        amount: 10000,
        name: '고정석 시간권',
      });
      // 기존 값과 같은 amount는 이력에서 빠진다
      expect(histories.map((h) => h.changedField).sort()).toEqual([
        'name',
        'seatType',
      ]);
      expect(histories).toContainEqual(
        expect.objectContaining({
          changedField: 'seatType',
          oldValue: 'FREE',
          newValue: 'FIXED',
          changedBy: userId,
        }),
      );
      expect(new Set(histories.map((h) => h.changeGroupId)).size).toBe(1);
    });

    it('시간권 상품에 이용 기간(purchasedDurationDays)을 보내면 ProductFieldMismatchError다', async () => {
      await expect(
        service.updateProduct(
          shopId,
          productId,
          { purchasedDurationDays: 30 },
          userId,
        ),
      ).rejects.toBeInstanceOf(ProductFieldMismatchError);
      expect(repository.updateProductWithHistories).not.toHaveBeenCalled();
    });

    it('기간권 상품에 이용 시간(purchasedMinutes)을 보내면 ProductFieldMismatchError다', async () => {
      repository.findProductForUpdate.mockResolvedValue({
        ...timeProduct,
        ticketType: TicketType.PERIOD,
        purchasedMinutes: null,
        purchasedDurationDays: 30,
      });

      await expect(
        service.updateProduct(
          shopId,
          productId,
          { purchasedMinutes: 600 },
          userId,
        ),
      ).rejects.toBeInstanceOf(ProductFieldMismatchError);
      expect(repository.updateProductWithHistories).not.toHaveBeenCalled();
    });

    it('삭제됐거나 다른 매장 상품이면 ProductNotFoundError다', async () => {
      repository.findProductForUpdate.mockResolvedValue(null);

      await expect(
        service.updateProduct(shopId, productId, { amount: 9000 }, userId),
      ).rejects.toBeInstanceOf(ProductNotFoundError);
    });
  });
});
