import { Module } from '@nestjs/common';
import { PgService } from './pg.service';
import {
  PG_CANCEL_CLIENT,
  UnconfiguredPgCancelClient,
} from './pg-cancel.client';
import { LoggerModule } from 'src/logger/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [
    PgService,
    // 실제 PG 연동 전에는 미연동 전송 계층을 쓴다(송신 NOT_SENT, 조회 QUERY_ERROR)
    { provide: PG_CANCEL_CLIENT, useClass: UnconfiguredPgCancelClient },
  ],
  exports: [PgService],
})
export class PgModule {}
