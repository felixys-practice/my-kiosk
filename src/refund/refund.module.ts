import { Module } from '@nestjs/common';
import { RefundService } from './refund.service';
import { RefundController } from './refund.controller';
import { RefundRepository } from './refund.repository';
import { LoggerModule } from 'src/logger/logger.module';
import { PgModule } from 'src/pg/pg.module';
import { SeatAssignmentModule } from 'src/seat-assignment/seat-assignment.module';
import { IdempotencyInterceptor } from 'src/common/interceptors/idempotency.interceptor';
import { RefundIdempotencyRepository } from './refund-idempotency.repository';
import { RefundIdempotencyService } from './refund-idempotency.service';
import { RefundAccessService } from './refund-access.service';
import { RefundLockingRepository } from './refund-locking.repository';

@Module({
  imports: [LoggerModule, PgModule, SeatAssignmentModule],
  providers: [
    RefundService,
    RefundRepository,
    IdempotencyInterceptor,
    // 환불 공통 기반(Phase 2): DB 멱등 기록, 권한 범위, 공유 잠금 순서
    RefundIdempotencyRepository,
    RefundIdempotencyService,
    RefundAccessService,
    RefundLockingRepository,
  ],
  controllers: [RefundController],
  exports: [RefundService],
})
export class RefundModule {}
