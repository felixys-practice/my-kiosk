import { DomainConflictError } from 'src/common/errors/domain-conflict.error';

// 409: 유효한 지정(선점·확정)이 있는 고정석이라 자유석·이용 불가로 바꿀 수 없음
export class SeatHasAssignmentError extends DomainConflictError {
  constructor(message: string) {
    super(message);
    this.name = 'SeatHasAssignmentError';
  }
}
