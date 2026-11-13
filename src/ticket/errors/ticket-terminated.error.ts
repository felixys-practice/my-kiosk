import { DomainConflictError } from 'src/common/errors/domain-conflict.error';

/**
 * 환불 확정으로 이용이 종료된(REVOKED) 이용권의 입실·정지 재개·좌석 타입 변경 (409, API 계약 §6)
 * - 환불금 지급 상태(완료·처리 중·실패)와 관계없이 같은 오류다
 */
export class TicketTerminatedError extends DomainConflictError {
  readonly code = 'TICKET_TERMINATED';

  constructor() {
    super('환불로 이용이 종료된 이용권입니다');
    this.name = 'TicketTerminatedError';
  }
}
