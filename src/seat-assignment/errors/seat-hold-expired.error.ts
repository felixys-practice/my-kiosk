import { DomainConflictError } from 'src/common/errors/domain-conflict.error';

// 409: 결제 요청 시 고정석 선점이 만료·해제되어 좌석을 다시 선택해야 함
export class SeatHoldExpiredError extends DomainConflictError {
  constructor(message = '좌석 선점이 만료되었습니다. 좌석을 다시 선택하세요') {
    super(message);
    this.name = 'SeatHoldExpiredError';
  }
}
