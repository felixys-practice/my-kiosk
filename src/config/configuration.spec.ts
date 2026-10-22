import configuration from './configuration';

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // 각 테스트 전에 env를 초기 상태로 복원
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('app 섹션', () => {
    it('NODE_ENV 미설정 시 development를 기본값으로 반환한다', () => {
      delete process.env.NODE_ENV;
      expect(configuration().app.nodeEnv).toBe('development');
    });

    it('PORT 미설정 시 3000을 기본값으로 반환한다', () => {
      delete process.env.PORT;
      expect(configuration().app.port).toBe(3000);
    });

    it('PORT가 설정된 경우 숫자로 변환하여 반환한다', () => {
      process.env.PORT = '8080';
      const config = configuration();
      expect(config.app.port).toBe(8080);
      expect(typeof config.app.port).toBe('number');
    });
  });

  describe('database 섹션', () => {
    it('DATABASE_URL이 설정된 경우 해당 값을 반환한다', () => {
      process.env.DATABASE_URL = 'postgresql://test';
      expect(configuration().database.postgres.url).toBe('postgresql://test');
    });

    it('REDIS_HOST 미설정 시 localhost를 기본값으로 반환한다', () => {
      delete process.env.REDIS_HOST;
      expect(configuration().database.redis.host).toBe('localhost');
    });

    it('REDIS_PORT 미설정 시 6379를 기본값으로 반환한다', () => {
      delete process.env.REDIS_PORT;
      expect(configuration().database.redis.port).toBe(6379);
    });

    it('REDIS_PASSWORD 미설정 시 undefined를 반환한다', () => {
      delete process.env.REDIS_PASSWORD;
      expect(configuration().database.redis.password).toBeUndefined();
    });
  });

  describe('jwt 섹션', () => {
    it('JWT_SECRET이 설정된 경우 해당 값을 반환한다', () => {
      process.env.JWT_SECRET = 'test-secret-key';
      expect(configuration().jwt.secret).toBe('test-secret-key');
    });

    it('JWT_SECRET 미설정 시 undefined를 반환한다 (joi가 앱 기동 시 차단)', () => {
      delete process.env.JWT_SECRET;
      expect(configuration().jwt.secret).toBeUndefined();
    });

    it('JWT_ACCESS_EXPIRES_MINUTES 미설정 시 기본값 15를 반환한다', () => {
      delete process.env.JWT_ACCESS_EXPIRES_MINUTES;
      expect(configuration().jwt.accessExpiresMinutes).toBe(15);
    });

    it('JWT_REFRESH_EXPIRES_DAYS 미설정 시 기본값 7을 반환한다', () => {
      delete process.env.JWT_REFRESH_EXPIRES_DAYS;
      expect(configuration().jwt.refreshExpiresDays).toBe(7);
    });
  });

  describe('seat 섹션', () => {
    it('SEAT_HOLD_MINUTES 미설정 시 10을 기본값으로 반환한다', () => {
      delete process.env.SEAT_HOLD_MINUTES;
      expect(configuration().seat.holdMinutes).toBe(10);
    });

    it('SEAT_HOLD_MINUTES가 설정된 경우 숫자로 변환하여 반환한다', () => {
      process.env.SEAT_HOLD_MINUTES = '15';
      const config = configuration();
      expect(config.seat.holdMinutes).toBe(15);
      expect(typeof config.seat.holdMinutes).toBe('number');
    });
  });

  describe('네임스페이스 구조', () => {
    it('app 네임스페이스 키가 모두 존재한다', () => {
      const config = configuration();
      expect(config).toHaveProperty('app.nodeEnv');
      expect(config).toHaveProperty('app.port');
    });

    it('database 네임스페이스 키가 모두 존재한다', () => {
      const config = configuration();
      expect(config).toHaveProperty('database.postgres.url');
      expect(config).toHaveProperty('database.redis.host');
      expect(config).toHaveProperty('database.redis.port');
    });

    it('jwt 네임스페이스 키가 모두 존재한다', () => {
      const config = configuration();
      expect(config).toHaveProperty('jwt.secret');
      expect(config).toHaveProperty('jwt.accessExpiresMinutes');
      expect(config).toHaveProperty('jwt.refreshSecret');
      expect(config).toHaveProperty('jwt.refreshExpiresDays');
    });
  });
});
