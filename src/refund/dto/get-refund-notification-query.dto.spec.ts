import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetRefundNotificationQueryDto } from './get-refund-notification-query.dto';

describe('환불 알림 쿼리', () => {
  it('U392 기본값은 첫 페이지 20건·전체 읽음이며 잘못된 형식을 거절한다', async () => {
    const defaults = plainToInstance(GetRefundNotificationQueryDto, {});
    expect({
      page: defaults.page,
      limit: defaults.limit,
      unreadOnly: defaults.unreadOnly,
    }).toEqual({ page: 1, limit: 20, unreadOnly: false });
    for (const [plain, valid] of [
      [{ limit: '100', unreadOnly: 'true', audience: 'SHOP' }, true],
      [{ unreadOnly: 'false' }, true],
      [{ page: '0' }, false],
      [{ page: '1e308' }, false],
      [{ page: '1.5' }, false],
      [{ limit: '0' }, false],
      [{ limit: '101' }, false],
      [{ unreadOnly: 'yes' }, false],
      [{ audience: 'USER' }, false],
      [{ userId: 'other' }, false],
    ] as const) {
      const query = plainToInstance(GetRefundNotificationQueryDto, plain);
      const errors = await validate(query, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect({ plain, valid: errors.length === 0 }).toEqual({ plain, valid });
    }
  });
});
