import { DomainBadRequestError } from 'src/common/errors/domain-bad-request.error';

// 400: 선택한 좌석이 다른 매장 좌석(또는 없는 좌석)
export class SeatShopMismatchError extends DomainBadRequestError {
  constructor(message = '이 매장의 좌석이 아닙니다') {
    super(message);
    this.name = 'SeatShopMismatchError';
  }
}
