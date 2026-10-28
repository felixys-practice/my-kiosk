// 테스트 환경 공통 설정(jest setupFiles)
// - 환불 자동 작업자(5초 정기 탐색)를 끈다. 테스트는 탐색·복구를 직접 호출해 검증하고,
//   공유 DB의 다른 테스트 데이터나 PG 대역 응답을 백그라운드 작업이 가로채지 않게 한다
process.env.REFUND_RECOVERY_WORKER_ENABLED = 'false';
