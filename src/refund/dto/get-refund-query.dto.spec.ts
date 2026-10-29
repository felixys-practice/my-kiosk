import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetRefundQueryDto } from './get-refund-query.dto';

describe('환불 목록 쿼리', () => {
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
