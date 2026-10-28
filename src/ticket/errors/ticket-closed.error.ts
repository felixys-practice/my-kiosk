import { DomainBadRequestError } from 'src/common/errors/domain-bad-request.error';

// 400: 만료·소진된 이용권이라 좌석을 바꿀 수 없음(환불로 종료된 이용권은 TicketTerminatedError)
export class TicketClosedError extends DomainBadRequestError {
  constructor(message = '종료된 이용권은 좌석을 바꿀 수 없습니다') {
    super(message);
    this.name = 'TicketClosedError';
  }
}
