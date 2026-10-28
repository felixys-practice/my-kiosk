/**
 * 연속 조회 오류 횟수에 따른 다음 조회 간격(API 계약 §8: min(base × 2^(n-1), cap))
 * @param failures 연속 조회 오류 횟수(1부터)
 * @param baseSeconds 첫 오류 뒤 간격(REFUND_QUERY_BACKOFF_SECONDS)
 * @param capSeconds 간격 상한(REFUND_QUERY_BACKOFF_MAX_SECONDS)
 * @returns 다음 조회까지의 초
 */
export function inquiryBackoffSeconds(
  failures: number,
  baseSeconds: number,
  capSeconds: number,
): number {
  return Math.min(baseSeconds * 2 ** (failures - 1), capSeconds);
}
