import { UserRole } from '@prisma/client';
import { RefundAccessService } from './refund-access.service';
import { RefundRepository } from './refund.repository';
import { RefundForbiddenError, ShopNotFoundError } from './errors';

describe('RefundAccessService', () => {
  const customer = { userId: 'user-1', role: UserRole.USER };
  const owner = { userId: 'owner-1', role: UserRole.OWNER };
  const shopId = 'shop-1';

  let repository: jest.Mocked<Pick<RefundRepository, 'isCurrentShopOwner'>>;
  let service: RefundAccessService;

  beforeEach(() => {
    repository = { isCurrentShopOwner: jest.fn() };
    service = new RefundAccessService(
      repository as unknown as RefundRepository,
    );
  });

  it('고객 역할이 점주 전용 기능을 호출하면 REFUND_FORBIDDEN을 받는다', () => {
    expect(() => service.assertStoreOrOperator(customer)).toThrow(
      RefundForbiddenError,
    );
  });

  it('점주가 소유하지 않은 매장 범위를 조회하면 SHOP_NOT_FOUND(404)를 받는다', async () => {
    repository.isCurrentShopOwner.mockResolvedValue(false);

    await expect(service.assertShopScope(owner, shopId)).rejects.toBeInstanceOf(
      ShopNotFoundError,
    );
  });
});
