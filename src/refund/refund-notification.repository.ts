import { Injectable } from '@nestjs/common';
import type { Prisma, RefundNotification } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetRefundNotificationQueryDto } from './dto/get-refund-notification-query.dto';
import type { RefundActor } from './refund-access.service';

export type NotificationRow = RefundNotification & {
  receipts: { readAt: Date }[];
};

@Injectable()
export class RefundNotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actor: RefundActor,
    query: GetRefundNotificationQueryDto,
  ): Promise<{ items: NotificationRow[]; total: number }> {
    const conditions: Prisma.RefundNotificationWhereInput[] = [
      notificationScope(actor),
    ];
    if (query.unreadOnly)
      conditions.push({ receipts: { none: { userId: actor.userId } } });
    const where: Prisma.RefundNotificationWhereInput = { AND: conditions };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.refundNotification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          receipts: {
            where: { userId: actor.userId },
            select: { readAt: true },
          },
        },
      }),
      this.prisma.refundNotification.count({ where }),
    ]);
    return { items, total };
  }
}

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
