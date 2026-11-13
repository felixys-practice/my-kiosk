import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PgCallbackDto } from './pg-callback.dto';

/**
 * 전역 ValidationPipe와 같은 옵션으로 검증해 오류가 난 필드 이름을 구한다
 * @param plain 요청 본문
 * @returns 오류 필드 이름 목록
 */
async function invalidFieldsOf(plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(PgCallbackDto, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe('결제 승인 콜백 DTO(PgCallbackDto)', () => {
  /** 형식이 올바른 승인 콜백 본문 */
  const validBody = {
    success: true,
    pgTransactionId: 'pg-tx-1',
    amount: 10000,
    reason: null,
  };

  it('승인 금액이 원 단위 정수가 아니면(1000.5) 형식 오류(400)다', async () => {
    expect(await invalidFieldsOf({ ...validBody, amount: 1000.5 })).toEqual([
      'amount',
    ]);
  });
});
