import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { TransactionClient } from 'src/prisma/prisma.service';
import {
  IdempotencyRecord,
  IdempotencyScope,
  RefundIdempotencyRepository,
} from './refund-idempotency.repository';
import { RefundIdempotencyStatus } from '@prisma/client';
import {
  IdempotencyKeyReusedError,
  IdempotencyRequestInProgressError,
} from './errors';

/** 멱등성 record 생성·조회 경합 시 다시 시도하는 최대 횟수 */
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

/** 현재 API에서 지원하는 환불 작업 */
export type RefundOperation =
  | 'CUSTOMER_REFUND'
  | 'STORE_REFUND'
  | 'PAYOUT_RETRY'
  | 'MANUAL_PAYOUT_RESERVE'
  | 'MANUAL_PAYOUT_CONFIRM'
  | 'MANUAL_PAYOUT_NOT_PAID'
  | 'REFUND_AMOUNT_REVIEW';

/** 멱등 처리 대상 요청 */
export type IdempotentCommand = {
  requesterId: string; // 요청자
  operation: RefundOperation; // 환불 작업별 멱등 키 구분
  key?: string; // Idempotency-Key 헤더 값, 없으면 멱등 처리 없이 실행
  request: Record<string, unknown>; // 같은 요청인지 판단할 본문(대상·금액·사유·동의)
  authorize: () => Promise<void>; // 저장된 응답을 돌려주기 전에 현재 권한을 다시 확인
};

/** 멱등 처리 결과(최초 응답) */
export type IdempotentResult<T> = {
  status: number;
  body: T;
};

/** 멱등 요청을 확보한 실행 담당. 업무 트랜잭션에서도 토큰을 다시 검증한다. */
export type IdempotencyClaim = {
  scope: IdempotencyScope;
  id: string;
  claimToken: string;
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

  /** 업무 변경과 최초 응답을 같은 트랜잭션에서 저장한다. 외부 호출은 handler에 넣지 않는다. */
  async executeInTransaction<T>(
    command: IdempotentCommand,
    executeOperation: (tx: TransactionClient) => Promise<IdempotentResult<T>>,
  ): Promise<IdempotentResult<T>> {
    const acquisitionResult = await this.acquire<T>(command);
    if (acquisitionResult.kind === 'replay') return acquisitionResult.response;
    if (acquisitionResult.kind === 'without-key')
      return this.repository.runInTransaction(executeOperation);
    const { id, claimToken } = acquisitionResult.claim;
    try {
      return await this.repository.runInTransaction(async (tx) => {
        if (
          !(await this.repository.lockClaimedRecordInTransaction(
            tx,
            id,
            claimToken,
          ))
        ) {
          throw new IdempotencyRequestInProgressError();
        }
        const result = await executeOperation(tx);
        await this.repository.completeInTransaction(tx, id, claimToken, result);
        return result;
      });
    } catch (error) {
      await this.repository.remove(id, claimToken);
      throw error;
    }
  }

  /** 키·본문·현재 권한을 확인하고 새 요청 또는 기한이 지난 요청을 확보한다. */
  async acquire<T>(
    command: IdempotentCommand,
  ): Promise<
    | { kind: 'without-key' }
    | { kind: 'replay'; response: IdempotentResult<T> }
    | { kind: 'acquired'; claim: IdempotencyClaim }
  > {
    if (command.key === undefined) return { kind: 'without-key' };
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

    // 처리 중 상태의 멱등성 record를 만든다. 이미 있으면 이어받거나 저장된 응답을 확인한다
    const scope = {
      requesterId: command.requesterId,
      operation: command.operation,
      key: command.key,
    };
    const fingerprint = fingerprintOf(command.request);
    // 이번 실행의 담당 토큰. 완료·정리는 이 토큰이 아직 담당일 때만 한다
    const claimToken = randomUUID();
    let claimedRecord: IdempotencyRecord | null = null;
    for (let attempt = 0; attempt < maxAcquireAttempts; attempt++) {
      // refund_idempotency_records에 처리 중인 멱등 요청을 생성한다
      claimedRecord = await this.repository.createInProgress(
        scope,
        fingerprint,
        claimToken,
        this.calculateClaimDeadline(),
      );
      if (claimedRecord) break;

      const existing = await this.repository.find(scope);
      if (existing) {
        // 처리 기한이 지난 요청은 같은 본문이면 처리를 이어받는다
        if (
          await this.tryTakeOver(
            existing,
            fingerprint,
            claimToken,
            command.authorize,
          )
        ) {
          claimedRecord = existing;
          break;
        }
        // 그 밖에는 저장된 최초 응답을 돌려준다
        return {
          kind: 'replay',
          response: await this.replay<T>(
            existing,
            fingerprint,
            command.authorize,
          ),
        };
      }
      // 그 사이 최초 요청이 거절되어 record가 지워졌다. 고유 제약으로 다시 생성을 시도한다
    }
    if (!claimedRecord) throw new IdempotencyRequestInProgressError();

    return {
      kind: 'acquired',
      claim: { scope, id: claimedRecord.id, claimToken },
    };
  }

  /**
   * 기존 record에 저장된 최초 응답을 돌려준다
   * @param existing 같은 요청자·기능·키의 record
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
  private calculateClaimDeadline(): Date {
    const leaseSeconds = this.configService.get<number>(
      'refund.workLeaseSeconds',
    )!;
    return new Date(Date.now() + leaseSeconds * 1000);
  }

  /**
   * 처리 기한이 지난 요청의 처리를 이어받는다
   * @param existing 같은 요청자·기능·키의 record
   * @param fingerprint 이번 요청의 본문 지문 → 요청의 동일성 확인
   * @param claimToken 이번 요청의 담당 토큰 → 처리 담당자 식별(누가 현재 요청을 처리할 권한을 확보했는가?)
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
      this.calculateClaimDeadline(),
    );
  }
}
