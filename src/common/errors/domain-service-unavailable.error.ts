// 503: 저장소 등 의존 자원이 일시적으로 처리하지 못함(예: DB 커밋 실패 → 클라이언트가 다시 보내야 함)
export class DomainServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainServiceUnavailableError';
  }
}
