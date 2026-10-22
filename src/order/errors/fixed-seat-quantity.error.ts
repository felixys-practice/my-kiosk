import { DomainBadRequestError } from 'src/common/errors/domain-bad-request.error';

// 400: 고정석 상품 주문 항목의 수량이 1이 아님
export class FixedSeatQuantityError extends DomainBadRequestError {
  constructor(message = '고정석 상품은 좌석 하나에 한 개씩 주문합니다') {
    super(message);
    this.name = 'FixedSeatQuantityError';
  }
}
