import { UserRole } from '@prisma/client';
import { RefundAccessService } from './refund-access.service';
import { RefundRepository } from './refund.repository';
import { RefundForbiddenError } from './errors';

describe('RefundAccessService', () => {
  const customer = { userId: 'user-1', role: UserRole.USER };

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
});
