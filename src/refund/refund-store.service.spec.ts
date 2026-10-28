import { UserRole } from '@prisma/client';
import { RefundStoreService } from './refund-store.service';
import { RefundAcceptanceService } from './refund-acceptance.service';
import { RefundIdempotencyService } from './refund-idempotency.service';
import { RefundForbiddenError } from './errors';

describe('RefundStoreService', () => {
  const shopId = 'shop-1';
  const ticketId = 'ticket-1';
  let service: RefundStoreService;

  beforeEach(() => {
    // 역할 확인은 저장·판정 전에 끝나므로 협력 객체는 빈 대역으로 둔다
    service = new RefundStoreService(
      {} as RefundAcceptanceService,
      {} as RefundIdempotencyService,
      { sendCancel: jest.fn(), inquireCancel: jest.fn() },
    );
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
