import { validationSchema } from './validation.schema';

describe('validationSchema', () => {
  // 유효한 env 기본 세트 — 각 테스트에서 특정 키만 변경하여 사용
  const validEnv = {
    NODE_ENV: 'development',
    PORT: 3000,
    DATABASE_URL: 'postgresql://postgres:password@localhost:5432/db',
    JWT_SECRET: 'valid-secret-key',
    JWT_REFRESH_SECRET: 'valid-refresh-secret',
    // PG 콜백 서명 비밀값 — 최소 32자 (API 계약 §8)
    PG_CALLBACK_SECRET: 'test-pg-callback-secret-32-chars',
  };

  describe('유효한 환경변수', () => {
    it('필수 환경변수가 모두 제공되면 검증을 통과한다', () => {
      const { error } = validationSchema.validate(validEnv, {
        abortEarly: false,
      });
      expect(error).toBeUndefined();
    });

    it('PORT 미설정 시 기본값 3000으로 통과한다', () => {
      const { error, value } = validationSchema.validate(
        { ...validEnv, PORT: undefined },
        { abortEarly: false, allowUnknown: true },
      );
      expect(error).toBeUndefined();
      expect(value.PORT).toBe(3000);
    });

    it('REDIS_HOST 미설정 시 기본값 localhost로 통과한다', () => {
      const { error, value } = validationSchema.validate(
        { ...validEnv, REDIS_HOST: undefined },
        { abortEarly: false, allowUnknown: true },
      );
      expect(error).toBeUndefined();
      expect(value.REDIS_HOST).toBe('localhost');
    });

    it('REDIS_PASSWORD 빈 문자열은 통과한다', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, REDIS_PASSWORD: '' },
        { abortEarly: false },
      );
      expect(error).toBeUndefined();
    });
  });

  describe('필수 환경변수 누락', () => {
    it('DATABASE_URL 누락 시 오류를 반환한다', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, DATABASE_URL: undefined },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.details.some((d) => d.path.includes('DATABASE_URL'))).toBe(
        true,
      );
    });

    it('JWT_SECRET 누락 시 오류를 반환한다', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, JWT_SECRET: undefined },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.details.some((d) => d.path.includes('JWT_SECRET'))).toBe(
        true,
      );
    });

    it('여러 필수값 누락 시 모든 오류를 한 번에 반환한다 (abortEarly: false)', () => {
      const { error } = validationSchema.validate(
        {
          ...validEnv,
          DATABASE_URL: undefined,
          JWT_SECRET: undefined,
          JWT_REFRESH_SECRET: undefined,
        },
        { abortEarly: false },
      );
      expect(error?.details.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('제약 조건 검증', () => {
    it('허용되지 않는 NODE_ENV 값은 거부한다', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, NODE_ENV: 'staging' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
    });

    it.each(['development', 'production', 'test'])(
      'NODE_ENV=%s는 통과한다',
      (nodeEnv) => {
        const { error } = validationSchema.validate(
          { ...validEnv, NODE_ENV: nodeEnv },
          { abortEarly: false },
        );
        expect(error).toBeUndefined();
      },
    );
  });

  describe('고정석 선점 유효시간(SEAT_HOLD_MINUTES)', () => {
    it('미설정 시 기본값 10으로 통과한다', () => {
      const { error, value } = validationSchema.validate(validEnv, {
        abortEarly: false,
      });
      expect(error).toBeUndefined();
      expect(value.SEAT_HOLD_MINUTES).toBe(10);
    });

    it('1 이상의 정수는 통과한다', () => {
      const { error, value } = validationSchema.validate(
        { ...validEnv, SEAT_HOLD_MINUTES: 5 },
        { abortEarly: false },
      );
      expect(error).toBeUndefined();
      expect(value.SEAT_HOLD_MINUTES).toBe(5);
    });

    it.each([0, -1])('%s(1 미만)는 거부한다', (minutes) => {
      const { error } = validationSchema.validate(
        { ...validEnv, SEAT_HOLD_MINUTES: minutes },
        { abortEarly: false },
      );
      expect(
        error?.details.some((d) => d.path.includes('SEAT_HOLD_MINUTES')),
      ).toBe(true);
    });

    it('정수가 아닌 값은 거부한다', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, SEAT_HOLD_MINUTES: 1.5 },
        { abortEarly: false },
      );
      expect(
        error?.details.some((d) => d.path.includes('SEAT_HOLD_MINUTES')),
      ).toBe(true);
    });
  });

  describe('PG 콜백 서명 비밀값(PG_CALLBACK_SECRET)', () => {
    // API 계약 §8: 공유 서명 비밀값은 최소 32자
    const pgCallbackSecretMinLength = 32;

    it('PG_CALLBACK_SECRET이 없으면 필수값 누락으로 검증이 실패한다', () => {
      const env: Record<string, unknown> = { ...validEnv };
      delete env.PG_CALLBACK_SECRET;

      const { error } = validationSchema.validate(env, { abortEarly: false });

      expect(
        error?.details.find((d) => d.path.includes('PG_CALLBACK_SECRET'))?.type,
      ).toBe('any.required');
    });

    it('PG_CALLBACK_SECRET이 31자이면 검증이 실패한다', () => {
      const { error } = validationSchema.validate(
        {
          ...validEnv,
          PG_CALLBACK_SECRET: 'a'.repeat(pgCallbackSecretMinLength - 1),
        },
        { abortEarly: false },
      );

      expect(
        error?.details.find((d) => d.path.includes('PG_CALLBACK_SECRET'))?.type,
      ).toBe('string.min');
    });

    it('PG_CALLBACK_SECRET이 32자이면 검증을 통과한다', () => {
      const { error } = validationSchema.validate(
        {
          ...validEnv,
          PG_CALLBACK_SECRET: 'a'.repeat(pgCallbackSecretMinLength),
        },
        { abortEarly: false },
      );

      expect(error).toBeUndefined();
    });
  });

  describe('환불 PG 처리 설정(REFUND_*)', () => {
    // 양의 정수여야 하는 시간·횟수 설정 (API 계약 §8). REFUND_RESEND_LIMIT은 0 이상이라 제외
    const positiveIntegerKeys = [
      'REFUND_RESULT_WAIT_SECONDS',
      'REFUND_SWEEP_INTERVAL_SECONDS',
      'REFUND_QUERY_INTERVAL_SECONDS',
      'REFUND_PG_TIMEOUT_SECONDS',
      'REFUND_WORK_LEASE_SECONDS',
      'REFUND_QUERY_BACKOFF_SECONDS',
      'REFUND_QUERY_BACKOFF_MAX_SECONDS',
      'REFUND_QUERY_FAILURE_THRESHOLD',
      'REFUND_RECOVERY_PROBE_SECONDS',
      'REFUND_RECOVERY_BATCH_SIZE',
      'REFUND_MANUAL_CONFIRM_ALERT_SECONDS',
      'PG_CALLBACK_MAX_SKEW_SECONDS',
    ];

    it('REFUND_RESEND_LIMIT=0이면 검증을 통과한다', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, REFUND_RESEND_LIMIT: 0 },
        { abortEarly: false },
      );

      expect(error).toBeUndefined();
    });

    it('REFUND_RESEND_LIMIT=-1이면 검증이 실패한다', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, REFUND_RESEND_LIMIT: -1 },
        { abortEarly: false },
      );

      expect(
        error?.details.find((d) => d.path.includes('REFUND_RESEND_LIMIT'))
          ?.type,
      ).toBe('number.min');
    });

    it.each(positiveIntegerKeys)('%s=0이면 검증이 실패한다', (key) => {
      const { error } = validationSchema.validate(
        { ...validEnv, [key]: 0 },
        { abortEarly: false },
      );

      expect(error?.details.find((d) => d.path.includes(key))?.type).toBe(
        'number.min',
      );
    });

    // 처리 기한은 PG 응답 제한(최소 1)보다 커야 하고, 정상 재조회 간격은 탐색 주기+응답 제한(최소 2) 이상이어야 하므로
    // 두 설정은 1이 될 수 없다 (API 계약 §8). 하한은 설정 간 관계 검증에서 확인한다
    const keysAllowingOne = positiveIntegerKeys.filter(
      (key) =>
        key !== 'REFUND_WORK_LEASE_SECONDS' &&
        key !== 'REFUND_QUERY_INTERVAL_SECONDS',
    );
    // 조회 간격 상한은 첫 재조회 간격 이상이어야 하므로 1을 확인할 때 첫 간격도 1로 둔다
    const companionsForOne: Record<string, Record<string, number>> = {
      REFUND_QUERY_BACKOFF_MAX_SECONDS: { REFUND_QUERY_BACKOFF_SECONDS: 1 },
    };

    it.each(keysAllowingOne)('%s=1이면 검증을 통과한다', (key) => {
      const { error } = validationSchema.validate(
        { ...validEnv, ...companionsForOne[key], [key]: 1 },
        { abortEarly: false },
      );

      expect(error).toBeUndefined();
    });

    it.each([...positiveIntegerKeys, 'REFUND_RESEND_LIMIT'])(
      '%s가 소수 1.5이면 검증이 실패한다',
      (key) => {
        const { error } = validationSchema.validate(
          { ...validEnv, [key]: 1.5 },
          { abortEarly: false },
        );

        expect(error?.details.find((d) => d.path.includes(key))?.type).toBe(
          'number.integer',
        );
      },
    );

    it('REFUND_WORK_LEASE_SECONDS가 REFUND_PG_TIMEOUT_SECONDS와 같으면 검증이 실패한다', () => {
      const { error } = validationSchema.validate(
        {
          ...validEnv,
          REFUND_PG_TIMEOUT_SECONDS: 10,
          REFUND_WORK_LEASE_SECONDS: 10,
        },
        { abortEarly: false },
      );

      expect(
        error?.details.find((d) => d.path.includes('REFUND_WORK_LEASE_SECONDS'))
          ?.type,
      ).toBe('number.greater');
    });

    it('REFUND_WORK_LEASE_SECONDS가 REFUND_PG_TIMEOUT_SECONDS보다 1 크면 검증을 통과한다', () => {
      const { error } = validationSchema.validate(
        {
          ...validEnv,
          REFUND_PG_TIMEOUT_SECONDS: 10,
          REFUND_WORK_LEASE_SECONDS: 11,
        },
        { abortEarly: false },
      );

      expect(error).toBeUndefined();
    });

    it('REFUND_QUERY_INTERVAL_SECONDS가 SWEEP+TIMEOUT보다 1 작으면 검증이 실패한다', () => {
      const { error } = validationSchema.validate(
        {
          ...validEnv,
          REFUND_SWEEP_INTERVAL_SECONDS: 5,
          REFUND_PG_TIMEOUT_SECONDS: 10,
          REFUND_QUERY_INTERVAL_SECONDS: 14,
        },
        { abortEarly: false },
      );

      expect(
        error?.details.find((d) =>
          d.path.includes('REFUND_QUERY_INTERVAL_SECONDS'),
        )?.type,
      ).toBe('number.min');
    });

    it('REFUND_QUERY_INTERVAL_SECONDS가 SWEEP+TIMEOUT과 같으면 검증을 통과한다', () => {
      const { error } = validationSchema.validate(
        {
          ...validEnv,
          REFUND_SWEEP_INTERVAL_SECONDS: 5,
          REFUND_PG_TIMEOUT_SECONDS: 10,
          REFUND_QUERY_INTERVAL_SECONDS: 15,
        },
        { abortEarly: false },
      );

      expect(error).toBeUndefined();
    });

    it('REFUND_QUERY_BACKOFF_MAX_SECONDS가 REFUND_QUERY_BACKOFF_SECONDS보다 1 작으면 검증이 실패한다', () => {
      const { error } = validationSchema.validate(
        {
          ...validEnv,
          REFUND_QUERY_BACKOFF_SECONDS: 15,
          REFUND_QUERY_BACKOFF_MAX_SECONDS: 14,
        },
        { abortEarly: false },
      );

      expect(
        error?.details.find((d) =>
          d.path.includes('REFUND_QUERY_BACKOFF_MAX_SECONDS'),
        )?.type,
      ).toBe('number.min');
    });
  });
});
