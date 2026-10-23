import { Module } from '@nestjs/common';
import { RefundService } from './refund.service';
import { RefundController } from './refund.controller';
import { RefundRepository } from './refund.repository';
import { LoggerModule } from 'src/logger/logger.module';
import { PgModule } from 'src/pg/pg.module';
import { SeatAssignmentModule } from 'src/seat-assignment/seat-assignment.module';
import { IdempotencyInterceptor } from 'src/common/interceptors/idempotency.interceptor';

@Module({
  imports: [LoggerModule, PgModule, SeatAssignmentModule],
  providers: [RefundService, RefundRepository, IdempotencyInterceptor],
  controllers: [RefundController],
  exports: [RefundService],
})
export class RefundModule {}
