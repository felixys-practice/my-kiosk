import { Module } from '@nestjs/common';
import { SeatAssignmentRepository } from './seat-assignment.repository';
import { SeatAssignmentService } from './seat-assignment.service';

// 좌석 배정 모듈 - 주문·결제·이용권·이용 세션·환불 모듈이 명시적으로 import해 사용한다
@Module({
  providers: [SeatAssignmentRepository, SeatAssignmentService],
  exports: [SeatAssignmentService],
})
export class SeatAssignmentModule {}
