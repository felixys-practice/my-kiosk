import { DomainBadRequestError } from 'src/common/errors/domain-bad-request.error';

// 400: 요청한 좌석의 타입이 요구되는 좌석 타입과 맞지 않음
export class SeatTypeMismatchError extends DomainBadRequestError {
  constructor(message: string) {
    super(message);
    this.name = 'SeatTypeMismatchError';
  }
}
