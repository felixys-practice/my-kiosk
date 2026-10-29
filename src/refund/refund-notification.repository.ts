import type { Prisma } from '@prisma/client';
import type { RefundActor } from './refund-access.service';

export function notificationScope(
  actor: RefundActor,
): Prisma.RefundNotificationWhereInput {
  if (actor.role === 'MANAGER')
    return {
      audience: 'OPERATOR',
      OR: [{ recipientUserId: null }, { recipientUserId: actor.userId }],
    };
  if (actor.role === 'USER')
    return {
      audience: 'CUSTOMER',
      recipientUserId: actor.userId,
      refund: { payment: { order: { userId: actor.userId } } },
    };
  if (actor.role === 'OWNER')
    return {
      audience: 'SHOP',
      shop: { owners: { some: { userId: actor.userId } } },
      OR: [{ recipientUserId: null }, { recipientUserId: actor.userId }],
    };
  return { id: { in: [] } };
}
