import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StoreRefundDto } from './store-refund.dto';

/**
 * 전역 ValidationPipe와 같은 옵션으로 검증해 오류 필드별 제약 이름을 구한다
 * @param plain 요청 본문
 * @returns 필드 이름 → 어긴 제약 이름 목록
 */
async function constraintsOf(plain: object): Promise<Record<string, string[]>> {
  const errors = await validate(plainToInstance(StoreRefundDto, plain), {
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

describe('매장 환불 요청 DTO(StoreRefundDto)', () => {
  /** 형식이 올바른 요청 본문 */
  const validBody = {
    ticketId: '2d0f2c7a-6f62-4f5c-9b1a-0f8d2d3c4b5a',
    amount: 5000,
    reason: '서비스 불만 보상',
    consentToTerminateTicket: true,
  };

  it('매장 환불 금액이 -1이면 형식 오류(400)다', async () => {
    const constraints = await constraintsOf({ ...validBody, amount: -1 });

    expect(Object.keys(constraints)).toEqual(['amount']);
  });
  it('매장 환불 금액이 소수이면 형식 오류(400)다', async () => {
    const constraints = await constraintsOf({ ...validBody, amount: 1000.5 });

    expect(Object.keys(constraints)).toEqual(['amount']);
  });
  it('앞뒤 공백을 지운 사유가 500자이면 허용된다', async () => {
    await expect(
      constraintsOf({ ...validBody, reason: `  ${'가'.repeat(500)}  ` }),
    ).resolves.toEqual({});
  });

  it('앞뒤 공백을 지운 사유가 501자이면 형식 오류(400)다', async () => {
    const constraints = await constraintsOf({
      ...validBody,
      reason: `  ${'가'.repeat(501)}  `,
    });

    expect(Object.keys(constraints)).toEqual(['reason']);
  });
});
