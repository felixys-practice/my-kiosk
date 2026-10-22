import { DomainBadRequestError } from 'src/common/errors/domain-bad-request.error';

// 400: 고정석 구매·변경·재개에 필요한 좌석 선택이 없음
export class SeatSelectionRequiredError extends DomainBadRequestError {
  constructor(message = '고정석은 좌석 선택이 필요합니다') {
    super(message);
    this.name = 'SeatSelectionRequiredError';
  }
}
