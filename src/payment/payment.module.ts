import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { OrderModule } from 'src/order/order.module';
import { PaymentRepository } from './payment.repository';
import { OrderItemModule } from 'src/order-item/order-item.module';
import { SeatAssignmentModule } from 'src/seat-assignment/seat-assignment.module';
import { RefundModule } from 'src/refund/refund.module';
import { LoggerModule } from 'src/logger/logger.module';

@Module({
  imports: [
    OrderModule,
    OrderItemModule,
    SeatAssignmentModule,
    RefundModule,
    LoggerModule,
  ],
  providers: [PaymentService, PaymentRepository],
  controllers: [PaymentController],
})
export class PaymentModule {}
