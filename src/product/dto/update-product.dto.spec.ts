import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProductDto } from './update-product.dto';

/**
 * 상품 수정 DTO를 검증한다
 * @param plain 요청 본문
 * @returns 검증 오류 목록
 */
async function validateUpdate(plain: object) {
  const dto = plainToInstance(UpdateProductDto, plain);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('UpdateProductDto', () => {
  it('좌석 타입이 고정석·자유석 이외면 isEnum 오류다', async () => {
    const errors = await validateUpdate({ seatType: 'VIP' });

    const seatTypeError = errors.find((e) => e.property === 'seatType');
    expect(seatTypeError?.constraints).toHaveProperty('isEnum');
  });

  it('좌석 타입만 보내도 오류가 없다', async () => {
    const errors = await validateUpdate({ seatType: 'FIXED' });

    expect(errors).toEqual([]);
  });

  it('이용권 종류(type)를 보내면 whitelist 오류다', async () => {
    const errors = await validateUpdate({ type: 'TIME' });

    const typeError = errors.find((e) => e.property === 'type');
    expect(typeError?.constraints).toHaveProperty('whitelistValidation');
  });
});
