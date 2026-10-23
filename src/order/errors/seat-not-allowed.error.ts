import { DomainBadRequestError } from 'src/common/errors/domain-bad-request.error';

// 400: 자유석 상품 주문 항목에 좌석을 지정함
export class SeatNotAllowedError extends DomainBadRequestError {
  constructor(message = '자유석 상품은 좌석을 지정하지 않고 주문합니다') {
    super(message);
    this.name = 'SeatNotAllowedError';
  }
}
