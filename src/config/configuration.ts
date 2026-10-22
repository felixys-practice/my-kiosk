/**
 * 애플리케이션 설정 파일
 * - 환경 변수를 구조화된 객체로 변환
 * - 타입 안정성 제공
 *
 * 사용예:
 * ```typescript
 * // ConfigModule을 앱에 등록
 * ConfigModule.forRoot({
 *   isGlobal: true,
 *   load: [configuration],
 * })
 *
 * // ConfigService로 설정값 주입받아 사용
 * constructor(private configService: ConfigService) {}
 *
 * // 설정값 접근
 * const port = this.configService.get<number>('app.port');
 * const dbUrl = this.configService.get<string>('database.postgres.url');
 * ```
 */
export default () => ({
  // 애플리케이션 기본 설정
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
  },

  // 데이터베이스 설정
  database: {
    postgres: {
      url: process.env.DATABASE_URL,
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
    },
  },

  // JWT 인증 설정
  jwt: {
    secret: process.env.JWT_SECRET,
    accessExpiresMinutes: parseInt(
      process.env.JWT_ACCESS_EXPIRES_MINUTES || '15',
      10,
    ),
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresDays: parseInt(
      process.env.JWT_REFRESH_EXPIRES_DAYS || '7',
      10,
    ),
  },

  // 멱등성 설정
  idempotency: {
    keyTtlSeconds: parseInt(
      process.env.IDEMPOTENCY_KEY_TTL_SECONDS || '600',
      10,
    ),
  },

  // 좌석 설정
  seat: {
    // 고정석 선점(HELD) 유효시간(분) - 결제 없이 방치된 선점이 풀리기까지의 시간
    holdMinutes: parseInt(process.env.SEAT_HOLD_MINUTES || '10', 10),
  },
});
