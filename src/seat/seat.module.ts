import { Module } from '@nestjs/common';
import { SeatAssignmentModule } from 'src/seat-assignment/seat-assignment.module';
import { SeatRepository } from './seat.repository';
import { SeatController } from './seat.controller';
import { SeatService } from './seat.service';
import { ShopSeatController } from './shop-seat.controller';

@Module({
  imports: [SeatAssignmentModule],
  providers: [SeatRepository, SeatService],
  controllers: [SeatController, ShopSeatController],
  exports: [SeatRepository],
})
export class SeatModule {}
