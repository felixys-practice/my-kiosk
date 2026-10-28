import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RetryRefundDto } from './retry-refund.dto';

/**
 * 전역 ValidationPipe와 같은 옵션으로 검증해 오류가 난 필드 이름을 구한다
 * @param plain 요청 본문
 * @returns 오류 필드 이름 목록
 */
async function invalidFieldsOf(plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(RetryRefundDto, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe('PG 직접 재시도 요청 DTO(RetryRefundDto)', () => {
  it('앞뒤 공백을 지운 재시도 사유가 0자이면 형식 오류(400)다', async () => {
    expect(await invalidFieldsOf({ reason: '   ' })).toEqual(['reason']);
  });

  it('앞뒤 공백을 지운 재시도 사유가 500자이면 허용된다', async () => {
    expect(await invalidFieldsOf({ reason: ` ${'가'.repeat(500)} ` })).toEqual(
      [],
    );
  });

  it('앞뒤 공백을 지운 재시도 사유가 501자이면 형식 오류(400)다', async () => {
    expect(await invalidFieldsOf({ reason: 'a'.repeat(501) })).toEqual([
      'reason',
    ]);
  });
});
