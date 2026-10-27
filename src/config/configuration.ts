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

  // 환불 PG 요청·조회·복구 설정 (API 계약 §8 운영 설정)
  refund: {
    // 응답 없는 PG 취소 요청의 최초 조회 대기(초)
    resultWaitSeconds: parseInt(
      process.env.REFUND_RESULT_WAIT_SECONDS || '60',
      10,
    ),
    // DB의 전송·조회 예정 작업 탐색 주기(초)
    sweepIntervalSeconds: parseInt(
      process.env.REFUND_SWEEP_INTERVAL_SECONDS || '5',
      10,
    ),
    // 정상 재조회 간격(초)
    queryIntervalSeconds: parseInt(
      process.env.REFUND_QUERY_INTERVAL_SECONDS || '15',
      10,
    ),
    // PG 전송·조회 응답 제한(초)
    pgTimeoutSeconds: parseInt(
      process.env.REFUND_PG_TIMEOUT_SECONDS || '10',
      10,
    ),
    // 작업자 처리 기한(초)
    workLeaseSeconds: parseInt(
      process.env.REFUND_WORK_LEASE_SECONDS || '30',
      10,
    ),
    // 조회 실패 후 첫 재조회 간격(초)
    queryBackoffSeconds: parseInt(
      process.env.REFUND_QUERY_BACKOFF_SECONDS || '15',
      10,
    ),
    // 지수 증가 조회 간격 상한(초)
    queryBackoffMaxSeconds: parseInt(
      process.env.REFUND_QUERY_BACKOFF_MAX_SECONDS || '300',
      10,
    ),
    // PG 취소 결과 확인 실패로 전환하는 연속 조회 오류 횟수
    queryFailureThreshold: parseInt(
      process.env.REFUND_QUERY_FAILURE_THRESHOLD || '5',
      10,
    ),
    // 장애 복구 확인용 1건 조회 간격(초)
    recoveryProbeSeconds: parseInt(
      process.env.REFUND_RECOVERY_PROBE_SECONDS || '900',
      10,
    ),
    // 일반·복구 조회 처리 단위(건)
    recoveryBatchSize: parseInt(
      process.env.REFUND_RECOVERY_BATCH_SIZE || '20',
      10,
    ),
    // 백그라운드 자동 재전송 한도(회). 최초 전송과 개별 확인에 따른 재전송은 제외
    resendLimit: parseInt(process.env.REFUND_RESEND_LIMIT || '3', 10),
    // 별도 환불금 지급 예약 후 미확인 최초 알림 기준(초)
    manualConfirmAlertSeconds: parseInt(
      process.env.REFUND_MANUAL_CONFIRM_ALERT_SECONDS || '3600',
      10,
    ),
  },

  // PG 콜백 서명 검증 설정
  pgCallback: {
    // 콜백 서명 시각 오차 허용(초)
    maxSkewSeconds: parseInt(
      process.env.PG_CALLBACK_MAX_SKEW_SECONDS || '300',
      10,
    ),
  },
});
