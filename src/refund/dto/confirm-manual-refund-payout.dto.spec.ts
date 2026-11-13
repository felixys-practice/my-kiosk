import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmManualPayoutDto } from './confirm-manual-refund-payout.dto';

/**
 * 전역 ValidationPipe와 같은 옵션으로 검증해 오류가 난 필드 이름을 구한다
 * @param plain 요청 본문
 * @returns 오류 필드 이름 목록
 */
async function invalidFieldsOf(plain: object): Promise<string[]> {
  const errors = await validate(
    plainToInstance(ConfirmManualPayoutDto, plain),
    { whitelist: true, forbidNonWhitelisted: true },
  );
  return errors.map((error) => error.property);
}

describe('별도 환불금 지급 결과 등록 DTO(ConfirmManualPayoutDto)', () => {
  /** 형식이 올바른 등록 본문 */
  const validBody = {
    amount: 12000,
    paidAt: '2026-10-28T09:00:00.000Z',
    externalTransactionId: 'bank-0001',
    evidenceReference: '이체 확인증',
  };

  it('실제 지급 시각이 미래이면 형식 오류(400)다', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();

    expect(await invalidFieldsOf({ ...validBody, paidAt: future })).toEqual([
      'paidAt',
    ]);
  });

  it('실제 지급 거래 식별자 200자는 허용된다', async () => {
    expect(
      await invalidFieldsOf({
        ...validBody,
        externalTransactionId: 'a'.repeat(200),
      }),
    ).toEqual([]);
  });

  it('실제 지급 거래 식별자 201자는 형식 오류(400)다', async () => {
    expect(
      await invalidFieldsOf({
        ...validBody,
        externalTransactionId: 'a'.repeat(201),
      }),
    ).toEqual(['externalTransactionId']);
  });

  it.each([0, false])(
    '실제 지급 시각이 ISO 시각 문자열이 아니면(%p) 형식 오류(400)다',
    async (paidAt) => {
      expect(await invalidFieldsOf({ ...validBody, paidAt })).toEqual([
        'paidAt',
      ]);
    },
  );

  it.each(['2026-01-01', '2026-01-01T12:30:00'])(
    '실제 지급 시각에 시각이나 시간대가 없으면(%p) 형식 오류(400)다',
    async (paidAt) => {
      expect(await invalidFieldsOf({ ...validBody, paidAt })).toEqual([
        'paidAt',
      ]);
    },
  );

  it('시간대가 붙은 지급 시각(+09:00)은 같은 순간의 날짜로 받는다', async () => {
    const dto = plainToInstance(ConfirmManualPayoutDto, {
      ...validBody,
      paidAt: '2026-10-28T18:00:00+09:00',
    });

    expect({
      errors: (await validate(dto)).length,
      paidAt: dto.paidAt.toISOString(),
    }).toEqual({ errors: 0, paidAt: '2026-10-28T09:00:00.000Z' });
  });
});
