import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TicketRepository } from './ticket.repository';
import { TicketService } from './ticket.service';
import { TicketController } from './ticket.controller';
import { TicketPauseRepository } from './ticket-pause/ticket-pause.repository';
import { TicketPauseService } from './ticket-pause/ticket-pause.service';
import { TicketPauseController } from './ticket-pause/ticket-pause.controller';
import { SessionLifecycleModule } from 'src/session-lifecycle/session-lifecycle.module';
import { TicketSeatController } from './ticket-seat/ticket-seat.controller';
import { TicketSeatService } from './ticket-seat/ticket-seat.service';
import { TicketSeatRepository } from './ticket-seat/ticket-seat.repository';
import { SeatAssignmentModule } from 'src/seat-assignment/seat-assignment.module';

@Module({
  imports: [
    SessionLifecycleModule,
    SeatAssignmentModule,
    BullModule.registerQueue({ name: 'usage-session' }),
  ],
  providers: [
    TicketRepository,
    TicketService,
    TicketPauseRepository,
    TicketPauseService,
    TicketSeatService,
    TicketSeatRepository,
  ],
  controllers: [TicketController, TicketPauseController, TicketSeatController],
  exports: [TicketRepository, TicketService, TicketPauseService],
})
export class TicketModule {}
