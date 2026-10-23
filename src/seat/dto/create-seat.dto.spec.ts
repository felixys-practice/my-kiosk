import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSeatDto } from './create-seat.dto';
import { UpdateSeatDto } from './update-seat.dto';

/**
 * DTO 검증 오류가 난 필드 이름 목록을 구한다
 * @param cls DTO 클래스
 * @param plain 요청 본문
 * @returns 오류 필드 이름 목록
 */
async function errorFields<T extends object>(
  cls: new () => T,
  plain: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((error) => error.property);
}

describe('좌석 DTO 검증', () => {
  describe('CreateSeatDto', () => {
    it('좌석 타입이 없으면 오류다', async () => {
      await expect(
        errorFields(CreateSeatDto, { name: 'A1' }),
      ).resolves.toContain('type');
    });

    it('고정석·자유석 이외의 좌석 타입은 오류다', async () => {
      await expect(
        errorFields(CreateSeatDto, { type: 'VIP' }),
      ).resolves.toContain('type');
    });

    it.each(['FIXED', 'FREE'])('좌석 타입 %s는 통과한다', async (type) => {
      await expect(errorFields(CreateSeatDto, { type })).resolves.toEqual([]);
    });
  });

  describe('UpdateSeatDto', () => {
    it('좌석 타입은 선택 입력이고 고정석·자유석만 허용한다', async () => {
      await expect(errorFields(UpdateSeatDto, {})).resolves.toEqual([]);
      await expect(
        errorFields(UpdateSeatDto, { type: 'VIP' }),
      ).resolves.toContain('type');
    });

    it.each(['AVAILABLE', 'UNAVAILABLE'])(
      '좌석 상태 %s는 통과한다',
      async (status) => {
        await expect(errorFields(UpdateSeatDto, { status })).resolves.toEqual(
          [],
        );
      },
    );

    it('사용 가능·이용 불가 이외의 좌석 상태는 오류다', async () => {
      await expect(
        errorFields(UpdateSeatDto, { status: 'BROKEN' }),
      ).resolves.toContain('status');
    });
  });
});
