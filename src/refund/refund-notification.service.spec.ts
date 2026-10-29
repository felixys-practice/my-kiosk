import { notificationScope } from './refund-notification.repository';

describe('환불 알림 수신 범위', () => {
  it('U389 점주는 현재 소유 매장의 SHOP 범위 또는 자기 지정 수신 알림만 조회한다', () => {
    expect(notificationScope({ userId: 'owner', role: 'OWNER' })).toEqual({
      audience: 'SHOP',
      shop: { owners: { some: { userId: 'owner' } } },
      OR: [{ recipientUserId: null }, { recipientUserId: 'owner' }],
    });
  });
});
