import { UserRole } from '@prisma/client';
import {
  RefundStoreService,
  storeRejectionError,
} from './refund-store.service';
import {
  DomainBadRequestError,
  DomainConflictError,
  DomainNotFoundError,
} from 'src/common/errors';
import { RefundAcceptanceService } from './refund-acceptance.service';
import { RefundAccessService } from './refund-access.service';
import { SessionLifecycleService } from 'src/session-lifecycle/session-lifecycle.service';
import { SessionEndJobQueue } from 'src/session-lifecycle/session-end-job.queue';
import { RefundAcceptanceExecutionService } from './refund-acceptance-execution.service';
import { RefundForbiddenError } from './errors';

describe('RefundStoreService', () => {
  const shopId = 'shop-1';
  const ticketId = 'ticket-1';
  let service: RefundStoreService;

  beforeEach(() => {
    // 역할 확인은 저장·판정 전에 끝나므로 협력 객체는 빈 대역으로 둔다
    service = new RefundStoreService(
      {} as RefundAccessService,
      {} as RefundAcceptanceService,
      {} as RefundAcceptanceExecutionService,
      {} as SessionLifecycleService,
      {} as SessionEndJobQueue,
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

  describe('판정 거절은 계약 오류로 바뀐다', () => {
    it.each([
      ['REFUND_AMOUNT_EXCEEDED', DomainBadRequestError],
      ['UNUSED_TICKET_FULL_REFUND_REQUIRED', DomainBadRequestError],
      ['REFUND_REASON_REQUIRED', DomainBadRequestError],
      ['PAYMENT_NOT_COMPLETED', DomainConflictError],
      ['ALREADY_REFUNDED', DomainConflictError],
      ['REFUND_IN_PROGRESS', DomainConflictError],
      ['TICKET_NOT_FOUND', DomainNotFoundError],
    ])('%s는 그 code의 %p 오류다', (code, errorBase) => {
      const error = storeRejectionError(code);

      expect(error).toBeInstanceOf(errorBase);
      expect(error).toMatchObject({ code });
    });
  });
});
