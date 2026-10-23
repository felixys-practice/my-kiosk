import { DomainConflictError } from 'src/common/errors/domain-conflict.error';

// 409: 한 주문 안에서 같은 좌석을 두 번 선택함
export class DuplicateSeatInOrderError extends DomainConflictError {
  constructor(message = '한 주문에서 같은 좌석을 두 번 선택할 수 없습니다') {
    super(message);
    this.name = 'DuplicateSeatInOrderError';
  }
}
