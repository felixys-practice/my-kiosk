import { DomainBadRequestError } from 'src/common/errors/domain-bad-request.error';

// 400: 이용권 종류에 맞지 않는 필드(시간권에 이용 기간, 기간권에 이용 시간)를 보냄
export class ProductFieldMismatchError extends DomainBadRequestError {
  constructor(message: string) {
    super(message);
    this.name = 'ProductFieldMismatchError';
  }
}
