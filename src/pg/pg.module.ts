import { Module } from '@nestjs/common';
import { PgService } from './pg.service';
import {
  PG_CANCEL_CLIENT,
  UnconfiguredPgCancelClient,
} from './pg-cancel.client';
import { LoggerModule } from 'src/logger/logger.module';
import { REFUND_PG_GATEWAY } from './refund-pg.gateway';

@Module({
  imports: [LoggerModule],
  providers: [
    PgService,
    // 실제 PG 연동 전에는 미연동 전송 계층을 쓴다(송신 NOT_SENT, 조회 QUERY_ERROR)
    { provide: PG_CANCEL_CLIENT, useClass: UnconfiguredPgCancelClient },
    // 환불 PG 취소 포트. E2E는 이 토큰만 테스트 대역으로 바꾼다
    { provide: REFUND_PG_GATEWAY, useExisting: PgService },
  ],
  exports: [PgService, REFUND_PG_GATEWAY],
})
export class PgModule {}
