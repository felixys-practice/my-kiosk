import { RefundAcceptanceExecutionService } from './refund-acceptance-execution.service';
import { RefundIdempotencyRepository } from './refund-idempotency.repository';
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
import { RefundDispatchService } from './refund-dispatch.service';
import {
  RefundForbiddenError,
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
  /** 전송 결과 반영 대역(전송 결과를 저장하고 지급 처리 중 상태를 돌려준다) */
  const dispatchService = {
    newSendClaim: () => ({
      claimToken: 'claim-1',
      claimUntil: new Date('2026-10-28T12:00:30Z'),
    }),
    recordSendResult: jest.fn().mockResolvedValue({
      payoutStatus: RefundPayoutStatus.PENDING,
      actionCode: null,
    }),
  } as unknown as RefundDispatchService;
  /** 커밋·PG 호출 순서 기록 */
  let events: string[];

  /**
   * 환불 가능한 고객 이용권(본인·결제 완료·미사용·기한 안 정기권)을 만든다
   * @returns 판정 후보와 잠글 행
   */
  function eligibleTarget(): CustomerRefundTarget {
    return {
      paymentId: 'payment-1',
      orderItemId: 'order-item-1',
      orderId: 'order-1',
      shopId: 'shop-1',
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
    // 멱등 처리 대역: 처리를 트랜잭션 안에서 실행하고, 끝나면 커밋으로 기록한다
    events = [];
    pgGateway.sendCancel.mockImplementation(() => {
      events.push('pg-send');
      return Promise.resolve({ result: 'ACCEPTED' });
    });
    const execution = new RefundAcceptanceExecutionService(
      {
        acquire: () => Promise.resolve({ kind: 'without-key' }),
      } as unknown as RefundIdempotencyService,
      {
        runInTransaction: async (
          handler: (t: TransactionClient) => Promise<unknown>,
        ) => {
          const result = await handler(tx);
          events.push('commit');
          return result;
        },
      } as unknown as RefundIdempotencyRepository,
      repository as unknown as RefundRepository,
      pgGateway,
      dispatchService,
    );
    service = new RefundAcceptanceService(
      repository as unknown as RefundRepository,
      locking as unknown as RefundLockingRepository,
      seatAssignment as unknown as SeatAssignmentService,
      execution,
      dispatchService,
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

  it('PG 전송은 확정 트랜잭션이 커밋된 뒤에만 확정 금액으로 호출된다', async () => {
    await service.acceptCustomerRefund(customer, {
      ticketId,
      consentToTerminateTicket: true,
    });

    expect(events).toEqual(['commit', 'pg-send']);
    expect(pgGateway.sendCancel).toHaveBeenCalledWith({
      paymentCancelId: 'pc-1',
      amount: 10000,
    });
  });

  it('확정 트랜잭션 커밋이 실패하면 PG가 호출되지 않는다', async () => {
    const commitFailure = new RefundAcceptanceExecutionService(
      {
        acquire: () => Promise.resolve({ kind: 'without-key' }),
      } as unknown as RefundIdempotencyService,
      {
        runInTransaction: async (
          handler: (t: TransactionClient) => Promise<unknown>,
        ) => {
          await handler(tx);
          throw new Error('커밋 실패');
        },
      } as unknown as RefundIdempotencyRepository,
      repository as unknown as RefundRepository,
      pgGateway,
      dispatchService,
    );
    const failingService = new RefundAcceptanceService(
      repository as unknown as RefundRepository,
      locking as unknown as RefundLockingRepository,
      seatAssignment as unknown as SeatAssignmentService,
      commitFailure,
      dispatchService,
    );

    await expect(
      failingService.acceptCustomerRefund(customer, {
        ticketId,
        consentToTerminateTicket: true,
      }),
    ).rejects.toThrow('커밋 실패');
    expect(pgGateway.sendCancel).not.toHaveBeenCalled();
  });

  it('양수 금액 접수 응답은 202와 환불 식별자·이용 종료 완료·지급 처리 중 상태를 담는다', async () => {
    const result = await service.acceptCustomerRefund(customer, {
      ticketId,
      consentToTerminateTicket: true,
    });

    expect(result).toMatchObject({
      status: 202,
      body: {
        refundId: 'refund-1',
        decisionStatus: 'ACCEPTED',
        ticketId,
        amount: 10000,
        payoutStatus: 'PENDING',
        paymentCancelId: 'pc-1',
      },
    });
    expect(result.body.terminatedAt).toEqual(expect.any(String));
  });

  it.each([UserRole.OWNER, UserRole.MANAGER])(
    '고객 환불 신청을 %s 역할이 하면 아무것도 저장하지 않고 REFUND_FORBIDDEN으로 거절된다',
    async (role) => {
      await expect(
        service.acceptCustomerRefund(
          { userId: customer.userId, role },
          { ticketId, consentToTerminateTicket: true },
        ),
      ).rejects.toBeInstanceOf(RefundForbiddenError);
      expect(repository.createAcceptedRefund).not.toHaveBeenCalled();
      expect(pgGateway.sendCancel).not.toHaveBeenCalled();
    },
  );

  it('같은 멱등 키 재응답도 현재 역할이 USER가 아니면 REFUND_FORBIDDEN으로 거절된다', async () => {
    // 저장된 최초 응답을 재생하는 멱등 처리 대역(처리 함수는 실행하지 않는다)
    const replaying = {
      executeAcceptance: async (command: {
        authorize: () => Promise<void>;
      }) => {
        await command.authorize();
        return { status: 202, body: { refundId: 'refund-1' } };
      },
    } as unknown as RefundAcceptanceExecutionService;
    const replayService = new RefundAcceptanceService(
      repository as unknown as RefundRepository,
      locking as unknown as RefundLockingRepository,
      seatAssignment as unknown as SeatAssignmentService,
      replaying,
      dispatchService,
    );

    await expect(
      replayService.acceptCustomerRefund(
        { userId: customer.userId, role: UserRole.OWNER },
        { ticketId, consentToTerminateTicket: true, idempotencyKey: 'key-1' },
      ),
    ).rejects.toBeInstanceOf(RefundForbiddenError);
  });

  it('0원 고객 환불 응답은 200과 지급 완료(PAID)다', async () => {
    const zeroTarget = eligibleTarget();
    zeroTarget.candidate.paidAmount = 0;
    repository.findCustomerRefundTarget.mockResolvedValue(zeroTarget);
    repository.createAcceptedRefund.mockResolvedValue({
      refundId: 'refund-1',
      paymentCancelId: null,
    });

    const result = await service.acceptCustomerRefund(customer, {
      ticketId,
      consentToTerminateTicket: true,
    });

    expect(result).toMatchObject({
      status: 200,
      body: { amount: 0, payoutStatus: 'PAID', paymentCancelId: null },
    });
  });
});
