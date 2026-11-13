import { validationSchema } from './validation.schema';

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
export default () => {
  // 환불 설정은 검증 스키마가 적용한 기본값·숫자 변환 결과를 읽는다.
  // parseInt로 다시 읽으면 '3e1'처럼 Joi(30)와 다른 숫자(3)가 되어 검증한 값과 실제 값이 달라진다.
  // 검증 실패는 ConfigModule이 앱 기동 시 막으므로 여기서는 변환된 값만 쓴다.
  const refundEnv = validationSchema.validate(process.env, {
    allowUnknown: true,
    abortEarly: false,
  }).value as Record<string, number>;

  return {
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
    // 기본값과 숫자 해석은 검증 스키마(validation.schema.ts)의 결과를 그대로 쓴다
    refund: {
      // 응답 없는 PG 취소 요청의 최초 조회 대기(초)
      resultWaitSeconds: refundEnv.REFUND_RESULT_WAIT_SECONDS,
      // DB의 전송·조회 예정 작업 탐색 주기(초)
      sweepIntervalSeconds: refundEnv.REFUND_SWEEP_INTERVAL_SECONDS,
      // 정상 재조회 간격(초)
      queryIntervalSeconds: refundEnv.REFUND_QUERY_INTERVAL_SECONDS,
      // PG 전송·조회 응답 제한(초)
      pgTimeoutSeconds: refundEnv.REFUND_PG_TIMEOUT_SECONDS,
      // 작업자 처리 기한(초)
      workLeaseSeconds: refundEnv.REFUND_WORK_LEASE_SECONDS,
      // 조회 실패 후 첫 재조회 간격(초)
      queryBackoffSeconds: refundEnv.REFUND_QUERY_BACKOFF_SECONDS,
      // 지수 증가 조회 간격 상한(초)
      queryBackoffMaxSeconds: refundEnv.REFUND_QUERY_BACKOFF_MAX_SECONDS,
      // PG 취소 결과 확인 실패로 전환하는 연속 조회 오류 횟수
      queryFailureThreshold: refundEnv.REFUND_QUERY_FAILURE_THRESHOLD,
      // 장애 복구 확인용 1건 조회 간격(초)
      recoveryProbeSeconds: refundEnv.REFUND_RECOVERY_PROBE_SECONDS,
      // 일반·복구 조회 처리 단위(건)
      recoveryBatchSize: refundEnv.REFUND_RECOVERY_BATCH_SIZE,
      // 백그라운드 자동 재전송 한도(회). 최초 전송과 개별 확인에 따른 재전송은 제외
      resendLimit: refundEnv.REFUND_RESEND_LIMIT,
      // 별도 환불금 지급 예약 후 미확인 최초 알림 기준(초)
      manualConfirmAlertSeconds: refundEnv.REFUND_MANUAL_CONFIRM_ALERT_SECONDS,
      // 자동 조회·재전송·장애 복구 작업자 실행 여부(운영 기본 true, 테스트 환경은 false)
      recoveryWorkerEnabled:
        refundEnv.REFUND_RECOVERY_WORKER_ENABLED as unknown as boolean,
    },

    // PG 콜백 서명 검증 설정
    pgCallback: {
      // 콜백 서명 공유 비밀값(최소 32자, 검증 스키마에서 필수). 로그에 남기지 않는다
      secret: process.env.PG_CALLBACK_SECRET!,
      // 콜백 서명 시각 오차 허용(초)
      maxSkewSeconds: refundEnv.PG_CALLBACK_MAX_SKEW_SECONDS,
    },
  };
};
