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
  REFUND_RESEND_LIMIT: Joi.number().min(0), // 백그라운드 자동 재전송 한도(회), 0 이상

  // PG 콜백
  PG_CALLBACK_SECRET: Joi.string().min(32).required(), // 공유 서명 비밀값(최소 32자), 기본값 없음
});
