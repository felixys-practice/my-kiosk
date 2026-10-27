import * as Joi from 'joi';

/**
 * 환불 설정 사이의 관계를 기본값이 모두 채워진 최종 설정으로 검사한다.
 * 키 단위 규칙은 값이 생략돼 기본값이 들어간 키에는 실행되지 않으므로,
 * 한쪽 설정만 바꿔도 관계가 깨지는 경우를 잡으려면 객체 단위로 검사해야 한다.
 * @param env 기본값과 숫자 변환이 적용된 환경 변수 객체
 * @param helpers Joi custom 도우미
 * @returns 관계를 만족하면 env 그대로, 아니면 위반한 키 경로의 오류
 */
function checkRefundRelations(
  env: Record<string, number>,
  helpers: Joi.CustomHelpers,
) {
  // 작업자 처리 기한은 PG 응답 제한보다 길어야 응답 대기 중 다른 작업자가 같은 작업을 가져가지 않는다
  const lease = env.REFUND_WORK_LEASE_SECONDS;
  const timeout = env.REFUND_PG_TIMEOUT_SECONDS;
  if (!(lease > timeout)) {
    return helpers.error(
      'number.greater',
      { label: 'REFUND_WORK_LEASE_SECONDS', limit: timeout, value: lease },
      { ...helpers.state, path: ['REFUND_WORK_LEASE_SECONDS'] },
    );
  }
  // 정상 재조회 간격은 탐색 주기+PG 응답 제한 이상이어야 앞선 조회가 끝나기 전에 다음 조회가 잡히지 않는다
  const interval = env.REFUND_QUERY_INTERVAL_SECONDS;
  const minInterval = env.REFUND_SWEEP_INTERVAL_SECONDS + timeout;
  if (interval < minInterval) {
    return helpers.error(
      'number.min',
      {
        label: 'REFUND_QUERY_INTERVAL_SECONDS',
        limit: minInterval,
        value: interval,
      },
      { ...helpers.state, path: ['REFUND_QUERY_INTERVAL_SECONDS'] },
    );
  }
  // 지수 증가 조회 간격 상한은 첫 재조회 간격 이상이어야 한다
  const backoffMax = env.REFUND_QUERY_BACKOFF_MAX_SECONDS;
  const backoff = env.REFUND_QUERY_BACKOFF_SECONDS;
  if (backoffMax < backoff) {
    return helpers.error(
      'number.min',
      {
        label: 'REFUND_QUERY_BACKOFF_MAX_SECONDS',
        limit: backoff,
        value: backoffMax,
      },
      { ...helpers.state, path: ['REFUND_QUERY_BACKOFF_MAX_SECONDS'] },
    );
  }
  return env;
}

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
  REFUND_RESULT_WAIT_SECONDS: Joi.number().integer().min(1).default(60), // 응답 없는 PG 취소 요청의 최초 조회 대기(초)
  REFUND_SWEEP_INTERVAL_SECONDS: Joi.number().integer().min(1).default(5), // 전송·조회 예정 작업 탐색 주기(초)
  REFUND_PG_TIMEOUT_SECONDS: Joi.number().integer().min(1).default(10), // PG 전송·조회 응답 제한(초)
  // 정상 재조회 간격(초). 탐색 주기+PG 응답 제한 이상이어야 한다(관계 검증은 아래 checkRefundRelations)
  REFUND_QUERY_INTERVAL_SECONDS: Joi.number().integer().min(1).default(15),
  // 작업자 처리 기한(초). PG 응답 제한보다 길어야 한다(관계 검증은 아래 checkRefundRelations)
  REFUND_WORK_LEASE_SECONDS: Joi.number().integer().min(1).default(30),
  REFUND_QUERY_BACKOFF_SECONDS: Joi.number().integer().min(1).default(15), // 조회 실패 후 첫 재조회 간격(초)
  // 지수 증가 조회 간격 상한(초). 첫 재조회 간격 이상이어야 한다(관계 검증은 아래 checkRefundRelations)
  REFUND_QUERY_BACKOFF_MAX_SECONDS: Joi.number().integer().min(1).default(300),
  REFUND_QUERY_FAILURE_THRESHOLD: Joi.number().integer().min(1).default(5), // 결과 확인 실패 전환 연속 오류 횟수
  REFUND_RECOVERY_PROBE_SECONDS: Joi.number().integer().min(1).default(900), // 장애 복구 확인용 1건 조회 간격(초)
  REFUND_RECOVERY_BATCH_SIZE: Joi.number().integer().min(1).default(20), // 일반·복구 조회 처리 단위(건)
  REFUND_RESEND_LIMIT: Joi.number().integer().min(0).default(3), // 백그라운드 자동 재전송 한도(회), 0 이상
  REFUND_MANUAL_CONFIRM_ALERT_SECONDS: Joi.number()
    .integer()
    .min(1)
    .default(3600), // 별도 환불금 지급 예약 후 미확인 최초 알림 기준(초)

  // PG 콜백
  PG_CALLBACK_MAX_SKEW_SECONDS: Joi.number().integer().min(1).default(300), // 콜백 서명 시각 오차 허용(초)
  PG_CALLBACK_SECRET: Joi.string().min(32).required(), // 공유 서명 비밀값(최소 32자), 기본값 없음
})
  .custom(checkRefundRelations)
  .messages({
    'number.greater': '{{#label}} must be greater than {{#limit}}',
    'number.min': '{{#label}} must be greater than or equal to {{#limit}}',
  });
