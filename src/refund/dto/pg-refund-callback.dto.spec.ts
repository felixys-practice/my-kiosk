import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PgRefundCallbackDto } from './pg-refund-callback.dto';

/**
 * 전역 ValidationPipe와 같은 옵션으로 검증해 오류 필드별 제약 이름을 구한다
 * @param plain 콜백 본문
 * @returns 필드 이름 → 어긴 제약 이름 목록
 */
async function constraintsOf(plain: object): Promise<Record<string, string[]>> {
  const errors = await validate(plainToInstance(PgRefundCallbackDto, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return Object.fromEntries(
    errors.map((error) => [
      error.property,
      Object.keys(error.constraints ?? {}),
    ]),
  );
}

describe('PG 취소 결과 콜백 DTO(PgRefundCallbackDto)', () => {
  /** 형식이 올바른 성공 콜백 본문 */
  const validBody = {
    success: true,
    paymentCancelId: '2d0f2c7a-6f62-4f5c-9b1a-0f8d2d3c4b5a',
    pgTransactionId: 'pg-cancel-1',
    amount: 5000,
    reason: null,
  };

  it('amount가 정수가 아니면 형식 오류다', async () => {
    const constraints = await constraintsOf({ ...validBody, amount: 1.5 });

    expect(Object.keys(constraints)).toEqual(['amount']);
  });

  it('paymentCancelId만으로 대상을 지정한 콜백을 허용한다', async () => {
    await expect(constraintsOf(validBody)).resolves.toEqual({});
  });

  it('제거된 orderItemId 필드를 보내면 허용하지 않는다', async () => {
    expect(
      await constraintsOf({
        ...validBody,
        orderItemId: '7a1e9b3c-2d4f-4a6b-8c0d-1e2f3a4b5c6d',
      }),
    ).toEqual({ orderItemId: ['whitelistValidation'] });
  });
});
