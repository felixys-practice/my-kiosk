import { DomainNotFoundError } from 'src/common/errors/domain-not-found.error';

// 404: 이용권이 없음
export class TicketNotFoundError extends DomainNotFoundError {
  constructor(message = '이용권을 찾을 수 없습니다') {
    super(message);
    this.name = 'TicketNotFoundError';
  }
}
