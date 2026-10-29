import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { GetRefundQueryDto } from './get-refund-query.dto';

describe('환불 목록 쿼리', () => {
  it('U240 페이지와 크기를 생략하면 첫 페이지의 20건을 조회한다', () => {
    const query = plainToInstance(GetRefundQueryDto, {});
    expect({ page: query.page, limit: query.limit }).toEqual({
      page: 1,
      limit: 20,
    });
  });
});
