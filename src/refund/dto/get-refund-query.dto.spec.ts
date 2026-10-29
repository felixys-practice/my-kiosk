import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetRefundQueryDto } from './get-refund-query.dto';

describe('환불 목록 쿼리', () => {
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
