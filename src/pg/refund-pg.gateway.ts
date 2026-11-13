import { PgCancelRequest } from './pg-cancel.client';
import { PgCancelQueryResult, PgCancelSendResult } from './pg.types';

/**
 * 환불 도메인이 쓰는 PG 취소 포트
 * - 기본 구현은 PgService다. E2E는 이 토큰만 테스트 대역(test/helpers/refund-pg.stub.ts)으로 바꾼다
 * - 결제 승인 등 다른 PG 기능은 PgService를 그대로 쓴다
 */
export interface RefundPgGateway {
  /** PG 취소를 보낸다 */
  sendCancel(request: PgCancelRequest): Promise<PgCancelSendResult>;
  /** PG 취소 결과를 조회한다 */
  inquireCancel(request: {
    paymentCancelId: string;
  }): Promise<PgCancelQueryResult>;
}

/** RefundPgGateway 주입 토큰 */
export const REFUND_PG_GATEWAY = Symbol('REFUND_PG_GATEWAY');
