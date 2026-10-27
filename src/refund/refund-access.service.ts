import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RefundForbiddenError, ShopNotFoundError } from './errors';
import { RefundRepository } from './refund.repository';

/** 환불 기능을 호출한 사용자 */
export type RefundActor = {
  userId: string;
  role: string; // JWT의 역할(USER / OWNER / MANAGER)
};

/**
 * 환불 기능의 역할·조회 범위 검사
 * - 고객은 본인, 점주는 현재 ShopOwner인 매장, MANAGER는 전체 운영 범위
 */
@Injectable()
export class RefundAccessService {
  constructor(private readonly refundRepository: RefundRepository) {}

  /**
   * 점주·운영자 전용 기능의 호출자인지 확인한다
   * @param actor 호출한 사용자
   * @throws RefundForbiddenError 고객(USER) 역할일 때
   */
  assertStoreOrOperator(actor: RefundActor): void {
    // 점주·운영자가 아니면 역할 부족으로 거절한다
    if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
      throw new RefundForbiddenError();
    }
  }

  /**
   * 매장 범위 조회 권한을 확인한다
   * @param actor 호출한 사용자
   * @param shopId 조회할 매장
   * @throws ShopNotFoundError 점주가 지금 이 매장의 ShopOwner가 아닐 때(범위 밖은 존재를 드러내지 않고 404)
   */
  async assertShopScope(actor: RefundActor, shopId: string): Promise<void> {
    // 운영자는 전체 범위
    if (actor.role === UserRole.MANAGER) return;

    // 점주는 요청 시점의 ShopOwner 관계로 확인한다
    const owns = await this.refundRepository.isCurrentShopOwner(
      shopId,
      actor.userId,
    );
    if (!owns) throw new ShopNotFoundError(shopId);
  }
}
