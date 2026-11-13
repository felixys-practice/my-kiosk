import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PgService } from '../src/pg/pg.service';
import { REFUND_PG_GATEWAY } from '../src/pg/refund-pg.gateway';
import { RefundAccessService } from '../src/refund/refund-access.service';
import { RefundIdempotencyService } from '../src/refund/refund-idempotency.service';
import { RefundLockingRepository } from '../src/refund/refund-locking.repository';
import {
  createRefundTestContext,
  RefundTestContext,
} from './helpers/refund-test-context';
import { RefundPgStub } from './helpers/refund-pg.stub';

/**
 * 환불 공통 기반 모듈 연결 E2E (tasks T018)
 * - 새 Provider가 순환 의존 없이 앱에 등록되는지
 * - 환불 PG 포트의 기본 구현과 E2E 대역 교체 지점이 동작하는지
 */
describe('환불 공통 기반 모듈 연결 (E2E)', () => {
  it('기본 설정에서 환불 PG 포트는 PgService이고 공통 Provider가 모두 주입된다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      expect(app.get(REFUND_PG_GATEWAY)).toBe(app.get(PgService));
      expect(app.get(RefundIdempotencyService)).toBeInstanceOf(
        RefundIdempotencyService,
      );
      expect(app.get(RefundAccessService)).toBeInstanceOf(RefundAccessService);
      expect(app.get(RefundLockingRepository)).toBeInstanceOf(
        RefundLockingRepository,
      );
    } finally {
      await app.close();
    }
  });

  describe('E2E 컨텍스트의 PG 대역 교체', () => {
    const pgStub = new RefundPgStub();
    let ctx: RefundTestContext;

    beforeAll(async () => {
      ctx = await createRefundTestContext({
        label: 'bootstrap',
        configure: (builder) =>
          builder.overrideProvider(REFUND_PG_GATEWAY).useValue(pgStub),
      });
    });

    afterAll(async () => {
      await ctx.close();
    });

    it('환불 PG 포트만 테스트 대역으로 바뀌고 결제용 PgService는 그대로다', () => {
      expect(ctx.app.get(REFUND_PG_GATEWAY)).toBe(pgStub);
      expect(ctx.app.get(PgService)).toBeInstanceOf(PgService);
    });
  });
});
