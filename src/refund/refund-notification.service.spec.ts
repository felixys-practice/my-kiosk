import { notificationScope } from './refund-notification.repository';

describe('환불 알림 수신 범위', () => {
  it('U391 운영자는 운영자 범위 발송 또는 자기 지정 수신 알림만 조회한다', () => {
    expect(notificationScope({ userId: 'manager', role: 'MANAGER' })).toEqual({
      audience: 'OPERATOR',
      OR: [{ recipientUserId: null }, { recipientUserId: 'manager' }],
    });
  });
  it('U390 고객은 본인 주문에 대해 본인을 수신자로 지정한 알림만 조회한다', () => {
    expect(notificationScope({ userId: 'customer', role: 'USER' })).toEqual({
      audience: 'CUSTOMER',
      recipientUserId: 'customer',
      refund: { payment: { order: { userId: 'customer' } } },
    });
  });
  it('U389 점주는 현재 소유 매장의 SHOP 범위 또는 자기 지정 수신 알림만 조회한다', () => {
    expect(notificationScope({ userId: 'owner', role: 'OWNER' })).toEqual({
      audience: 'SHOP',
      shop: { owners: { some: { userId: 'owner' } } },
      OR: [{ recipientUserId: null }, { recipientUserId: 'owner' }],
    });
  });
});
