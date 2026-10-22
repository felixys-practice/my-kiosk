import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UsageSessionRepository } from './usage-session.repository';
import { UsageSessionController } from './usage-session.controller';
import { UsageSessionProcessor } from './usage-session-processor';
import { UsageSessionService } from './usage-session.service';
import { TicketModule } from 'src/ticket/ticket.module';
import { SessionLifecycleModule } from 'src/session-lifecycle/session-lifecycle.module';
import { SeatAssignmentModule } from 'src/seat-assignment/seat-assignment.module';

@Module({
  imports: [
    TicketModule,
    SessionLifecycleModule,
    SeatAssignmentModule,
    BullModule.registerQueue({ name: 'usage-session' }),
  ],
  providers: [
    UsageSessionRepository,
    UsageSessionService,
    UsageSessionProcessor,
  ],
  controllers: [UsageSessionController],
  exports: [UsageSessionRepository],
})
export class UsageSessionModule {}
