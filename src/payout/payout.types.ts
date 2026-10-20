// 은행 송금 API 응답 결과. 실제 은행/오픈뱅킹 API 연동 전까지는
// PayoutService가 이 형태로 고정된 더미 값을 반환한다.
export enum BankTransferResult {
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

export interface BankTransferResponse {
  result: BankTransferResult;
  bankTransactionId?: string; // 은행이 응답한 거래 고유 ID(성공 시)
  failureReason?: string; // 실패 시 은행이 응답한 사유
}
