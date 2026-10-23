import { Module } from '@nestjs/common';
import { SessionLifecycleService } from './session-lifecycle.service';
import { SeatAssignmentModule } from 'src/seat-assignment/seat-assignment.module';

@Module({
  imports: [SeatAssignmentModule],
  providers: [SessionLifecycleService],
  exports: [SessionLifecycleService],
})
export class SessionLifecycleModule {}
