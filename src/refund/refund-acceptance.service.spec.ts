/* eslint-disable @typescript-eslint/unbound-method -- jest 목(mock) 메서드를 expect로 검증할 때 생기는 오탐 */
import {
  PaymentStatus,
  RefundDecisionStatus,
  RefundPayoutStatus,
  TicketType,
  UserRole,
} from '@prisma/client';
import { TransactionClient } from 'src/prisma/prisma.service';
import { RefundPgGateway } from 'src/pg/refund-pg.gateway';
import { SeatAssignmentService } from 'src/seat-assignment/seat-assignment.service';
import { RefundAcceptanceService } from './refund-acceptance.service';
import { CustomerRefundTarget, RefundRepository } from './refund.repository';
import { RefundLockingRepository } from './refund-locking.repository';
import { RefundIdempotencyService } from './refund-idempotency.service';
import {
  RefundNotEligibleError,
  RefundTerminationConsentRequiredError,
  TicketNotFoundError,
} from './errors';

describe('RefundAcceptanceService', () => {
  const customer = { userId: 'customer-1', role: UserRole.USER };
  const ticketId = 'ticket-1';
  const tx = {} as TransactionClient;

  let repository: jest.Mocked<
    Pick<
      RefundRepository,
      | 'findCustomerRefundTarget'
      | 'terminateTicket'
      | 'closeOpenPausesForRefund'
      | 'createAcceptedRefund'
    >
  >;
  let locking: jest.Mocked<Pick<RefundLockingRepository, 'lockForAcceptance'>>;
  let seatAssignment: jest.Mocked<
    Pick<SeatAssignmentService, 'releaseByTicket'>
  >;
  let pgGateway: jest.Mocked<RefundPgGateway>;
  let service: RefundAcceptanceService;

  /**
   * 환불 가능한 고객 이용권(본인·결제 완료·미사용·기한 안 정기권)을 만든다
   * @returns 판정 후보와 잠글 행
   */
  function eligibleTarget(): CustomerRefundTarget {
    return {
      paymentId: 'payment-1',
      orderItemId: 'order-item-1',
      lockTargets: {
        paymentId: 'payment-1',
        ticketId,
        ticketPauseIds: [],
        usageSessionIds: [],
        seatAssignmentIds: [],
      },
      candidate: {
        ownerId: customer.userId,
        paymentStatus: PaymentStatus.SUCCESS,
        paidAmount: 10000,
        existingRefunds: [],
        ticket: {
          type: TicketType.PERIOD,
          inUse: false,
          activatedAt: null,
          activationDeadline: new Date(Date.now() + 86_400_000),
          purchasedMinutes: null,
          remainingMinutes: null,
          minuteExpireDeadline: null,
        },
      },
    };
  }

  beforeEach(() => {
    repository = {
      findCustomerRefundTarget: jest.fn().mockResolvedValue(eligibleTarget()),
      terminateTicket: jest.fn().mockResolvedValue(undefined),
      closeOpenPausesForRefund: jest.fn().mockResolvedValue(undefined),
      createAcceptedRefund: jest
        .fn()
        .mockResolvedValue({ refundId: 'refund-1', paymentCancelId: 'pc-1' }),
    };
    locking = { lockForAcceptance: jest.fn().mockResolvedValue(undefined) };
    seatAssignment = { releaseByTicket: jest.fn().mockResolvedValue(null) };
    pgGateway = {
      sendCancel: jest.fn().mockResolvedValue({ result: 'ACCEPTED' }),
      inquireCancel: jest.fn(),
    };
    // 멱등 처리 대역: 키와 무관하게 처리를 트랜잭션 안에서 한 번 실행한다
    const idempotency = {
      execute: (
        _command: unknown,
        handler: (t: TransactionClient) => unknown,
      ) => handler(tx),
    } as unknown as RefundIdempotencyService;
    service = new RefundAcceptanceService(
      repository as unknown as RefundRepository,
      locking as unknown as RefundLockingRepository,
      seatAssignment as unknown as SeatAssignmentService,
      idempotency,
      pgGateway,
    );
  });

  it('환불 대상이어도 종료 동의가 false이면 REFUND_TERMINATION_CONSENT_REQUIRED로 거절되고 아무것도 저장하지 않는다', async () => {
    await expect(
      service.acceptCustomerRefund(customer, {
        ticketId,
        consentToTerminateTicket: false,
      }),
    ).rejects.toBeInstanceOf(RefundTerminationConsentRequiredError);
    expect(repository.terminateTicket).not.toHaveBeenCalled();
    expect(repository.createAcceptedRefund).not.toHaveBeenCalled();
    expect(pgGateway.sendCancel).not.toHaveBeenCalled();
  });

  it('종료 동의 필드가 없으면 REFUND_TERMINATION_CONSENT_REQUIRED로 거절된다', async () => {
    await expect(
      service.acceptCustomerRefund(customer, { ticketId }),
    ).rejects.toBeInstanceOf(RefundTerminationConsentRequiredError);
  });

  describe('판정 거절은 계약 코드의 오류로 거절되고 아무것도 저장하지 않는다', () => {
    it('다른 고객의 이용권은 TicketNotFoundError(TICKET_NOT_FOUND)다', async () => {
      const target = eligibleTarget();
      target.candidate.ownerId = 'other-customer';
      repository.findCustomerRefundTarget.mockResolvedValue(target);

      await expect(
        service.acceptCustomerRefund(customer, {
          ticketId,
          consentToTerminateTicket: true,
        }),
      ).rejects.toBeInstanceOf(TicketNotFoundError);
      expect(repository.createAcceptedRefund).not.toHaveBeenCalled();
    });

    it.each([
      [
        'PAYMENT_NOT_COMPLETED',
        (t: CustomerRefundTarget) => {
          t.candidate.paymentStatus = PaymentStatus.FAILED;
        },
      ],
      [
        'ALREADY_REFUNDED',
        (t: CustomerRefundTarget) => {
          t.candidate.existingRefunds = [
            {
              decisionStatus: RefundDecisionStatus.ACCEPTED,
              payoutStatus: RefundPayoutStatus.PAID,
            },
          ];
        },
      ],
      [
        'REFUND_IN_PROGRESS',
        (t: CustomerRefundTarget) => {
          t.candidate.existingRefunds = [
            {
              decisionStatus: RefundDecisionStatus.ACCEPTED,
              payoutStatus: RefundPayoutStatus.PENDING,
            },
          ];
        },
      ],
      [
        'USED_TICKET',
        (t: CustomerRefundTarget) => {
          t.candidate.ticket.inUse = true;
        },
      ],
      [
        'EXPIRED_TICKET',
        (t: CustomerRefundTarget) => {
          t.candidate.ticket.activationDeadline = new Date(Date.now() - 1000);
        },
      ],
    ])(
      '%s 판정은 그 코드의 RefundNotEligibleError(409)다',
      async (code, adjust) => {
        const target = eligibleTarget();
        adjust(target);
        repository.findCustomerRefundTarget.mockResolvedValue(target);

        const rejection = service.acceptCustomerRefund(customer, {
          ticketId,
          consentToTerminateTicket: true,
        });

        await expect(rejection).rejects.toBeInstanceOf(RefundNotEligibleError);
        await expect(rejection).rejects.toMatchObject({ code });
        expect(repository.createAcceptedRefund).not.toHaveBeenCalled();
      },
    );
  });
});
