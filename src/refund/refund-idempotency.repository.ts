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
  refundId?: string | null; // 처리(환불 확정)가 커밋됐으면 그 환불. 커밋 뒤 단계 전에 중단됐는지 판단한다
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
   * @param claimToken 이 요청의 담당 토큰
   * @param claimUntil 처리 기한
   * @returns 만든 기록, 같은 요청자·기능·키 기록이 이미 있으면 null
   */
  async createInProgress(
    scope: IdempotencyScope,
    requestFingerprint: string,
    claimToken: string,
    claimUntil: Date,
  ): Promise<IdempotencyRecord | null> {
    try {
      // 고유 제약이 동시 요청 중 하나만 통과시킨다
      return await this.prisma.refundIdempotencyRecord.create({
        data: {
          ...scope,
          requestFingerprint,
          status: RefundIdempotencyStatus.IN_PROGRESS,
          claimToken,
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
   * - 처리 기한 값을 조건으로 갱신해 동시에 이어받으려는 요청 중 하나만 성공한다
   * - 처리 트랜잭션이 기록 행을 잠그고 있으면(acquireInTransaction) 그 트랜잭션이 끝날 때까지 기다린다.
   *   그 사이 완료되었거나 담당이 바뀌었으면 조건이 맞지 않아 실패한다
   * @param id 기록 ID
   * @param expiredClaimUntil 읽어 둔(지난) 처리 기한
   * @param claimToken 새 담당 토큰
   * @param claimUntil 새 처리 기한
   * @returns 이어받았으면 true
   */
  async takeOver(
    id: string,
    expiredClaimUntil: Date,
    claimToken: string,
    claimUntil: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.refundIdempotencyRecord.updateMany({
      where: {
        id,
        status: RefundIdempotencyStatus.IN_PROGRESS,
        claimUntil: expiredClaimUntil, // 왜 기존 기한까지 조건에 넣을까요? 다른 서버 실행이 먼저 같은 기록을 맡았을 수 있기 때문
      },
      data: { claimToken, claimUntil },
    });
    return count === 1;
  }

  /**
   * 처리 중 기록이 이 요청의 토큰과 일치하면 행을 잠근다.(행 잠금, 트랜잭션이 끝날 때까지 유지)
   * - 잠금은 트랜잭션이 끝날 때까지 유지한다.
   * - 잠금이 풀릴 때까지 다른 요청의 이어받기를 기다리게 해, 기한이 지났다는 이유만으로 이전 작업이 끝났다고 판단하지 않게 한다
   * @param tx 처리 트랜잭션
   * @param id 기록 ID
   * @param claimToken 이 요청의 담당 토큰
   * @returns 지금도 처리 중이고 담당이 이 요청이면 true
   */
  async lockClaimedRecordInTransaction(
    tx: TransactionClient,
    id: string,
    claimToken: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id
        FROM refund_idempotency_records
       WHERE id = ${id}
         AND status = 'IN_PROGRESS'
         AND claim_token = ${claimToken}
         FOR UPDATE
    `;
    return rows.length === 1;
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
   * @param claimToken 이 요청의 담당 토큰
   * @param response 최초 응답의 HTTP 상태·본문·만든 환불
   * @throws Error 이 요청이 더는 담당이 아닐 때(트랜잭션 롤백)
   */
  async completeInTransaction(
    tx: TransactionClient,
    id: string,
    claimToken: string,
    response: { status: number; body: unknown; refundId?: string },
  ): Promise<void> {
    // 지금도 이 요청이 담당일 때만 완료한다. 아니면 오류로 트랜잭션 전체(처리 포함)를 롤백한다
    const { count } = await tx.refundIdempotencyRecord.updateMany({
      where: { id, status: RefundIdempotencyStatus.IN_PROGRESS, claimToken },
      data: {
        status: RefundIdempotencyStatus.COMPLETED,
        responseStatus: response.status,
        responseBody: response.body as Prisma.InputJsonValue,
        refundId: response.refundId,
        completedAt: new Date(),
        claimToken: null,
        claimUntil: null,
      },
    });
    if (count !== 1) {
      throw new Error(`멱등 기록의 담당이 아니어서 완료할 수 없습니다: ${id}`);
    }
  }

  /**
   * 처리(환불 확정)가 끝났음을 처리 트랜잭션 안에서 표시한다(최종 응답은 커밋 뒤 단계가 정한다)
   * - 지금도 이 요청이 담당일 때만 표시한다. 아니면 오류로 처리 전체를 롤백한다
   * @param tx 처리 트랜잭션
   * @param id 멱등 기록 ID
   * @param claimToken 담당 토큰
   * @param refundId 확정한 환불
   */
  async updateConfirmedRefundIdInTransaction(
    tx: TransactionClient,
    id: string,
    claimToken: string,
    refundId: string | undefined,
  ): Promise<void> {
    const { count } = await tx.refundIdempotencyRecord.updateMany({
      where: { id, status: RefundIdempotencyStatus.IN_PROGRESS, claimToken },
      data: { refundId },
    });
    if (count !== 1) {
      throw new Error(
        `멱등 기록의 담당이 아니어서 처리를 표시할 수 없습니다: ${id}`,
      );
    }
  }

  /**
   * 환불 확정 커밋 후 접수 응답을 저장하고 멱등 처리를 COMPLETED로 변경한다
   * PG 전송 완료나 환불금 지급 완료를 의미하지 않는다
   * @param id 멱등 기록 ID
   * @param claimToken 담당 토큰
   * @param response 최종 응답
   * @returns 완료했으면 true, 담당을 잃었으면 false
   */
  async saveResponseAndCompleteIdempotency(
    id: string,
    claimToken: string,
    response: { status: number; body: unknown },
  ): Promise<boolean> {
    const { count } = await this.prisma.refundIdempotencyRecord.updateMany({
      where: { id, status: RefundIdempotencyStatus.IN_PROGRESS, claimToken },
      data: {
        status: RefundIdempotencyStatus.COMPLETED,
        responseStatus: response.status,
        responseBody: response.body as Prisma.InputJsonValue,
        completedAt: new Date(),
        claimToken: null,
        claimUntil: null,
      },
    });
    return count === 1;
  }

  /**
   * 처리하지 못한 요청의 기록을 지운다(거절된 요청이 같은 키의 이후 요청을 막지 않게 한다)
   * @param id 기록 ID
   * @param claimToken 이 요청의 담당 토큰
   */
  async remove(id: string, claimToken: string): Promise<void> {
    // 이 요청이 담당인 처리 중 기록만 지운다(이어받은 요청의 기록·완료 기록은 지우지 않는다)
    await this.prisma.refundIdempotencyRecord.deleteMany({
      where: { id, claimToken, status: RefundIdempotencyStatus.IN_PROGRESS },
    });
  }
}
