import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PgService } from './pg.service';
import { PG_CLIENT } from './pg.client';
import { ProductionPgClient } from './production-pg.client';
import { SimulatedPgClient } from './simulated-pg.client';
import { LoggerModule } from 'src/logger/logger.module';

@Module({
  imports: [LoggerModule, ConfigModule],
  providers: [
    PgService,
    ProductionPgClient,
    SimulatedPgClient,
    {
      provide: PG_CLIENT,
      inject: [ConfigService, ProductionPgClient, SimulatedPgClient],
      useFactory: (
        config: ConfigService,
        production: ProductionPgClient,
        simulated: SimulatedPgClient,
      ) => {
        const mode = config.get<string>('pg.mode');
        const client =
          mode === 'production'
            ? production
            : mode === 'simulated'
              ? simulated
              : undefined;
        if (!client) {
          const reason =
            'PG_MODE를 simulated 또는 production으로 지정해야 합니다';
          new Logger('PgModule').error({
            code: 'PG_MODE_INVALID',
            fields: ['PG_MODE'],
            reason,
          });
          throw new Error(`PG_MODE_INVALID: ${reason}`);
        }
        const result = client.validateConfiguration();
        if (!result.ready) {
          const fields = result.fields ?? [];
          const reason =
            result.code === 'PG_IMPLEMENTATION_INCOMPLETE'
              ? '실제 운영 PG 통신이 구현되지 않았습니다'
              : '선택한 PG 구현의 필수 설정이 없습니다';
          new Logger('PgModule').error({ code: result.code, fields, reason });
          throw new Error(
            `${result.code}: ${reason}${fields.length ? ` (${fields.join(', ')})` : ''}`,
          );
        }
        new Logger('PgModule').log({
          mode,
          implementation: client.constructor.name,
        });
        return client;
      },
    },
  ],
  exports: [PgService, PG_CLIENT],
})
export class PgModule {}
