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
});
