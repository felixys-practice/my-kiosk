import { DomainNotFoundError } from 'src/common/errors/domain-not-found.error';

// 404: 주문이 없음
export class OrderNotFoundError extends DomainNotFoundError {
  constructor(message = '주문을 찾을 수 없습니다') {
    super(message);
    this.name = 'OrderNotFoundError';
  }
}
