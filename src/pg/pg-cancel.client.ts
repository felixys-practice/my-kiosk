/**
 * PG 취소 HTTP 전송 계층
 * - PG사마다 다른 HTTP API를 이 계층 뒤에 둔다. PgService는 여기서 받은 원래 응답을 계약 §8 결과로 분류한다
 * - 실제 PG 연동은 범위 밖이다. 아래 원래 응답 본문 형식은 분류 규칙을 테스트하려고 정한 **가상 형식**이며,
 *   실제 PG를 붙일 때는 그 PG의 응답에 맞춰 이 계층과 PgService의 분류 규칙을 바꾼다
 */

/** PG에 보내는 취소 요청 */
export type PgCancelRequest = {
  paymentCancelId: string; // PG 멱등 키로 쓰는 PG 취소 요청 식별자
  amount: number; // 취소 요청 금액
};

/** PG 원래 응답(가상 형식) */
export type PgRawResponse = {
  httpStatus: number;
  body?: {
    status?: string; // ACCEPTED / SUCCEEDED / REJECTED / FAILED / IN_PROGRESS / NOT_FOUND
    authoritative?: boolean; // NOT_FOUND일 때 PG가 미접수를 확정했는지
    pgTransactionId?: string; // PG 취소 거래 ID
    cancelledAmount?: number; // 실제 취소액
    reason?: string; // 거절·실패 사유
  };
};

/** PG 취소 전송 계층 */
export interface PgCancelClient {
  /** 실제 PG에 연결돼 있는지 */
  readonly configured: boolean;
  /** 취소를 보낸다 */
  send(request: PgCancelRequest, signal: AbortSignal): Promise<PgRawResponse>;
  /** 취소 결과를 조회한다 */
  inquire(
    request: { paymentCancelId: string },
    signal: AbortSignal,
  ): Promise<PgRawResponse>;
}

/** PgCancelClient 주입 토큰 */
export const PG_CANCEL_CLIENT = Symbol('PG_CANCEL_CLIENT');

/** 실제 PG가 연결되지 않은 기본 전송 계층. 호출되면 안 되므로 호출 시 오류를 낸다 */
export class UnconfiguredPgCancelClient implements PgCancelClient {
  readonly configured = false;

  send(): Promise<PgRawResponse> {
    return Promise.reject(new Error('PG 취소 전송 계층이 연결되지 않았습니다'));
  }

  inquire(): Promise<PgRawResponse> {
    return Promise.reject(new Error('PG 취소 전송 계층이 연결되지 않았습니다'));
  }
}
