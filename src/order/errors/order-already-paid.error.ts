import { DomainConflictError } from 'src/common/errors/domain-conflict.error';

// 409: 결제가 이미 성공한 주문이라 취소할 수 없음(환불 API를 사용)
export class OrderAlreadyPaidError extends DomainConflictError {
  constructor(message = '결제가 완료된 주문은 환불 API를 사용하세요') {
    super(message);
    this.name = 'OrderAlreadyPaidError';
  }
}
