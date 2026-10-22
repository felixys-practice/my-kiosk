import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangeTicketSeatDto } from './change-ticket-seat.dto';

/**
 * 이용권 좌석 변경 DTO를 검증하고 속성별 오류 제약을 돌려준다
 * @param plain 요청 본문
 * @param property 확인할 속성
 * @returns 해당 속성의 오류 제약(없으면 undefined)
 */
async function constraintsOf(plain: object, property: string) {
  const dto = plainToInstance(ChangeTicketSeatDto, plain);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.find((e) => e.property === property)?.constraints;
}

describe('ChangeTicketSeatDto', () => {
  it('좌석 타입이 없거나 고정석·자유석 이외면 isEnum 오류다', async () => {
    expect(await constraintsOf({ reason: '요청' }, 'seatType')).toHaveProperty(
      'isEnum',
    );
    expect(
      await constraintsOf({ seatType: 'VIP', reason: '요청' }, 'seatType'),
    ).toHaveProperty('isEnum');
  });

  it('좌석 타입이 고정석인데 좌석 ID가 없으면 isUuid 오류다', async () => {
    expect(
      await constraintsOf({ seatType: 'FIXED', reason: '요청' }, 'seatId'),
    ).toHaveProperty('isUuid');
  });

  it('변경 사유가 없으면 isNotEmpty 오류다', async () => {
    expect(await constraintsOf({ seatType: 'FREE' }, 'reason')).toHaveProperty(
      'isNotEmpty',
    );
  });

  it('변경 사유가 500자를 넘으면 maxLength 오류다', async () => {
    expect(
      await constraintsOf(
        { seatType: 'FREE', reason: 'a'.repeat(501) },
        'reason',
      ),
    ).toHaveProperty('maxLength');
  });
});
