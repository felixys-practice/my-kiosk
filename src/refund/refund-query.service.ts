import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { RefundActor } from './refund-access.service';
import {
  RefundForbiddenError,
  RefundNotFoundError,
  ShopNotFoundError,
  RefundUserNotFoundError,
} from './errors';
import { RefundQueryRepository } from './refund-query.repository';
import { GetRefundQueryDto } from './dto/get-refund-query.dto';
import { PaginationUtil } from 'src/common/pagination/pagination.util';
import { RefundResponseDto } from './dto/refund-response.dto';

/** 조회할 때마다 현재 점주 관계를 확인하고 공개 필드만 반환한다. */
@Injectable()
export class RefundQueryService {
  constructor(private readonly repository: RefundQueryRepository) {}

  async detail(actor: RefundActor, refundId: string) {
    const row = await this.repository.findById(refundId);
    if (!row) throw new RefundNotFoundError();
    const ownOrder = row.payment.order.userId === actor.userId;
    const currentOwner =
      actor.role === UserRole.OWNER &&
      (await this.repository.findShop(row.payment.order.shopId, actor.userId));
    if (actor.role !== UserRole.MANAGER && !ownOrder && !currentOwner)
      throw new RefundNotFoundError();
    return RefundResponseDto.detail(row, actor.role === UserRole.MANAGER);
  }

  async byShop(
    actor: RefundActor,
    shopId: string,
    query = new GetRefundQueryDto(),
  ) {
    if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
      throw new RefundForbiddenError();
    }
    const shop = await this.repository.findShop(
      shopId,
      actor.role === UserRole.OWNER ? actor.userId : undefined,
    );
    if (!shop) throw new ShopNotFoundError(shopId);
    return this.list(actor, { payment: { order: { shopId } } }, query);
  }

  byMe(actor: RefundActor, query = new GetRefundQueryDto()) {
    return this.list(
      actor,
      { payment: { order: { userId: actor.userId } } },
      query,
    );
  }

  async byUser(
    actor: RefundActor,
    userId: string,
    query = new GetRefundQueryDto(),
  ) {
    if (actor.role !== UserRole.MANAGER) throw new RefundForbiddenError();
    if (!(await this.repository.findUser(userId)))
      throw new RefundUserNotFoundError();
    return this.list(actor, { payment: { order: { userId } } }, query);
  }

  private async list(
    actor: RefundActor,
    scope: Prisma.RefundWhereInput,
    query: GetRefundQueryDto,
  ) {
    if (
      query.actionRequiredOnly !== undefined &&
      actor.role !== UserRole.MANAGER
    )
      throw new RefundForbiddenError();
    const conditions: Prisma.RefundWhereInput[] = [scope];
    if (query.payoutStatus)
      conditions.push({ payoutStatus: query.payoutStatus });
    if (query.decisionStatus)
      conditions.push({ decisionStatus: query.decisionStatus });
    if (query.actionRequiredOnly)
      conditions.push({
        OR: [
          { payoutStatus: 'ACTION_REQUIRED' },
          { manualPayouts: { some: { status: 'RESERVED' } } },
        ],
      });
    const rows = await this.repository.findMany(
      { AND: conditions },
      query.page,
      query.limit,
    );
    return {
      items: rows.items.map((row) =>
        RefundResponseDto.from(row, actor.role === UserRole.MANAGER),
      ),
      meta: PaginationUtil.createMeta(query.page, query.limit, rows.total),
    };
  }
}
