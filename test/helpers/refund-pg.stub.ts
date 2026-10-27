/**
 * 환불 E2E 전용 PG 대역
 * - 실제 PG 대신 송신·조회 결과를 테스트가 미리 정한다
 * - 호출된 PG 취소 요청 식별자(PaymentCancel.id)와 금액을 기록해 테스트가 확인할 수 있게 한다
 * - 응답 지연과 응답 전 중단(연결 끊김·프로세스 중단 흉내)을 제어한다
 * - 결과 타입은 운영 코드의 계약 §8 타입(src/pg/pg.types.ts)을 그대로 쓰고, RefundPgGateway를 구현한다
 */
import type {
  PgCancelQueryResult,
  PgCancelSendResult,
} from '../../src/pg/pg.types';
import type { RefundPgGateway } from '../../src/pg/refund-pg.gateway';

/** 대역이 받은 송신 호출 기록 */
export type PgCancelSendCall = {
  paymentCancelId: string; // PG 멱등 키로 쓰는 PG 취소 요청 식별자
  amount: number; // 취소 요청 금액
  calledAt: Date;
};

/** 대역이 받은 조회 호출 기록 */
export type PgCancelInquiryCall = {
  paymentCancelId: string;
  calledAt: Date;
};

/** 대역이 응답 전에 중단됐음을 알리는 오류. 운영 코드에서는 연결 끊김·시간 초과와 같은 경로로 처리돼야 한다 */
export class PgStubInterruptedError extends Error {
  constructor(operation: 'send' | 'inquiry', paymentCancelId: string) {
    super(`PG 대역 ${operation} 응답 전 중단: ${paymentCancelId}`);
    this.name = 'PgStubInterruptedError';
  }
}

type Operation = 'send' | 'inquiry';

/** 다음 호출 하나에 적용할 동작: 결과를 돌려주거나 응답 전에 중단한다 */
type Planned<T> = { kind: 'respond'; value: T } | { kind: 'interrupt' };

export class RefundPgStub implements RefundPgGateway {
  /** 받은 송신 호출 (호출 순서대로) */
  readonly sendCalls: PgCancelSendCall[] = [];
  /** 받은 조회 호출 (호출 순서대로) */
  readonly inquiryCalls: PgCancelInquiryCall[] = [];

  private sendPlan: Planned<PgCancelSendResult>[] = [];
  private inquiryPlan: Planned<PgCancelQueryResult>[] = [];
  private delayMs = 0;

  /**
   * 정해 둔 결과가 없을 때 쓰는 기본값
   * - 송신: ACCEPTED (접수만 되고 최종 결과는 조회로 확인)
   * - 조회: IN_PROGRESS (아직 처리 중)
   * 둘 다 환불금 지급을 확정하지 않는 결과라, 테스트가 성공을 정하지 않으면 지급 완료가 되지 않는다
   */
  private defaultSend: PgCancelSendResult = { result: 'ACCEPTED' };
  private defaultInquiry: PgCancelQueryResult = { result: 'IN_PROGRESS' };

  /**
   * 다음 송신 호출들의 결과를 순서대로 정한다
   * @param results 호출 순서대로 돌려줄 결과
   * @returns 이 대역(연쇄 호출용)
   */
  respondToSend(...results: PgCancelSendResult[]): this {
    // 결과마다 호출 하나를 소비하도록 계획에 추가한다
    this.sendPlan.push(
      ...results.map((value) => ({ kind: 'respond' as const, value })),
    );
    return this;
  }

  /**
   * 다음 조회 호출들의 결과를 순서대로 정한다
   * @param results 호출 순서대로 돌려줄 결과
   * @returns 이 대역(연쇄 호출용)
   */
  respondToInquiry(...results: PgCancelQueryResult[]): this {
    // 결과마다 호출 하나를 소비하도록 계획에 추가한다
    this.inquiryPlan.push(
      ...results.map((value) => ({ kind: 'respond' as const, value })),
    );
    return this;
  }

  /**
   * 다음 호출 하나를 응답 전에 중단시킨다(PgStubInterruptedError로 실패)
   * @param operation 중단할 호출 종류
   * @returns 이 대역(연쇄 호출용)
   */
  interruptNext(operation: Operation): this {
    // 정해 둔 결과들 뒤에 중단 한 번을 추가한다
    if (operation === 'send') this.sendPlan.push({ kind: 'interrupt' });
    else this.inquiryPlan.push({ kind: 'interrupt' });
    return this;
  }

  /**
   * 정해 둔 결과가 없을 때 돌려줄 기본 결과를 바꾼다
   * @param defaults.send 송신 기본 결과(생략 시 유지)
   * @param defaults.inquiry 조회 기본 결과(생략 시 유지)
   * @returns 이 대역(연쇄 호출용)
   */
  respondByDefault(defaults: {
    send?: PgCancelSendResult;
    inquiry?: PgCancelQueryResult;
  }): this {
    if (defaults.send) this.defaultSend = defaults.send;
    if (defaults.inquiry) this.defaultInquiry = defaults.inquiry;
    return this;
  }

  /**
   * 모든 호출의 응답을 지정한 시간만큼 늦춘다
   * @param ms 지연 시간(밀리초), 0이면 즉시 응답
   * @returns 이 대역(연쇄 호출용)
   */
  delayResponses(ms: number): this {
    this.delayMs = ms;
    return this;
  }

  /**
   * PG 취소를 송신한다
   * @param request PG 취소 요청 식별자와 금액
   * @returns 정해 둔 송신 결과
   * @throws PgStubInterruptedError 응답 전 중단이 계획돼 있을 때
   */
  async sendCancel(request: {
    paymentCancelId: string;
    amount: number;
  }): Promise<PgCancelSendResult> {
    // 호출을 먼저 기록한다(중단돼도 PG에 도달한 시도로 남는다)
    this.sendCalls.push({ ...request, calledAt: new Date() });

    // 계획된 동작을 꺼내 지연 후 적용한다
    const planned = this.sendPlan.shift();
    await this.wait();
    return this.apply(
      planned,
      this.defaultSend,
      'send',
      request.paymentCancelId,
    );
  }

  /**
   * PG 취소 결과를 조회한다
   * @param request 조회할 PG 취소 요청 식별자
   * @returns 정해 둔 조회 결과
   * @throws PgStubInterruptedError 응답 전 중단이 계획돼 있을 때
   */
  async inquireCancel(request: {
    paymentCancelId: string;
  }): Promise<PgCancelQueryResult> {
    // 호출을 기록한다
    this.inquiryCalls.push({ ...request, calledAt: new Date() });

    // 계획된 동작을 꺼내 지연 후 적용한다
    const planned = this.inquiryPlan.shift();
    await this.wait();
    return this.apply(
      planned,
      this.defaultInquiry,
      'inquiry',
      request.paymentCancelId,
    );
  }

  /**
   * 호출 기록·계획·지연·기본값을 처음 상태로 되돌린다
   */
  reset(): void {
    this.sendCalls.length = 0;
    this.inquiryCalls.length = 0;
    this.sendPlan = [];
    this.inquiryPlan = [];
    this.delayMs = 0;
    this.defaultSend = { result: 'ACCEPTED' };
    this.defaultInquiry = { result: 'IN_PROGRESS' };
  }

  /** 설정된 지연 시간만큼 기다린다 */
  private async wait(): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.delayMs));
    }
  }

  /**
   * 계획된 동작을 적용한다
   * @param planned 이번 호출의 계획(없으면 기본 결과)
   * @param fallback 기본 결과
   * @param operation 호출 종류(오류 메시지용)
   * @param paymentCancelId PG 취소 요청 식별자(오류 메시지용)
   * @returns 돌려줄 결과
   * @throws PgStubInterruptedError 중단이 계획돼 있을 때
   */
  private apply<T>(
    planned: Planned<T> | undefined,
    fallback: T,
    operation: Operation,
    paymentCancelId: string,
  ): T {
    // 계획이 없으면 기본 결과
    if (!planned) return fallback;

    // 중단 계획이면 응답 대신 오류
    if (planned.kind === 'interrupt') {
      throw new PgStubInterruptedError(operation, paymentCancelId);
    }
    return planned.value;
  }
}
