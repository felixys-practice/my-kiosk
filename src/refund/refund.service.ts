import { Injectable } from '@nestjs/common';
import {
  PaymentCancelFailureCode,
  PaymentCancelStatus as PrismaPaymentCancelStatus,
  RefundLock,
  TicketStatus,
  TicketType,
} from '@prisma/client';
import { RefundRepository } from './refund.repository';
import {
  PaymentCancelStatus,
  paymentCancelStatusMap,
  RefundResult,
} from './refund.types';
import {
  DomainConflictError,
  DomainForbiddenError,
  DomainNotFoundError,
} from 'src/common/errors';
import { TransactionLoggerService } from '../logger/transaction-logger.service';
import { PgService } from 'src/pg/pg.service';
import { PgCancelInquiryResult } from 'src/pg/pg.types';
import { assertNever, UnhandledCaseError } from '@felix_ys/ts-utils';

// 만료된 락을 PG 조회하는 동안 선점(연장)해두는 시간 - 조회 타임아웃 예상치보다 여유 있게 설정
const pgInquiryLockTtlMs = 30 * 1000;

// refund() 공통 검증을 통과한 뒤 processAutoRefund/processPendingApproval에 넘기는 티켓 스냅샷
type RefundTicketSnapshot = NonNullable<
  Awaited<ReturnType<RefundRepository['getTicketById']>>
>;

/**
 * `RefundLock`: "지금 이 상품(orderItem)에 대해 누군가 환불을 진행 중이다"라는 깃발
 * - 깃발이 없으면 → 아무도 진행 중이지 않으니 새로 시작
 * - 깃발이 꽂혀 있고 아직 유효하면 → 다른 사람이 진행 중이니 끼어들지 않고 409로 거부
 * - 깃발이 꽂혀 있는데 유효기간(1분)이 지났으면 → "누군가 깃발을 꽂아놓고 결과를 못 들은 채 사라진" 미제 상태. 이때 곧장 깃발을 뽑아버리면 위험하니, 먼저 "내가 조사 중"이라고 깃발을 다시 세워두고(연장/선점) PG에 진실을 물어본 뒤에야 정리한다
 */
@Injectable()
export class RefundService {
  constructor(
    private readonly refundRepository: RefundRepository,
    private readonly transactionLoggerService: TransactionLoggerService,
    private readonly pgService: PgService,
  ) {}

  /**
   * - 환불은 상품(orderItem) 단위로 이루어진다
   * - 하나의 상품은 환불 1회로 종료된다(이미 REVOKED/환불 완료된 티켓은 재환불 불가)
   * - 동일한 상품에 대해서 동시에 환불이 진행되지 않는다
   * - 사용 이력이 없는 건(미사용)만 자동으로 락 획득/PG 요청까지 처리한다
   *   (processAutoRefund). 금액은 고객이 지정하지 않고 서버가 원가 전액으로 계산한다
   * - 사용 이력이 있는 건은 점주 승인이 필요하므로, 승인 대기 상태의 PaymentCancel만
   *   만들고 락 없이 종료한다(processPendingApproval, 승인/거절 처리는 별도 책임)
   * - 환불 요청의 상태 확정은 PG의 응답(callback, inquiryPaymentCancel)에 대해서만 확정 짓는다
   * - 락이 존재하는 상품은 그 환불 요청이 확정되지 않으면 다음 환불 요청 진행이 불가하다
   * - 락이 만료됐지만 확정되지 않은 요청은, 다음 환불 요청이 PG에 재조회해 스스로 확정 짓는다
   * @param userId
   * @param ticketId
   * @param idempotencyKey
   * @returns
   */
  async refund(
    userId: string,
    ticketId: string,
    idempotencyKey?: string,
  ): Promise<RefundResult> {
    // 공통 검증
    const ticket = await this.refundRepository.getTicketById(ticketId);

    if (!ticket) {
      throw new DomainNotFoundError('티켓이 존재하지 않습니다');
    }
    if (!ticket.userId || userId !== ticket.userId) {
      throw new DomainForbiddenError('자신의 티켓만 환불 가능합니다');
    }
    // 하나의 상품은 환불 1회로 종료되므로, 이미 환불 처리된 티켓은 락 획득 전에
    // 저렴하게 즉시 거부한다(createRefundWithLock의 already_refunded 검증과 이중 방어).
    if (ticket.status === TicketStatus.REVOKED) {
      throw new DomainConflictError('이미 환불 처리된 티켓입니다');
    }
    if (!ticket.orderItem?.id) {
      throw new DomainNotFoundError('주문 정보가 존재하지 않습니다');
    }
    const [payment] = ticket.orderItem.order.payments;
    if (!payment || !payment.id) {
      throw new DomainNotFoundError('결재 정보가 존재하지 않습니다');
    }

    // 사용 이력 분기 - 재량이 필요 없는 미사용 건만 자동 처리한다.
    if (!isUnusedTicket(ticket)) {
      return this.processPendingApproval(ticket, payment, idempotencyKey);
    }
    return this.processAutoRefund(ticket, payment, userId, idempotencyKey);
  }

  /**
   * 시스템이 이용권을 자동으로 환불한다(결제 승인 후 좌석을 줄 수 없을 때, research R12-A)
   * - 이용자 요청이 아니므로 소유자 검사를 하지 않는다
   * - 미사용 자동 환불 경로(락 획득 → PG 취소 요청)를 그대로 탄다
   * @param ticketId 이용권 ID
   * @param reason 자동 취소 사유
   * @returns 없음
   * @throws DomainNotFoundError 이용권이 없을 때
   * @throws DomainConflictError 이미 환불됐거나 사용 이력이 있는 이용권일 때
   */
  async refundBySystem(ticketId: string, reason: string): Promise<void> {
    // 이용권과 결제 정보 조회(기존 refund와 같은 순서로 검증한다)
    const ticket = await this.refundRepository.getTicketById(ticketId);
    if (!ticket) {
      throw new DomainNotFoundError('티켓이 존재하지 않습니다');
    }
    if (ticket.status === TicketStatus.REVOKED) {
      throw new DomainConflictError('이미 환불 처리된 티켓입니다');
    }
    const [payment] = ticket.orderItem.order.payments;

    // 사용 이력이 있으면 점주 재량이 필요하므로 시스템이 자동 취소하지 않는다
    if (!isUnusedTicket(ticket)) {
      throw new DomainConflictError(
        '시스템 자동 취소는 미사용 이용권만 가능합니다',
      );
    }

    // 결제한 이용자 기준으로 미사용 자동 환불을 진행한다
    await this.processAutoRefund(
      ticket,
      payment,
      ticket.userId,
      undefined,
      reason,
    );
  }

  // 사용 이력이 있는 건 - 점주 승인 없이는 금액/락을 확정할 수 없으므로
  // 승인 대기 상태의 PaymentCancel만 만들고 멈춘다.
  private async processPendingApproval(
    ticket: RefundTicketSnapshot,
    payment: { id: string },
    idempotencyKey?: string,
  ): Promise<RefundResult> {
    const pending =
      await this.refundRepository.createPendingApprovalPaymentCancel(
        payment.id,
        ticket.orderItem.id,
        new Date(),
        idempotencyKey,
      );
    return { status: 'PENDING_APPROVAL', paymentCancelId: pending.id };
  }

  // 미사용 건 - 재량이 필요 없으므로 이 요청 안에서 락 획득부터 PG 요청까지 처리한다.
  private async processAutoRefund(
    ticket: RefundTicketSnapshot,
    payment: { id: string },
    userId: string,
    idempotencyKey?: string,
    reason?: string,
  ): Promise<RefundResult> {
    // 2️⃣ 낡은 락(만료됐는데 아무도 후속 처리를 안 해서 방치된 락)이 있으면 정리한다.
    const staleLock = await this.acquireStaleLock(ticket.orderItem.id);
    if (staleLock) {
      // 낡은 깃발(만료된 락)을 PG에 진실을 물어 정리한다. 정리와 별개로,
      // "이번 요청이 그 낡은 시도를 만들었던 바로 그 요청인지"는 idempotencyKey로 판단한다.
      const settlement = await this.clearStaleLock(
        ticket.orderItem.order.id,
        ticket.orderItem.id,
        userId,
        staleLock,
      );
      // 이번 요청과 같은 시도였다면(키 일치), PG가 낸 결론을 그대로 이번 요청의
      // 결론으로 재현한다 - 성공/실패 어느 쪽이든 새로 만들지 않고 여기서 끝난다.
      if (settlement.idempotencyKey === idempotencyKey) {
        if (!settlement.succeeded) {
          throw new DomainConflictError(
            '환불 요청이 실패로 처리되었습니다. 사유: ' +
              (settlement.failureReason ?? '알 수 없음'),
          );
        }
        return { status: 'PROCESSED' };
      }
      // 키가 다르면(또는 둘 중 하나라도 없으면) 별개의 새 요청이다 - 낡은 시도의
      // 성공/실패 여부와 무관하게 이번 요청은 계속 진행한다(아래 검증을 다시 통과해야 함).
    }

    // 3️⃣ 환불 객체 + 락 생성 (금액은 서버가 원가 전액으로 계산 - 클라이언트 입력 없음)
    const paymentCancel = await this.createRefundWithLock(
      ticket.orderItem.id,
      payment.id,
      idempotencyKey,
      reason,
    );

    // 4️⃣ PG 요청 시도(+실패로깅) - 응답은 완료 콜백 함수에서 처리
    try {
      await this.pgService.requestPaymentCancel(
        paymentCancel.id,
        ticket.orderItem.order.id,
        ticket.orderItem.id,
        userId,
        paymentCancel.amount,
      );
    } catch (error) {
      // PG 응답 자체를 못 받은 경우(타임아웃/네트워크 에러 등) - PG가 실제로는
      // 처리했을 수 있으므로 FAILED로 확정하지 않는다. REQUESTED 상태와 락을
      // 그대로 두어, 뒤늦은 콜백이 오면 반영되거나 TTL 만료 후 재시도되게 한다.
      const message =
        error instanceof Error ? error.message : 'PG 취소 요청 중 에러 발생';
      this.transactionLoggerService.logRefund(
        paymentCancel.id,
        ticket.orderItem.order.id,
        ticket.orderItem.id,
        userId,
        paymentCancel.amount,
        `PG 취소 요청 응답 실패(PaymentCancel: ${paymentCancel.id}): ${message}`,
      );
    }

    return { status: 'PROCESSED' };
  }

  // 환불 가능 금액을 계산하고 새 깃발(락)과 함께 환불을 생성한다.
  // 미사용 자동 처리 경로 전용 - 금액은 클라이언트 입력 없이 원가 전액으로 서버가 계산한다.
  private async createRefundWithLock(
    orderItemId: string,
    paymentId: string,
    idempotencyKey?: string,
    reason?: string,
  ) {
    // 환불 가능 금액 계산 -> 환불 진행 락(트랜잭션으로)
    const { paymentCancel } = await this.refundRepository.runInTransaction(
      async (tx) => {
        // 방어적 재확인 - 1부 정리 이후에도 유효한 락이 남아있으면 다른 요청과 경합 중인 것
        // (1부가 정상적으로 락을 비웠다면 이 조건은 통과해야 정상이다)
        const lockCheck = await this.refundRepository.getRefundLock(
          orderItemId,
          tx,
        );
        if (lockCheck && lockCheck.expiresAt > new Date()) {
          throw new DomainConflictError('환불 진행 중인 상품입니다');
        }

        // 환불 가능 금액 계산 - 하나의 상품은 환불 1회로 종료되므로, 이미 SUCCEEDED된
        // 이력이 있으면(already_refunded) 원가와 무관하게 재환불 자체가 불가하다.
        // refund()의 REVOKED 검증과 이중 방어 - 그 사이 레이스로 상태가 바뀌었거나
        // (극히 드묾) 아직 Ticket 갱신 전의 과거 데이터를 대비한 안전장치.
        const refund = await this.refundRepository.calculateRefundableAmount(
          orderItemId,
          tx,
        );
        if (refund.already_refunded) {
          throw new DomainConflictError('이미 환불 처리된 상품입니다');
        }
        const finalRefundAmount = refund.refund_amount;

        const paymentCancel = await this.refundRepository.createPaymentCancel(
          finalRefundAmount,
          paymentId,
          orderItemId,
          new Date(),
          idempotencyKey,
          tx,
          reason,
        );

        await this.refundRepository.createRefundLock(
          orderItemId,
          paymentCancel.id,
          new Date(Date.now() + 1 * 60 * 1000),
          tx,
        );

        return {
          paymentCancel,
        };
      },
    );

    return paymentCancel;
  }

  // 이 상품(orderItem)에 낡은 깃발(만료된 락)이 있는지 찾아서, 있다면 먼저 선점(연장)해둔다.
  // - 깃발이 아예 없다 → null (정리할 것 없음)
  // - 깃발이 아직 유효하다 → 예외로 즉시 거부(다른 요청이 진행 중)
  // - 깃발이 있고 만료됐다 → 결과를 못 들은 미제 상태("staleLock"). 곧장 뽑아버리면
  //   위험하니, 먼저 "내가 조사 중"이라고 다시 세워두고(선점/연장) 반환한다.
  //   PG 조회를 진행하는 동안 다른 요청이 같은 만료 락을 보고 중복으로
  //   조회를 시작하지 못하도록 막기 위함이다.
  private async acquireStaleLock(orderItemId: string) {
    return this.refundRepository.runInTransaction(async (tx) => {
      const refundLock = await this.refundRepository.getRefundLock(
        orderItemId,
        tx,
      );
      // 깃발이 아예 없다 - 아무도 진행 중이지 않으니 정리할 것도 없다.
      if (!refundLock) return null;
      if (refundLock.expiresAt > new Date()) {
        throw new DomainConflictError('환불 진행 중인 상품입니다');
      }

      const extendedCount = await this.refundRepository.extendRefundLock(
        orderItemId,
        refundLock.paymentCancelId,
        new Date(Date.now() + pgInquiryLockTtlMs),
        tx,
      );
      // 연장된 행이 없으면 그 사이 다른 트랜잭션이 이미 선점했거나 처리(삭제)한 것 - 물러난다.
      if (extendedCount === 0) {
        throw new DomainConflictError('환불 진행 중인 상품입니다');
      }

      return refundLock;
    });
  }

  /**
   * acquireStaleLock으로 선점한 만료 락을 PG에 조회해 확정 처리하고 락을 삭제한다.
   * 확정 결과(성공/실패)와 원래 요청의 idempotencyKey를 반환하며,
   * 호출부가 해당 결과를 현재 요청의 응답으로 재현할지 여부를 판단한다.
   * @param orderId PG 거래조회에 사용할 주문 ID
   * @param orderItemId 락 조회·삭제 및 티켓 무효화에 사용할 주문 상품 ID
   * @param userId PG 거래조회에 사용할 사용자 ID
   * @param staleLock acquireStaleLock으로 선점해둔 만료 RefundLock
   * @returns idempotencyKey(원 요청 키), succeeded(환불 성공 여부), failureReason(실패 사유)
   * @throws DomainConflictError PG 조회 실패 / 락이 이미 다른 요청에 의해 정리된 경우 / 새 환불이 진행 중인 경우
   */
  private async clearStaleLock(
    orderId: string,
    orderItemId: string,
    userId: string,
    staleLock: RefundLock,
  ): Promise<{
    idempotencyKey: string | null;
    succeeded: boolean;
    failureReason: string | null;
  }> {
    // 깃발을 선점했으니, 이제 PG에 진실을 물어봐서 미제 사건을 매듭짓는다.
    // PG 조회는 외부 I/O이므로 DB 트랜잭션 밖에서 수행한다.
    let inquiryResult: PgCancelInquiryResult;
    try {
      // 📤 PG 사에 환불 요청 상태 확인
      const inquiry = await this.pgService.inquiryPaymentCancel(
        orderId,
        orderItemId,
        userId,
        staleLock.paymentCancelId,
      );
      inquiryResult = inquiry.result;
    } catch (error) {
      // 조회 자체가 실패한 경우("진짜 모름") - 아무것도 확정하지 않고 재시도 자체를 거부한다.
      // 선점한 락이 그대로 남는다. ->
      const message =
        error instanceof Error ? error.message : 'PG 거래조회 중 에러 발생';
      // 로깅용 amount는 더 이상 클라이언트로부터 받지 않으므로 기존 PaymentCancel에서 조회한다.
      const existing = await this.refundRepository.getPaymentCancelById(
        staleLock.paymentCancelId,
      );
      this.transactionLoggerService.logRefund(
        staleLock.paymentCancelId,
        orderId,
        orderItemId,
        userId,
        existing.amount,
        `PG 거래조회 실패로 재시도 거부(PaymentCancel: ${staleLock.paymentCancelId}): ${message}`,
      );
      throw new DomainConflictError(
        '환불 처리 중입니다. 잠시 후 다시 시도해주세요',
      );
    }

    // ☝️ 여기서는 PG사 환불 상태 조회에 성공한거잖아

    // 2차 트랜잭션: 락 재검증 + 콜백 선착 여부 확인 + 확정 처리
    const settlement = await this.refundRepository.runInTransaction(
      async (tx) => {
        const currentLock = await this.refundRepository.getRefundLock(
          orderItemId,
          tx,
        );
        // 내가 1차 트랜잭션에서 선점(연장)해둔 깃발이 그 사이 걷혔다 - 다른 요청이
        // 이미 이 미제 사건을 매듭짓고 정리까지 끝냈다는 뜻("진행 중"이 아니라 "이미 종료됨")
        if (!currentLock) {
          throw new DomainConflictError('이미 다른 요청에 의해 처리되었습니다');
        }
        // 그 사이 다른 요청이 처리를 끝내고 완전히 새로운 환불(새 깃발)을 시작한 것. 이건 실제로 "진행 중"
        // (연장으로 인해 만료 시각은 항상 미래이므로 만료 여부 비교는 더 이상 의미가 없다.)
        if (currentLock.paymentCancelId !== staleLock.paymentCancelId) {
          throw new DomainConflictError('환불 진행 중인 상품입니다');
        }

        // PG 조회 중(상태 확인) 뒤늦은 콜백이 먼저 도착해 이미 확정됐을 수 있다(락은 아직 제거하지 않음, ✌️ 부분을 진행 중일때) -
        // 실측된 콜백 결과가 PG 재조회보다 신뢰도가 높으므로 그 결과를 그대로 존중한다.
        const paymentCancel = await this.refundRepository.getPaymentCancelById(
          staleLock.paymentCancelId,
          tx,
        );
        if (paymentCancel.status !== PrismaPaymentCancelStatus.REQUESTED) {
          await this.refundRepository.deleteRefundLock(
            orderItemId,
            staleLock.paymentCancelId,
            tx,
          );
          return {
            idempotencyKey: paymentCancel.idempotencyKey,
            succeeded:
              paymentCancel.status === PrismaPaymentCancelStatus.SUCCEEDED,
            failureReason: paymentCancel.failureReason,
          };
        }

        // paymentCancel의 상태가 아직 REQUESTED(callback 응답을 받기전)
        // - PG 상태 조회 결과로 업데이트
        if (inquiryResult === PgCancelInquiryResult.SUCCEEDED) {
          await this.refundRepository.confirmRefundSuccess(
            staleLock.paymentCancelId,
            orderItemId,
            new Date(),
            tx,
          );
          await this.refundRepository.deleteRefundLock(
            orderItemId,
            staleLock.paymentCancelId,
            tx,
          );
          return {
            idempotencyKey: paymentCancel.idempotencyKey,
            succeeded: true,
            failureReason: null,
          };
        }

        if (inquiryResult === PgCancelInquiryResult.FAILED) {
          const failureReason = 'PG가 취소를 실패 처리함';
          await this.refundRepository.failPaymentCancel(
            staleLock.paymentCancelId,
            failureReason,
            undefined,
            new Date(),
            tx,
          );
          await this.refundRepository.deleteRefundLock(
            orderItemId,
            staleLock.paymentCancelId,
            tx,
          );
          return {
            idempotencyKey: paymentCancel.idempotencyKey,
            succeeded: false,
            failureReason,
          };
        }

        if (inquiryResult === PgCancelInquiryResult.IN_PROGRESS) {
          // PG가 요청을 접수했고 아직 처리 중 - 확정할 수 없다. 낡은 락이 아니라
          // "정상적으로 진행 중"임이 확인되었으므로, 짧은 조회용 TTL 대신 원래의
          // 락 만료 정책(1분)에 준하는 시간으로 재연장해 불필요한 재조회를 막는다.
          await this.refundRepository.extendRefundLock(
            orderItemId,
            staleLock.paymentCancelId,
            new Date(Date.now() + 1 * 60 * 1000),
            tx,
          );
          throw new DomainConflictError('환불 진행 중인 상품입니다');
        }

        if (inquiryResult === PgCancelInquiryResult.NOT_FOUND) {
          // 요청이 PG에 도달하지 않은 것으로 판단하고 안전하게 재시도를 허용한다.
          const failureReason = 'PG 미도달(거래 없음)';
          await this.refundRepository.failPaymentCancel(
            staleLock.paymentCancelId,
            failureReason,
            PaymentCancelFailureCode.PG_NOT_REACHED,
            new Date(),
            tx,
          );
          await this.refundRepository.deleteRefundLock(
            orderItemId,
            staleLock.paymentCancelId,
            tx,
          );
          return {
            idempotencyKey: paymentCancel.idempotencyKey,
            succeeded: false,
            failureReason,
          };
        }

        // 정의되지 않은 조회 결과 - 안전한 확정 방법을 알 수 없으므로 락은
        // 그대로 두고(삭제/연장 없이) 예외로 즉시 드러낸다. enum에 새 값이
        // 추가되었는데 분기 처리를 빠뜨린 경우를 컴파일 타임에 감지하기 위한 장치.
        // 도메인 에러로 감싸지 않고 그대로 재던져 500으로 노출한다 - 이건
        // "진행 중" 같은 정상적인 충돌 상황이 아니라 시스템이 처리할 줄 모르는
        // 예상 밖의 상태이므로, 사용자에게 잘못된 신호(409 등)를 주면 안 된다.
        try {
          return assertNever(inquiryResult, 'clearStaleLock/inquiryResult');
        } catch (error) {
          const detail =
            error instanceof UnhandledCaseError
              ? `label=${error.label}, value=${JSON.stringify(error.value)}`
              : error instanceof Error
                ? error.message
                : String(error);
          this.transactionLoggerService.logRefund(
            staleLock.paymentCancelId,
            orderId,
            orderItemId,
            userId,
            paymentCancel.amount,
            `PG 거래조회 결과 처리 불가(미정의 상태값): ${detail}`,
          );
          throw error;
        }
      },
    );
    return settlement;
  }

  // 상태 확정(succeedPaymentCancel/failPaymentCancel)과 락 삭제(deleteRefundLock)를
  // 하나의 트랜잭션으로 묶지 않는다 - 의도적인 선택이다.
  // - 묶었을 때의 문제: 락 삭제가 실패하면(DB 커넥션 순간 끊김 등) 상태 확정까지
  //   함께 롤백된다. 그러면 PG는 이미 처리를 끝냈는데 우리 시스템만 REQUESTED로
  //   남아, 상태 확정이 "누군가 같은 상품에 대해 다시 refund()를 호출해줘야만"
  //   뒤늦게 반영되는 트리거 의존적 지연이 생긴다. 재요청이 없으면 기약 없이
  //   방치될 수 있고, 그 사이 사용자에게는 실제(PG 기준 완료)와 다른 상태(REQUESTED)가
  //   노출된다.
  // - 그래서 분리한다: 상태 확정(되돌릴 수 없는 진실)을 먼저 확실히 반영하고,
  //   락 삭제(실패해도 회복 가능한 부산물)는 그 뒤에 별도로 시도한다.
  // - 분리로 인해 생기는 대가: 상태 확정 직후, 락 삭제(바로 아래 deleteRefundLock)
  //   직전 사이에 짧은 간극이 생긴다. 이 간극에 clearStaleLock의 재조회가 끼어들면
  //   "락은 아직 있는데 상태는 이미 확정됨"인 경우를 만날 수 있다. 이건
  //   clearStaleLock 쪽에서 PG 재조회 결과보다 이미 확정된 상태를 우선 신뢰하는
  //   방식으로 흡수한다(refund.service.ts의 clearStaleLock, PrismaPaymentCancelStatus
  //   !== REQUESTED 분기 참고).
  async callback(
    success: boolean,
    paymentCancelId: string,
    orderItemId: string,
    refundedAmount: number,
    reason?: string | null,
  ) {
    const paymentCancel =
      await this.refundRepository.getPaymentCancelById(paymentCancelId);

    // 이 환불 건 자체가 이미 확정됐다면(성공/실패) 재처리하지 않는다.
    if (
      paymentCancel.status === 'SUCCEEDED' ||
      paymentCancel.status === 'FAILED'
    ) {
      return;
    }

    if (success) {
      // 금액 비교 - PG가 실패로 응답한 경우 금액 비교는 의미가 없으므로 성공 시에만 검사한다
      if (refundedAmount === paymentCancel.amount) {
        await this.refundRepository.runInTransaction((tx) =>
          this.refundRepository.confirmRefundSuccess(
            paymentCancelId,
            orderItemId,
            new Date(),
            tx,
          ),
        );
      } else {
        // 잘못된 환불 금액에 대한 처리 - 그대로 성공 처리하지 않고 실패로 확정한다
        // 🔥 관리자가 확인: 상황 자체가 **정상 흐름이 아니라 이상 상황(PG 연동 버그, PG 측 처리 오류)**이기 때문
        await this.refundRepository.failPaymentCancel(
          paymentCancelId,
          `PG 응답 금액 불일치: 요청 ${paymentCancel.amount}, PG 응답 ${refundedAmount}`,
          PaymentCancelFailureCode.AMOUNT_MISMATCH,
        );
        // TODO: 불일치 관리자에게 알림 로직 추가 필요
      }
    } else {
      await this.refundRepository.failPaymentCancel(
        paymentCancelId,
        reason ?? 'PG 응답 실패',
      );
    }
    // ✌️
    // deleteRefundLock 자체가 where 절에 paymentCancelId(소유권)를 포함하므로,
    // 이 콜백이 처리되는 사이 사용자의 새 환불 요청이 clearStaleLock을 거쳐
    // 이미 이 orderItem의 락을 다른 paymentCancelId(새 PaymentCancel)로
    // 점유했다면 조건에 맞는 행이 없어 조용히 무시된다(다른 시도의 락을 건드리지 않음).
    await this.refundRepository.deleteRefundLock(orderItemId, paymentCancelId);
  }

  async getRefundHistoryByShop(shopId: string, status?: PaymentCancelStatus) {
    // 컨트롤러 경계의 도메인 enum을 Prisma enum으로 매핑해 repository에 전달
    return await this.refundRepository.getRefundHistoryByShop(
      shopId,
      status ? paymentCancelStatusMap[status] : undefined,
    );
  }

  async getRefundHistoryByUser(userId: string, status?: PaymentCancelStatus) {
    return await this.refundRepository.getRefundHistoryByUser(
      userId,
      status ? paymentCancelStatusMap[status] : undefined,
    );
  }
}

type UsageTicketSnapshot = Pick<
  RefundTicketSnapshot,
  'type' | 'activatedAt' | 'remainingMinutes' | 'purchasedMinutes'
> & {
  usageSessions: unknown[];
};

// 사용 이력이 없으면 true(자동 처리 대상), 있으면 false(승인 대기 대상).
// ACTIVE 세션이 있으면 remainingMinutes가 아직 차감 전(사후 정산 방식 - UsageSession
// 종료 시점에야 Ticket.remainingMinutes에 반영됨)이라도 무조건 사용 이력 있음으로 본다.
function isUnusedTicket(ticket: UsageTicketSnapshot): boolean {
  if (ticket.usageSessions.length > 0) return false;

  switch (ticket.type) {
    case TicketType.PERIOD:
      return ticket.activatedAt === null;
    case TicketType.TIME:
      // 필드 이상(둘 다 null 등)은 보수적으로 "사용 이력 있음"으로 처리해 승인 대기로 보낸다
      return (
        ticket.remainingMinutes !== null &&
        ticket.purchasedMinutes !== null &&
        ticket.remainingMinutes === ticket.purchasedMinutes
      );
    default:
      return assertNever(ticket.type, 'refund.service/isUnusedTicket');
  }
}
