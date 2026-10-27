// PG 거래조회 결과 - 락 만료 후 재시도 시, 이전 취소 요청의 실제 처리 상태를 확인하기 위해 사용
export enum PgCancelInquiryResult {
  NOT_FOUND = 'NOT_FOUND', // PG에 해당 취소 거래 없음(요청이 PG에 도달하지 않음)
  SUCCEEDED = 'SUCCEEDED', // PG가 취소를 성공 처리함
  FAILED = 'FAILED', // PG가 취소를 실패 처리함
  IN_PROGRESS = 'IN_PROGRESS', // PG가 요청을 접수했고 아직 처리 중(PENDING/PROCESSING 등) - 확정 불가, 진행 중으로 취급
}

export interface PgCancelInquiry {
  result: PgCancelInquiryResult;
  pgTransactionId?: string;
  cancelledAmount?: number;
}

// ── 환불 PG 취소 계약 (specs/002-refund-completion API 계약 §8) ─────────

/** PG 취소 송신 결과 */
export type PgCancelSendResult =
  | { result: 'NOT_SENT'; reason: string } // PG에 보내기 전에 실패가 확인됨(미연동 포함)
  | { result: 'ACCEPTED' } // PG가 접수함, 최종 결과는 조회로 확인
  | { result: 'UNKNOWN'; reason: string } // 보냈으나 응답을 받지 못함(시간 초과 등)
  | { result: 'SUCCEEDED'; pgTransactionId: string; cancelledAmount: number } // 즉시 취소 성공
  | { result: 'REJECTED'; reason: string }; // PG가 거절함

/** PG 취소 조회 결과 */
export type PgCancelQueryResult =
  | { result: 'SUCCEEDED'; pgTransactionId: string; cancelledAmount: number }
  | { result: 'FAILED'; reason: string } // PG가 취소 실패를 확정함
  | { result: 'IN_PROGRESS' } // PG가 처리 중
  | { result: 'NOT_FOUND'; authoritative: true } // PG가 미접수를 확실히 확인함
  | { result: 'QUERY_ERROR'; reason: string }; // 조회 실패·판단 불가(일반 404·지연·인증 오류·필수 값 누락 포함)
