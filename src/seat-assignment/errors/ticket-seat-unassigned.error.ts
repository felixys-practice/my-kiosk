import { DomainBadRequestError } from 'src/common/errors/domain-bad-request.error';

// 400: 고정석 이용권인데 확정된 배정 좌석이 없음(자동 결제 취소 대기 중 등)
export class TicketSeatUnassignedError extends DomainBadRequestError {
  constructor(message = '배정 좌석이 없는 고정석 이용권입니다') {
    super(message);
    this.name = 'TicketSeatUnassignedError';
  }
}
