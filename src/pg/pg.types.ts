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
