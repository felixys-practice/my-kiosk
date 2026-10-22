import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from './create-order.dto';

describe('CreateOrderDto', () => {
  /** 유효한 기본 요청 */
  const base = {
    shopId: '6f1c2c1e-6c0b-4c55-9a1f-1a2b3c4d5e6f',
    userId: '7a2d3e4f-5b6c-4d7e-8f90-1a2b3c4d5e6f',
  };

  it('주문 항목의 좌석 ID가 UUID가 아니면 오류다', async () => {
    const dto = plainToInstance(CreateOrderDto, {
      ...base,
      orderedProducts: [
        {
          productId: '8b3e4f5a-6c7d-4e8f-9a01-1a2b3c4d5e6f',
          quantity: 1,
          seatId: 'abc',
        },
      ],
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    const itemError = errors
      .find((e) => e.property === 'orderedProducts')
      ?.children?.[0]?.children?.find((c) => c.property === 'seatId');
    expect(itemError?.constraints).toHaveProperty('isUuid');
  });
});
