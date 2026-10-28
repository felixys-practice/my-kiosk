import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SessionEndJobQueue } from './session-end-job.queue';
import { SessionLifecycleService } from './session-lifecycle.service';
import { SeatAssignmentModule } from 'src/seat-assignment/seat-assignment.module';

@Module({
  imports: [
    SeatAssignmentModule,
    BullModule.registerQueue({ name: 'usage-session' }),
  ],
  providers: [SessionLifecycleService, SessionEndJobQueue],
  exports: [SessionLifecycleService, SessionEndJobQueue],
})
export class SessionLifecycleModule {}
