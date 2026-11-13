import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetRefundQueryDto } from './get-refund-query.dto';

describe('환불 목록 쿼리', () => {
  it('U387 표현 가능한 최대 페이지는 허용하고 안전한 정수 범위 밖 페이지는 거절한다', async () => {
    for (const [page, valid] of [
      ['1e308', false],
      ['100000000000000000000', false],
      [String(Number.MAX_SAFE_INTEGER + 1), false],
      [String(Number.MAX_SAFE_INTEGER), true],
    ] as const) {
      const errors = await validate(
        plainToInstance(GetRefundQueryDto, { page }),
      );
      expect({ page, valid: errors.length === 0 }).toEqual({ page, valid });
    }
  });
  it('U383 페이지와 크기·상태·조치 필터의 형식 오류를 거절한다', async () => {
    const invalidQueries = [
      { page: '0' },
      { page: '-1' },
      { page: '1.5' },
      { page: '' },
      { page: 'abc' },
      { limit: '1.5' },
      { limit: '-1' },
      { limit: ['1', '2'] },
      { payoutStatus: 'FAILED' },
      { decisionStatus: 'UNKNOWN' },
      { actionRequiredOnly: 'yes' },
      { actionRequiredOnly: ['true', 'false'] },
    ];
    for (const plain of invalidQueries) {
      const errors = await validate(plainToInstance(GetRefundQueryDto, plain), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect({ plain, valid: errors.length === 0 }).toEqual({
        plain,
        valid: false,
      });
    }
  });
  it('U245 본인 목록에 다른 userId를 주입하면 미허용 필드로 거절한다', async () => {
    const errors = await validate(
      plainToInstance(GetRefundQueryDto, { userId: 'other-customer' }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    expect(errors.map((error) => error.property)).toContain('userId');
  });
  it('U241 목록 크기 100은 허용한다', async () => {
    const query = plainToInstance(GetRefundQueryDto, { limit: '100' });
    expect({ limit: query.limit, errors: await validate(query) }).toEqual({
      limit: 100,
      errors: [],
    });
  });
  it('U243 목록 크기 0은 허용하지 않는다', async () => {
    const errors = await validate(
      plainToInstance(GetRefundQueryDto, { limit: '0' }),
    );
    expect(errors.map((error) => error.property)).toContain('limit');
  });
  it('U242 목록 크기 101은 허용하지 않는다', async () => {
    const errors = await validate(
      plainToInstance(GetRefundQueryDto, { limit: '101' }),
    );
    expect(errors.map((error) => error.property)).toContain('limit');
  });
  it('U240 페이지와 크기를 생략하면 첫 페이지의 20건을 조회한다', () => {
    const query = plainToInstance(GetRefundQueryDto, {});
    expect({ page: query.page, limit: query.limit }).toEqual({
      page: 1,
      limit: 20,
    });
  });
});
