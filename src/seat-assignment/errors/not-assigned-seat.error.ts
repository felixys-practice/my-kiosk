import { DomainBadRequestError } from 'src/common/errors/domain-bad-request.error';

// 400: 고정석 이용권으로 배정 좌석이 아닌 좌석에 입실하려 함
export class NotAssignedSeatError extends DomainBadRequestError {
  constructor(message = '배정 좌석만 이용할 수 있습니다') {
    super(message);
    this.name = 'NotAssignedSeatError';
  }
}
