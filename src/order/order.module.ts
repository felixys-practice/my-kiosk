import { Module } from '@nestjs/common';
import { OrderRepository } from './order.repository';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { TicketModule } from 'src/ticket/ticket.module';
import { SeatAssignmentModule } from 'src/seat-assignment/seat-assignment.module';

@Module({
  imports: [TicketModule, SeatAssignmentModule],
  providers: [OrderRepository, OrderService],
  controllers: [OrderController],
  exports: [OrderRepository],
})
export class OrderModule {}
