import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { TransactionClient } from 'src/prisma/prisma.service';
import {
  IdempotencyRecord,
  RefundIdempotencyRepository,
} from './refund-idempotency.repository';
import { RefundIdempotencyStatus } from '@prisma/client';
import {
  IdempotencyKeyReusedError,
  IdempotencyRequestInProgressError,
} from './errors';

/** 기록 생성·조회 경합 시 다시 시도하는 최대 횟수 */
const maxAcquireAttempts = 3;

/** Idempotency-Key 최대 길이 */
const maxKeyLength = 128;
/** 공백 없는 출력 가능 ASCII(0x21~0x7E) 1자 이상 */
const printableAsciiWithoutSpace = /^[\x21-\x7E]+$/;

/**
 * 같은 요청인지 판단할 본문 해시를 만든다
 * - 문자열 값은 앞뒤 공백을 지운다(사유의 앞뒤 공백만 다른 요청은 같은 요청)
 * - 키를 정렬해 필드 순서와 무관하게 같은 해시를 만든다
 * @param request 대상·금액·사유·동의
 * @returns SHA-256 16진수 해시
 */
function fingerprintOf(request: Record<string, unknown>): string {
  const canonical = Object.keys(request)
    .sort()
    .map((field) => {
      const value = request[field];
      return [field, typeof value === 'string' ? value.trim() : value];
    });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** 멱등 처리 대상 요청 */
export type IdempotentCommand = {
  requesterId: string; // 요청자
  operation: string; // 기능 구분(CUSTOMER_REFUND, STORE_REFUND 등)
  key?: string; // Idempotency-Key 헤더 값, 없으면 멱등 처리 없이 실행
  request: Record<string, unknown>; // 같은 요청인지 판단할 본문(대상·금액·사유·동의)
  authorize: () => Promise<void>; // 저장된 응답을 돌려주기 전에 현재 권한을 다시 확인
};

/** 멱등 처리 결과(최초 응답) */
export type IdempotentResult<T> = {
  status: number;
  body: T;
  refundId?: string;
};

/**
 * 커밋 뒤 단계가 있는 처리의 옵션(예: 환불 확정 뒤 PG 전송)
 * - 최초 응답은 커밋 뒤 단계까지 끝난 결과로 정하고, 그 전까지 같은 키 요청은 처리 중으로 거절한다
 */
export type IdempotentAfterCommit<T> = {
  // 처리 커밋 뒤 실행하고 최종 응답을 돌려준다
  afterCommit: (result: IdempotentResult<T>) => Promise<IdempotentResult<T>>;
  // 커밋 뒤 단계 전에 중단된 처리를 이어받을 때 저장된 결과로 최종 응답을 만든다
  rebuild: (refundId: string) => Promise<IdempotentResult<T>>;
};

/**
 * 환불 요청의 DB 기반 멱등 처리
 */
@Injectable()
export class RefundIdempotencyService {
  constructor(
    private readonly repository: RefundIdempotencyRepository,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 같은 요청은 최초 응답을 돌려주고, 처음 요청이면 처리한다
   * @param command 요청자·기능·키·본문·권한 재확인
   * @param handler 처음 요청일 때 실행할 처리(넘겨받은 트랜잭션 안에서 업무 데이터를 쓴다. PG 호출 등 외부 호출은 넣지 않는다)
   * @returns 최초 응답
   * @throws BadRequestException 키 형식이 잘못됐을 때
   * @throws IdempotencyKeyReusedError 같은 키로 다른 내용을 보냈을 때
   * @throws IdempotencyRequestInProgressError 같은 키의 최초 요청이 아직 처리 중일 때
   */
  async execute<T>(
    command: IdempotentCommand,
    handler: (tx: TransactionClient) => Promise<IdempotentResult<T>>,
    after?: IdempotentAfterCommit<T>,
  ): Promise<IdempotentResult<T>> {
    // 키가 없으면 멱등 처리 없이 실행한다(상품당 확정 환불 unique가 중복 환불을 막는다)
    if (command.key === undefined) {
      const result = await this.repository.runInTransaction(handler);
      return after ? after.afterCommit(result) : result;
    }

    // 키 형식 검사(API 계약 중복 요청: 1~128자 ASCII 비공백)
    if (command.key.length > maxKeyLength) {
      throw new BadRequestException(
        `Idempotency-Key는 ${maxKeyLength}자 이하여야 합니다`,
      );
    }
    if (!printableAsciiWithoutSpace.test(command.key)) {
      throw new BadRequestException(
        'Idempotency-Key는 공백 없는 ASCII 문자여야 합니다',
      );
    }

    // 처리 중 기록을 먼저 만든다. 이미 있으면 저장된 최초 응답을 돌려준다
    const scope = {
      requesterId: command.requesterId,
      operation: command.operation,
      key: command.key,
    };
    const fingerprint = fingerprintOf(command.request);
    // 이번 실행의 담당 토큰. 완료·정리는 이 토큰이 아직 담당일 때만 한다
    const claimToken = randomUUID();
    let created: IdempotencyRecord | null = null;
    for (let attempt = 0; attempt < maxAcquireAttempts; attempt++) {
      created = await this.repository.createInProgress(
        scope,
        fingerprint,
        claimToken,
        this.nextClaimUntil(),
      );
      if (created) break;

      const existing = await this.repository.find(scope);
      if (existing) {
        // 처리 기한이 지난 처리 중 기록은 같은 본문이면 이어받아 처리한다
        if (
          await this.tryTakeOver(
            existing,
            fingerprint,
            claimToken,
            command.authorize,
          )
        ) {
          // 처리는 커밋됐지만 커밋 뒤 단계 전에 중단된 기록이면 처리를 다시 하지 않고 저장된 결과로 응답을 만든다
          if (after && existing.refundId) {
            const rebuilt = await after.rebuild(existing.refundId);
            await this.repository.completeAfterCommit(
              existing.id,
              claimToken,
              rebuilt,
            );
            return rebuilt;
          }
          created = existing;
          break;
        }
        // 그 밖에는 저장된 최초 응답을 돌려준다
        return this.replay<T>(existing, fingerprint, command.authorize);
      }
      // 그 사이 최초 요청이 거절되어 기록이 지워졌다. 고유 제약으로 다시 생성을 시도한다
    }
    if (!created) throw new IdempotencyRequestInProgressError();

    // 처음 요청이면 처리한다. 커밋 뒤 단계가 없으면 처리와 최초 응답 저장을 한 트랜잭션으로 묶고,
    // 있으면 처리 커밋 때 환불만 표시해 두고 커밋 뒤 단계가 끝난 최종 응답으로 완료한다
    let handled: IdempotentResult<T>;
    try {
      handled = await this.repository.runInTransaction(async (tx) => {
        // 트랜잭션을 시작하자마자 기록을 잡는다. 그 사이 다른 요청이 이어받았으면 처리하지 않는다
        if (
          !(await this.repository.acquireInTransaction(
            tx,
            created.id,
            claimToken,
          ))
        ) {
          throw new IdempotencyRequestInProgressError();
        }
        const result = await handler(tx);
        if (after) {
          await this.repository.markHandledInTransaction(
            tx,
            created.id,
            claimToken,
            result.refundId,
          );
        } else {
          await this.repository.completeInTransaction(
            tx,
            created.id,
            claimToken,
            result,
          );
        }
        return result;
      });
    } catch (error) {
      // 처리가 커밋되지 않았으므로 이 요청이 담당인 기록만 지워 같은 키의 이후 요청을 막지 않는다
      await this.repository.remove(created.id, claimToken);
      throw error;
    }
    if (!after) return handled;

    // 커밋 뒤 단계가 실패하면 기록은 처리 중으로 남고, 처리 기한이 지난 뒤 같은 키 요청이 저장된 결과로 완료한다
    const final = await after.afterCommit(handled);
    await this.repository.completeAfterCommit(created.id, claimToken, final);
    return final;
  }

  /**
   * 이미 있는 기록으로 최초 응답을 돌려준다
   * @param existing 같은 요청자·기능·키의 기록
   * @param fingerprint 이번 요청의 본문 지문
   * @param authorize 현재 권한 재확인
   * @returns 저장된 최초 응답
   * @throws IdempotencyKeyReusedError 같은 키로 다른 내용을 보냈을 때
   * @throws IdempotencyRequestInProgressError 최초 요청이 아직 처리 중일 때
   */
  private async replay<T>(
    existing: IdempotencyRecord,
    fingerprint: string,
    authorize: () => Promise<void>,
  ): Promise<IdempotentResult<T>> {
    // 저장된 응답을 돌려주기 전에 현재 권한을 다시 확인한다
    await authorize();

    // 같은 키로 다른 내용을 보내면 거절한다
    if (existing.requestFingerprint !== fingerprint) {
      throw new IdempotencyKeyReusedError();
    }

    // 최초 요청이 아직 응답을 저장하지 않았으면 처리 중으로 거절한다
    if (existing.status === RefundIdempotencyStatus.IN_PROGRESS) {
      throw new IdempotencyRequestInProgressError();
    }
    return {
      status: existing.responseStatus!,
      body: existing.responseBody as T,
    };
  }

  /**
   * 새 처리 기한을 계산한다(작업자 처리 기한 refund.workLeaseSeconds)
   * @returns 처리 기한 시각
   */
  private nextClaimUntil(): Date {
    const leaseSeconds = this.configService.get<number>(
      'refund.workLeaseSeconds',
    )!;
    return new Date(Date.now() + leaseSeconds * 1000);
  }

  /**
   * 처리 기한이 지난 처리 중 기록을 이어받는다
   * @param existing 같은 요청자·기능·키의 기록
   * @param fingerprint 이번 요청의 본문 지문
   * @param claimToken 이번 요청의 담당 토큰
   * @param authorize 현재 권한 재확인
   * @returns 이어받았으면 true
   */
  private async tryTakeOver(
    existing: IdempotencyRecord,
    fingerprint: string,
    claimToken: string,
    authorize: () => Promise<void>,
  ): Promise<boolean> {
    // 처리 중이고 처리 기한이 지났으며 같은 본문일 때만 이어받는다
    if (
      existing.status !== RefundIdempotencyStatus.IN_PROGRESS ||
      existing.claimUntil === null ||
      existing.claimUntil.getTime() > Date.now() ||
      existing.requestFingerprint !== fingerprint
    ) {
      return false;
    }

    // 이어받기 전에 현재 권한을 확인한다
    await authorize();
    return this.repository.takeOver(
      existing.id,
      existing.claimUntil,
      claimToken,
      this.nextClaimUntil(),
    );
  }
}
