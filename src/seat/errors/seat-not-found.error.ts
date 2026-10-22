import { DomainNotFoundError } from 'src/common/errors/domain-not-found.error';

// 404: 좌석이 없음
export class SeatNotFoundError extends DomainNotFoundError {
  constructor(message = '좌석을 찾을 수 없습니다') {
    super(message);
    this.name = 'SeatNotFoundError';
  }
}
