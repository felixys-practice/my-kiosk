import * as Joi from 'joi';

/**
 * 환경 변수 유효성 검사 스키마
 * - 필수 환경 변수 체크 (.required())
 * - 타입 및 형식 검증
 * - 기본값 제공 (.default())
 */
export const validationSchema = Joi.object({
  // 애플리케이션
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  // PostgreSQL
  DATABASE_URL: Joi.string().required(),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().optional().allow(''),

  // JWT
  JWT_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRES_MINUTES: Joi.number().default(15),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRES_DAYS: Joi.number().default(7),

  // Idempotency
  IDEMPOTENCY_KEY_TTL_SECONDS: Joi.number().default(600), // 기본값 10분

  // 좌석
  SEAT_HOLD_MINUTES: Joi.number().integer().min(1).default(10), // 고정석 선점 유효시간(분), 기본값 10분

  // 환불 PG 요청·조회·복구 (API 계약 §8 운영 설정)
  REFUND_RESULT_WAIT_SECONDS: Joi.number().min(1), // 응답 없는 PG 취소 요청의 최초 조회 대기(초)
  REFUND_SWEEP_INTERVAL_SECONDS: Joi.number().min(1), // 전송·조회 예정 작업 탐색 주기(초)
  REFUND_QUERY_INTERVAL_SECONDS: Joi.number().min(1), // 정상 재조회 간격(초)
  REFUND_PG_TIMEOUT_SECONDS: Joi.number().min(1), // PG 전송·조회 응답 제한(초)
  REFUND_WORK_LEASE_SECONDS: Joi.number().min(1), // 작업자 처리 기한(초)
  REFUND_QUERY_BACKOFF_SECONDS: Joi.number().min(1), // 조회 실패 후 첫 재조회 간격(초)
  REFUND_QUERY_BACKOFF_MAX_SECONDS: Joi.number().min(1), // 지수 증가 조회 간격 상한(초)
  REFUND_QUERY_FAILURE_THRESHOLD: Joi.number().min(1), // 결과 확인 실패 전환 연속 오류 횟수
  REFUND_RECOVERY_PROBE_SECONDS: Joi.number().min(1), // 장애 복구 확인용 1건 조회 간격(초)
  REFUND_RECOVERY_BATCH_SIZE: Joi.number().min(1), // 일반·복구 조회 처리 단위(건)
  REFUND_RESEND_LIMIT: Joi.number().min(0), // 백그라운드 자동 재전송 한도(회), 0 이상
  REFUND_MANUAL_CONFIRM_ALERT_SECONDS: Joi.number().min(1), // 별도 환불금 지급 예약 후 미확인 최초 알림 기준(초)

  // PG 콜백
  PG_CALLBACK_MAX_SKEW_SECONDS: Joi.number().min(1), // 콜백 서명 시각 오차 허용(초)
  PG_CALLBACK_SECRET: Joi.string().min(32).required(), // 공유 서명 비밀값(최소 32자), 기본값 없음
});
