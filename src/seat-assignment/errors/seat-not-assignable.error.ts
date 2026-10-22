import { DomainConflictError } from 'src/common/errors/domain-conflict.error';

// 409: 좌석에 이미 유효한 지정(선점·확정)이 있어 새로 지정할 수 없음
export class SeatNotAssignableError extends DomainConflictError {
  constructor(readonly seatId: string) {
    super(`이미 다른 이용권에 지정되었거나 선점된 좌석입니다: ${seatId}`);
    this.name = 'SeatNotAssignableError';
  }
}
