import { Module } from '@nestjs/common';
import { RefundService } from './refund.service';
import { RefundController } from './refund.controller';
import { RefundRepository } from './refund.repository';
import { LoggerModule } from 'src/logger/logger.module';
import { SessionLifecycleModule } from 'src/session-lifecycle/session-lifecycle.module';
import { PgModule } from 'src/pg/pg.module';
import { SeatAssignmentModule } from 'src/seat-assignment/seat-assignment.module';
import { RefundIdempotencyRepository } from './refund-idempotency.repository';
import { RefundIdempotencyService } from './refund-idempotency.service';
import { RefundAccessService } from './refund-access.service';
import { RefundLockingRepository } from './refund-locking.repository';
import { RefundAcceptanceService } from './refund-acceptance.service';
import { RefundResultService } from './refund-result.service';
import { RefundStoreService } from './refund-store.service';
import { RefundDispatchService } from './refund-dispatch.service';
import { RefundEventRepository } from './refund-event.repository';
import { RefundLedgerRepository } from 'src/ledger/refund-ledger.repository';

@Module({
  imports: [
    LoggerModule,
    PgModule,
    SeatAssignmentModule,
    SessionLifecycleModule,
  ],
  providers: [
    RefundService,
    RefundRepository,
    // 환불 공통 기반(Phase 2): DB 멱등 기록, 권한 범위, 공유 잠금 순서
    RefundIdempotencyRepository,
    RefundIdempotencyService,
    RefundAccessService,
    RefundLockingRepository,
    // 환불 확정(US1~)
    RefundAcceptanceService,
    // 환불금 지급 결과 공통 처리(US4~)
    RefundResultService,
    RefundLedgerRepository,
    RefundEventRepository,
    // 점주 매장 환불(US2)
    RefundStoreService,
    // PG 취소 요청 전송·조회·복구(US5)
    RefundDispatchService,
  ],
  controllers: [RefundController],
  exports: [RefundService],
})
export class RefundModule {}
