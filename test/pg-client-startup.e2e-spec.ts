import { ProductionPgClient } from '../src/pg/production-pg.client';
import { TransactionLoggerService } from '../src/logger/transaction-logger.service';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
import configuration from '../src/config/configuration';
import { validateEnvironment } from '../src/config/validation.schema';
import { PgModule } from '../src/pg/pg.module';
import { PG_CLIENT } from '../src/pg/pg.client';
import { SimulatedPgClient } from '../src/pg/simulated-pg.client';

// 업무 DB에 연결하지 않고 실제 Nest 앱의 설정·PG 모듈 초기화를 검증한다.
async function start(env: Record<string, string>, missingSettings = false) {
  const config = ConfigModule.forRoot({
    isGlobal: true,
    ignoreEnvFile: true,
    ignoreEnvVars: true,
    validate: () => validateEnvironment(env),
    load: [() => ({ ...configuration(), pg: { mode: env.PG_MODE } })],
  });
  const builder = Test.createTestingModule({ imports: [config, PgModule] })
    .overrideProvider(TransactionLoggerService)
    .useValue({});
  if (missingSettings)
    builder.overrideProvider(ProductionPgClient).useValue({
      validateConfiguration: () => ({
        ready: false,
        code: 'PG_CONFIGURATION_MISSING',
        fields: ['PG_VENDOR_KEY'],
      }),
    });
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  try {
    await app.init();
    await app.close();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
const validEnv = {
  NODE_ENV: 'test',
  PG_MODE: 'simulated',
  DATABASE_URL: 'postgresql://unused',
  JWT_SECRET: 'startup-secret',
  JWT_REFRESH_SECRET: 'startup-refresh',
  PG_CALLBACK_SECRET: 'startup-callback-secret-longer-than-32',
};

describe('PG 서버 시작 검증', () => {
  afterEach(() => vi.restoreAllMocks());
  it('미지원 모드는 이유와 함께 앱 시작을 거부한다 (QS-12)', async () => {
    await expect(
      start({ ...validEnv, PG_MODE: 'unsupported-secret-value' }),
    ).rejects.toThrow('PG_MODE_INVALID');
  });
  it('필수 설정 검증 실패 로그는 코드·항목명·이유만 포함하고 비밀값을 노출하지 않는다', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const env: Record<string, string> = { ...validEnv };
    delete env.JWT_SECRET;
    await expect(
      start({ ...env, PG_VENDOR_KEY: 'sensitive-canary' }),
    ).rejects.toThrow('JWT_SECRET');
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain('CONFIGURATION_INVALID');
    expect(output).toContain('JWT_SECRET');
    expect(output).not.toContain('sensitive-canary');
    expect(output).not.toContain(validEnv.JWT_REFRESH_SECRET);
    expect(output).not.toContain(validEnv.PG_CALLBACK_SECRET);
  });
  it.each(['development', 'test'])(
    '허용 환경 %s는 모의 구현으로 시작하고 모드·구현명을 기록한다 (QS-10)',
    async (nodeEnv) => {
      const log = vi
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => {});
      const app = await start({ ...validEnv, NODE_ENV: nodeEnv });
      expect(app.get(PG_CLIENT)).toBeInstanceOf(SimulatedPgClient);
      expect(JSON.stringify(log.mock.calls)).toContain('simulated');
      expect(JSON.stringify(log.mock.calls)).toContain('SimulatedPgClient');
      for (const secret of [
        validEnv.JWT_SECRET,
        validEnv.JWT_REFRESH_SECRET,
        validEnv.PG_CALLBACK_SECRET,
      ]) {
        expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
      }
    },
  );
  it('선택 구현의 필수 설정 누락은 항목명과 이유를 알리고 시작을 거부한다 (QS-14)', async () => {
    const errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    await expect(
      start({ ...validEnv, PG_MODE: 'production' }, true),
    ).rejects.toThrow('PG_VENDOR_KEY');
    expect(JSON.stringify(errorLog.mock.calls)).toContain(
      'PG_CONFIGURATION_MISSING',
    );
    expect(JSON.stringify(errorLog.mock.calls)).toContain('PG_VENDOR_KEY');
  });
  it('운영용 미구현 골격을 선택하면 앱 시작을 거부한다 (QS-13)', async () => {
    await expect(start({ ...validEnv, PG_MODE: 'production' })).rejects.toThrow(
      'PG_IMPLEMENTATION_INCOMPLETE',
    );
  });
  it('운영 환경의 모의 선택은 앱 시작을 거부한다 (QS-11)', async () => {
    await expect(
      start({ ...validEnv, NODE_ENV: 'production' }),
    ).rejects.toThrow('PG_MODE_FORBIDDEN');
  });
  it('모드 누락은 이유와 함께 앱 시작을 거부한다 (QS-12)', async () => {
    const env: Record<string, string> = { ...validEnv };
    delete env.PG_MODE;
    await expect(start(env)).rejects.toThrow('PG_MODE_INVALID');
  });
});
