import { UserRole } from '@prisma/client';
import { RefundStoreService } from './refund-store.service';
import { RefundForbiddenError } from './errors';

describe('RefundStoreService', () => {
  const shopId = 'shop-1';
  const ticketId = 'ticket-1';
  let service: RefundStoreService;

  beforeEach(() => {
    service = new RefundStoreService();
  });

  it('MANAGER가 새 매장 환불을 요청하면 REFUND_FORBIDDEN으로 거절된다', async () => {
    await expect(
      service.acceptStoreRefund(
        { userId: 'manager-1', role: UserRole.MANAGER },
        shopId,
        {
          ticketId,
          amount: 5000,
          reason: '보상',
          consentToTerminateTicket: true,
        },
      ),
    ).rejects.toBeInstanceOf(RefundForbiddenError);
  });
});
