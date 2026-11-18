import type { PgCancelQueryResult, PgCancelSendResult } from './pg.types';

export type PgPaymentCancelRequest = {
  paymentCancelId: string;
  amount: number;
};

export type PgPaymentCancelInquiry = {
  paymentCancelId: string;
};

export type PgClientConfigurationResult =
  | { ready: true }
  | {
      ready: false;
      code: 'PG_IMPLEMENTATION_INCOMPLETE' | 'PG_CONFIGURATION_MISSING';
      /** 누락된 설정 이름만 포함하며 설정값은 포함하지 않는다. */
      fields?: string[];
    };

/** PG 통신과 PG사 응답 해석을 담당한다. 환불 업무 상태는 변경하지 않는다. */
export interface PgClient {
  /** 서버 시작 시 구현의 준비 여부와 필수 설정을 검사한다. */
  validateConfiguration(): PgClientConfigurationResult;

  /** 지정 금액의 결제 취소를 요청한다. (PG서버에 요청)*/
  requestPaymentCancel(
    request: PgPaymentCancelRequest,
    signal: AbortSignal,
  ): Promise<PgCancelSendResult>;

  /** 지정한 결제 취소 요청의 처리 결과를 조회한다.(PG서버에 요청) */
  inquirePaymentCancel(
    request: PgPaymentCancelInquiry,
    signal: AbortSignal,
  ): Promise<PgCancelQueryResult>;
}

// eslint-disable-next-line @typescript-eslint/naming-convention -- DI 토큰의 명칭은 확정된 PG_CLIENT 계약을 유지한다.
export const PG_CLIENT = Symbol('PG_CLIENT');
