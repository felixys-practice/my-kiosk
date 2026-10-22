import { DomainBadRequestError } from 'src/common/errors/domain-bad-request.error';

// 400: 일시정지 중인 이용권이라 좌석을 바꿀 수 없음(재개 후 변경)
export class TicketPausedError extends DomainBadRequestError {
  constructor(message = '일시정지 중인 이용권은 재개한 뒤 좌석을 바꾸세요') {
    super(message);
    this.name = 'TicketPausedError';
  }
}
