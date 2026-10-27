import { Injectable } from '@nestjs/common';
import { Prisma, RefundIdempotencyStatus } from '@prisma/client';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';

/** 멱등 요청 기록 (refund_idempotency_records) */
export type IdempotencyRecord = {
  id: string;
  requestFingerprint: string;
  status: RefundIdempotencyStatus;
  responseStatus: number | null;
  responseBody: unknown;
  claimUntil: Date | null; // 처리 중 기록의 처리 기한. 지나면 다음 요청이 이어받는다
  createdAt: Date;
};

/** 멱등 요청 기록을 찾는 조건: 요청자·기능·키 */
export type IdempotencyScope = {
  requesterId: string;
  operation: string;
  key: string;
};

/**
 * 환불 요청의 DB 멱등 기록 저장소
 * - (requesterId, operation, key) unique 제약으로 같은 요청의 동시 생성을 하나로 막는다
 */
@Injectable()
export class RefundIdempotencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 처리 중 기록을 새로 만든다
   * @param scope 요청자·기능·키
   * @param requestFingerprint 요청 본문 해시
   * @param claimUntil 처리 기한
   * @returns 만든 기록, 같은 요청자·기능·키 기록이 이미 있으면 null
   */
  async createInProgress(
    scope: IdempotencyScope,
    requestFingerprint: string,
    claimUntil: Date,
  ): Promise<IdempotencyRecord | null> {
    try {
      // 고유 제약이 동시 요청 중 하나만 통과시킨다
      return await this.prisma.refundIdempotencyRecord.create({
        data: {
          ...scope,
          requestFingerprint,
          status: RefundIdempotencyStatus.IN_PROGRESS,
          claimUntil,
        },
      });
    } catch (error) {
      // 이미 같은 키 기록이 있으면 null
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * 요청자·기능·키로 기록을 찾는다
   * @param scope 요청자·기능·키
   * @returns 기록, 없으면 null
   */
  async find(scope: IdempotencyScope): Promise<IdempotencyRecord | null> {
    return this.prisma.refundIdempotencyRecord.findUnique({
      where: { requesterId_operation_key: scope },
    });
  }

  /**
   * 처리 기한이 지난 처리 중 기록을 이어받는다
   * - 처리와 최초 응답 저장이 한 트랜잭션이므로, 처리 중으로 남은 기록은 이전 처리가 커밋되지 않았다는 뜻이다
   * - 처리 기한 값을 조건으로 갱신해 동시에 이어받으려는 요청 중 하나만 성공한다
   * @param id 기록 ID
   * @param expiredClaimUntil 읽어 둔(지난) 처리 기한
   * @param claimUntil 새 처리 기한
   * @returns 이어받았으면 true
   */
  async takeOver(
    id: string,
    expiredClaimUntil: Date,
    claimUntil: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.refundIdempotencyRecord.updateMany({
      where: {
        id,
        status: RefundIdempotencyStatus.IN_PROGRESS,
        claimUntil: expiredClaimUntil,
      },
      data: { claimUntil },
    });
    return count === 1;
  }

  /**
   * 처리와 최초 응답 저장을 한 트랜잭션에서 실행한다
   * @param work 트랜잭션 안에서 실행할 작업
   * @returns 작업 결과
   */
  async runInTransaction<R>(
    work: (tx: TransactionClient) => Promise<R>,
  ): Promise<R> {
    return this.prisma.executeTransaction(work);
  }

  /**
   * 처리와 같은 트랜잭션에서 최초 응답을 저장하고 완료로 표시한다
   * @param tx 처리 트랜잭션
   * @param id 기록 ID
   * @param response 최초 응답의 HTTP 상태·본문·만든 환불
   */
  async completeInTransaction(
    tx: TransactionClient,
    id: string,
    response: { status: number; body: unknown; refundId?: string },
  ): Promise<void> {
    await tx.refundIdempotencyRecord.update({
      where: { id },
      data: {
        status: RefundIdempotencyStatus.COMPLETED,
        responseStatus: response.status,
        responseBody: response.body as Prisma.InputJsonValue,
        refundId: response.refundId,
        completedAt: new Date(),
      },
    });
  }

  /**
   * 처리하지 못한 요청의 기록을 지운다(거절된 요청이 같은 키의 이후 요청을 막지 않게 한다)
   * @param id 기록 ID
   */
  async remove(id: string): Promise<void> {
    await this.prisma.refundIdempotencyRecord.delete({ where: { id } });
  }
}
