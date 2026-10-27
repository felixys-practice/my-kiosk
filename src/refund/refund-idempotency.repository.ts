import { Injectable } from '@nestjs/common';
import { Prisma, RefundIdempotencyStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

/** 멱등 요청 기록 (refund_idempotency_records) */
export type IdempotencyRecord = {
  id: string;
  requestFingerprint: string;
  status: RefundIdempotencyStatus;
  responseStatus: number | null;
  responseBody: unknown;
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
   * @returns 만든 기록, 같은 요청자·기능·키 기록이 이미 있으면 null
   */
  async createInProgress(
    scope: IdempotencyScope,
    requestFingerprint: string,
  ): Promise<IdempotencyRecord | null> {
    try {
      // 고유 제약이 동시 요청 중 하나만 통과시킨다
      return await this.prisma.refundIdempotencyRecord.create({
        data: {
          ...scope,
          requestFingerprint,
          status: RefundIdempotencyStatus.IN_PROGRESS,
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
   * 최초 응답을 저장하고 완료로 표시한다
   * @param id 기록 ID
   * @param response 최초 응답의 HTTP 상태·본문·만든 환불
   */
  async complete(
    id: string,
    response: { status: number; body: unknown; refundId?: string },
  ): Promise<void> {
    await this.prisma.refundIdempotencyRecord.update({
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
