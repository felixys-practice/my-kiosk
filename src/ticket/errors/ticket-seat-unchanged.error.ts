import { DomainBadRequestError } from 'src/common/errors/domain-bad-request.error';

// 400: 이용권 좌석 변경 요청이 현재와 같아 바뀌는 것이 없음
export class TicketSeatUnchangedError extends DomainBadRequestError {
  constructor(message = '바뀌는 내용이 없습니다') {
    super(message);
    this.name = 'TicketSeatUnchangedError';
  }
}
