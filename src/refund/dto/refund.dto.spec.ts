import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RefundDto } from './refund.dto';

/**
 * 전역 ValidationPipe와 같은 옵션으로 검증해 오류 필드별 제약 이름을 구한다
 * @param plain 요청 본문
 * @returns 필드 이름 → 어긴 제약 이름 목록
 */
async function constraintsOf(plain: object): Promise<Record<string, string[]>> {
  const errors = await validate(plainToInstance(RefundDto, plain), {
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

describe('고객 환불 요청 DTO(RefundDto)', () => {
  const ticketId = '2d0f2c7a-6f62-4f5c-9b1a-0f8d2d3c4b5a';

  it('종료 동의가 문자열 "true"이면 boolean 형식 오류다', async () => {
    await expect(
      constraintsOf({ ticketId, consentToTerminateTicket: 'true' }),
    ).resolves.toEqual({ consentToTerminateTicket: ['isBoolean'] });
  });

  it('ticketId가 UUID 형식이 아니면 오류다', async () => {
    await expect(
      constraintsOf({ ticketId: 'ticket-1', consentToTerminateTicket: true }),
    ).resolves.toEqual({ ticketId: ['isUuid'] });
  });

  it.each(['amount', 'userId', 'shopId'])(
    '본문에 %s를 넣으면 허용하지 않는 필드로 오류다',
    async (field) => {
      await expect(
        constraintsOf({
          ticketId,
          consentToTerminateTicket: true,
          [field]: field === 'amount' ? 1000 : ticketId,
        }),
      ).resolves.toEqual({ [field]: ['whitelistValidation'] });
    },
  );
});
