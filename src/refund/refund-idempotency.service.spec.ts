import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RefundIdempotencyStatus } from '@prisma/client';
import { DomainBadRequestError } from 'src/common/errors';
import { TransactionClient } from 'src/prisma/prisma.service';
import {
  IdempotentResult,
  RefundIdempotencyService,
} from './refund-idempotency.service';
import {
  IdempotencyKeyReusedError,
  IdempotencyRequestInProgressError,
  RefundForbiddenError,
} from './errors';
import {
  IdempotencyRecord,
  IdempotencyScope,
  RefundIdempotencyRepository,
} from './refund-idempotency.repository';

/** 처리와 같은 트랜잭션에서 쌓이는 쓰기(커밋되어야 반영된다) */
type FakeTx = {
  writes: string[];
  afterCommit: (() => void)[];
  afterEnd: (() => void)[];
};

/**
 * 멱등 기록 저장소의 메모리 대역
 * - (requesterId, operation, key) 고유성을 실제 DB 제약처럼 흉내 낸다
 * - 담당 토큰 조건부 갱신·삭제를 흉내 낸다
 * - 처리 트랜잭션이 기록을 잡으면(acquireInTransaction) 그 트랜잭션이 끝날 때까지 이어받기가 실패한다.
 *   실제 DB에서는 이어받기가 행 잠금을 기다린 뒤 조건 불일치로 실패하는데, 대역은 기다림 없이 바로 실패로 흉내 낸다
 */
class InMemoryIdempotencyRepository {
  readonly records = new Map<
    string,
    IdempotencyRecord & { claimToken: string | null }
  >();
  /** 커밋된 처리 쓰기(예: 만든 환불) */
  readonly committed: string[] = [];
  /** true면 같은 트랜잭션의 최초 응답 저장이 실패한다 */
  failCompletion = false;
  /** 다음 트랜잭션 시작을 이 Promise가 끝날 때까지 멈춘다(요청이 트랜잭션 전에 멈춘 상황) */
  pauseNextTransaction?: Promise<void>;
  private readonly lockedIds = new Set<string>();
  private nextId = 1;

  private static keyOf(scope: IdempotencyScope): string {
    return `${scope.requesterId}|${scope.operation}|${scope.key}`;
  }

  private byId(id: string) {
    return [...this.records.values()].find((record) => record.id === id);
  }

  async runInTransaction<R>(work: (tx: FakeTx) => Promise<R>): Promise<R> {
    const gate = this.pauseNextTransaction;
    this.pauseNextTransaction = undefined;
    if (gate) await gate;
    const tx: FakeTx = { writes: [], afterCommit: [], afterEnd: [] };
    try {
      const result = await work(tx);
      // 작업이 끝까지 성공해야 커밋된다
      this.committed.push(...tx.writes);
      tx.afterCommit.forEach((apply) => apply());
      return result;
    } finally {
      tx.afterEnd.forEach((release) => release());
    }
  }

  acquireInTransaction(
    tx: FakeTx,
    id: string,
    claimToken: string,
  ): Promise<boolean> {
    const record = this.byId(id);
    if (
      record?.status !== RefundIdempotencyStatus.IN_PROGRESS ||
      record.claimToken !== claimToken
    ) {
      return Promise.resolve(false);
    }
    this.lockedIds.add(id);
    tx.afterEnd.push(() => this.lockedIds.delete(id));
    return Promise.resolve(true);
  }

  completeInTransaction(
    tx: FakeTx,
    id: string,
    claimToken: string,
    response: { status: number; body: unknown },
  ): Promise<void> {
    const record = this.byId(id);
    if (this.failCompletion) {
      return Promise.reject(new Error('최초 응답 저장 실패'));
    }
    if (
      record?.status !== RefundIdempotencyStatus.IN_PROGRESS ||
      record.claimToken !== claimToken
    ) {
      return Promise.reject(new Error('담당이 아닌 완료'));
    }
    tx.afterCommit.push(() => {
      record.status = RefundIdempotencyStatus.COMPLETED;
      record.responseStatus = response.status;
      record.responseBody = response.body;
    });
    return Promise.resolve();
  }

  takeOver(
    id: string,
    expiredClaimUntil: Date,
    claimToken: string,
    claimUntil: Date,
  ): Promise<boolean> {
    const record = this.byId(id);
    if (
      this.lockedIds.has(id) ||
      record?.status !== RefundIdempotencyStatus.IN_PROGRESS ||
      record.claimUntil?.getTime() !== expiredClaimUntil.getTime()
    ) {
      return Promise.resolve(false);
    }
    record.claimToken = claimToken;
    record.claimUntil = claimUntil;
    return Promise.resolve(true);
  }

  createInProgress(
    scope: IdempotencyScope,
    requestFingerprint: string,
    claimToken: string,
    claimUntil: Date,
  ): Promise<IdempotencyRecord | null> {
    const key = InMemoryIdempotencyRepository.keyOf(scope);
    if (this.records.has(key)) return Promise.resolve(null);
    const record = {
      id: `record-${this.nextId++}`,
      requestFingerprint,
      status: RefundIdempotencyStatus.IN_PROGRESS,
      responseStatus: null,
      responseBody: null,
      claimToken,
      claimUntil,
      createdAt: new Date(),
    };
    this.records.set(key, record);
    return Promise.resolve(record);
  }

  find(scope: IdempotencyScope): Promise<IdempotencyRecord | null> {
    // 실제 DB처럼 읽은 시점의 사본을 돌려준다(이후 다른 요청의 갱신이 이미 읽은 값에 반영되지 않게)
    const record = this.records.get(InMemoryIdempotencyRepository.keyOf(scope));
    return Promise.resolve(record ? { ...record } : null);
  }

  remove(id: string, claimToken: string): Promise<void> {
    for (const [key, record] of this.records) {
      if (
        record.id === id &&
        record.status === RefundIdempotencyStatus.IN_PROGRESS &&
        record.claimToken === claimToken
      ) {
        this.records.delete(key);
      }
    }
    return Promise.resolve();
  }
}

describe('RefundIdempotencyService', () => {
  const requesterId = 'user-1';
  const operation = 'CUSTOMER_REFUND';
  const key = 'refund-key-1';
  const request = { ticketId: 'ticket-1', terminationConsent: true };
  const allow = () => Promise.resolve();
  /** 처리 중 기록의 처리 기한(초) — 설정 기본값 */
  const workLeaseSeconds = 30;

  let repository: InMemoryIdempotencyRepository;
  let service: RefundIdempotencyService;

  beforeEach(() => {
    repository = new InMemoryIdempotencyRepository();
    service = new RefundIdempotencyService(
      repository as unknown as RefundIdempotencyRepository,
      { get: () => workLeaseSeconds } as unknown as ConfigService,
    );
  });

  it('같은 Idempotency-Key·같은 본문의 재요청은 최초 응답을 그대로 받는다', async () => {
    let calls = 0;
    const handler = () =>
      Promise.resolve({ status: 202, body: { refundId: `refund-${++calls}` } });
    const command = { requesterId, operation, key, request, authorize: allow };

    const first = await service.execute(command, handler);
    const replay = await service.execute(command, handler);

    expect(replay).toEqual(first);
  });

  it('같은 키·다른 본문의 요청은 IDEMPOTENCY_KEY_REUSED로 거절된다', async () => {
    const handler = () => Promise.resolve({ status: 202, body: {} });
    await service.execute(
      { requesterId, operation, key, request, authorize: allow },
      handler,
    );

    await expect(
      service.execute(
        {
          requesterId,
          operation,
          key,
          request: { ...request, ticketId: 'ticket-2' },
          authorize: allow,
        },
        handler,
      ),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it('최초 요청이 처리 중일 때 같은 키 요청은 IDEMPOTENCY_REQUEST_IN_PROGRESS로 거절된다', async () => {
    let finishFirst!: () => void;
    const firstHandler = () =>
      new Promise<{ status: number; body: object }>((resolve) => {
        finishFirst = () => resolve({ status: 202, body: {} });
      });
    const command = { requesterId, operation, key, request, authorize: allow };
    const first = service.execute(command, firstHandler);

    await expect(
      service.execute(command, () =>
        Promise.resolve({ status: 202, body: {} }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyRequestInProgressError);

    finishFirst();
    await first;
  });

  it('같은 키 재요청 시점에 권한이 없으면 최초 응답 대신 REFUND_FORBIDDEN을 받는다', async () => {
    const handler = () => Promise.resolve({ status: 202, body: {} });
    await service.execute(
      { requesterId, operation, key, request, authorize: allow },
      handler,
    );
    const deny = () => Promise.reject(new RefundForbiddenError());

    await expect(
      service.execute(
        { requesterId, operation, key, request, authorize: deny },
        handler,
      ),
    ).rejects.toBeInstanceOf(RefundForbiddenError);
  });

  it('Redis 멱등 키 만료 시간(600초)이 지난 뒤에도 같은 키 재요청은 DB 기록의 최초 응답을 받는다', async () => {
    const redisTtlSeconds = 600;
    let calls = 0;
    const handler = () =>
      Promise.resolve({ status: 202, body: { refundId: `refund-${++calls}` } });
    const command = { requesterId, operation, key, request, authorize: allow };
    const first = await service.execute(command, handler);
    for (const record of repository.records.values()) {
      record.createdAt = new Date(Date.now() - (redisTtlSeconds + 1) * 1000);
    }

    const replay = await service.execute(command, handler);

    expect(replay).toEqual(first);
  });

  it('동의 누락으로 거절된 요청의 키는 동의를 포함한 이후 요청의 처리를 막지 않는다', async () => {
    const withoutConsent = { ticketId: 'ticket-1', terminationConsent: false };
    const rejectConsent = () =>
      Promise.reject(new DomainBadRequestError('이용 종료 동의가 필요합니다'));
    await expect(
      service.execute(
        {
          requesterId,
          operation,
          key,
          request: withoutConsent,
          authorize: allow,
        },
        rejectConsent,
      ),
    ).rejects.toBeInstanceOf(DomainBadRequestError);

    const accepted = await service.execute(
      { requesterId, operation, key, request, authorize: allow },
      () => Promise.resolve({ status: 202, body: { refundId: 'refund-1' } }),
    );

    expect(accepted).toEqual({ status: 202, body: { refundId: 'refund-1' } });
  });

  describe('Idempotency-Key 형식 (1~128자 ASCII 비공백)', () => {
    const maxKeyLength = 128;
    const handler = () => Promise.resolve({ status: 202, body: {} });

    it('128자 ASCII 키는 허용된다', async () => {
      const result = await service.execute(
        {
          requesterId,
          operation,
          key: 'k'.repeat(maxKeyLength),
          request,
          authorize: allow,
        },
        handler,
      );

      expect(result.status).toBe(202);
    });

    it('129자 키는 거절된다', async () => {
      await expect(
        service.execute(
          {
            requesterId,
            operation,
            key: 'k'.repeat(maxKeyLength + 1),
            request,
            authorize: allow,
          },
          handler,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('공백이 들어간 키는 거절된다', async () => {
      await expect(
        service.execute(
          {
            requesterId,
            operation,
            key: 'refund key',
            request,
            authorize: allow,
          },
          handler,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('사유의 앞뒤 공백만 다른 본문은 같은 본문으로 판단되어 최초 응답을 받는다', async () => {
    const storeOperation = 'STORE_REFUND';
    const first = await service.execute(
      {
        requesterId,
        operation: storeOperation,
        key,
        request: { ticketId: 'ticket-1', amount: 5000, reason: '  고객 요청 ' },
        authorize: allow,
      },
      () => Promise.resolve({ status: 202, body: { refundId: 'refund-1' } }),
    );

    const replay = await service.execute(
      {
        requesterId,
        operation: storeOperation,
        key,
        request: { ticketId: 'ticket-1', amount: 5000, reason: '고객 요청' },
        authorize: allow,
      },
      () => Promise.resolve({ status: 202, body: { refundId: 'refund-2' } }),
    );

    expect(replay).toEqual(first);
  });

  it('기록 생성이 실패한 뒤 기록이 사라져 있으면(최초 요청 거절로 삭제) 다시 기록을 만들어 처리한다', async () => {
    // 최초 요청의 기록이 있어 생성이 실패했지만, 조회 직전에 그 요청이 거절되어 기록이 지워진 경합
    jest.spyOn(repository, 'createInProgress').mockResolvedValueOnce(null);
    jest.spyOn(repository, 'find').mockResolvedValueOnce(null);

    const result = await service.execute(
      { requesterId, operation, key, request, authorize: allow },
      () => Promise.resolve({ status: 202, body: { refundId: 'refund-1' } }),
    );

    expect(result).toEqual({ status: 202, body: { refundId: 'refund-1' } });
  });

  it('최초 응답 저장이 실패하면 같은 트랜잭션의 환불 확정도 커밋되지 않고 같은 키의 다음 요청이 처리된다', async () => {
    const command = { requesterId, operation, key, request, authorize: allow };
    const acceptRefund = (tx: TransactionClient) => {
      (tx as unknown as FakeTx).writes.push('refund-1');
      return Promise.resolve({ status: 202, body: { refundId: 'refund-1' } });
    };
    repository.failCompletion = true;
    await expect(service.execute(command, acceptRefund)).rejects.toThrow(
      '최초 응답 저장 실패',
    );
    expect(repository.committed).toEqual([]);

    repository.failCompletion = false;
    const retried = await service.execute(command, acceptRefund);

    expect(retried).toEqual({ status: 202, body: { refundId: 'refund-1' } });
    expect(repository.committed).toEqual(['refund-1']);
  });

  it('처리 기한이 지난 처리 중 기록은 같은 본문의 다음 요청이 이어받아 처리한다', async () => {
    const command = { requesterId, operation, key, request, authorize: allow };
    // 최초 요청이 처리 중 기록만 남기고 처리 트랜잭션을 시작하기 전에 멈춘 상황(서버 중단 등)
    repository.pauseNextTransaction = new Promise<void>(() => {});
    void service.execute(
      command,
      () => new Promise<IdempotentResult<object>>(() => {}),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const record of repository.records.values()) {
      record.claimUntil = new Date(Date.now() - 1000);
    }

    const result = await service.execute(command, () =>
      Promise.resolve({ status: 202, body: { refundId: 'refund-1' } }),
    );

    expect(result).toEqual({ status: 202, body: { refundId: 'refund-1' } });
  });

  describe('담당 토큰으로 이어받은 뒤의 이전 요청', () => {
    /**
     * 처리 트랜잭션에서 환불을 만드는 처리를 만든다
     * @param refundId 만들 환불
     * @returns 처리 함수
     */
    function acceptRefund(refundId: string) {
      return (tx: TransactionClient) => {
        (tx as unknown as FakeTx).writes.push(refundId);
        return Promise.resolve({ status: 202, body: { refundId } });
      };
    }

    /** 기록들의 처리 기한을 지난 시각으로 바꾼다 */
    function expireClaims() {
      for (const record of repository.records.values()) {
        record.claimUntil = new Date(Date.now() - 1000);
      }
    }

    /** 대기 중인 Promise 작업이 진행되도록 한 번 양보한다 */
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

    it('트랜잭션 전에 멈췄던 A를 B가 이어받아 성공하면 A의 처리는 커밋되지 않고 B의 최초 응답이 보존된다', async () => {
      const command = {
        requesterId,
        operation,
        key,
        request,
        authorize: allow,
      };
      let resumeA!: () => void;
      repository.pauseNextTransaction = new Promise<void>((resolve) => {
        resumeA = resolve;
      });
      const requestA = service.execute(command, acceptRefund('refund-A'));
      await flush();
      expireClaims();

      const responseB = await service.execute(
        command,
        acceptRefund('refund-B'),
      );
      resumeA();

      await expect(requestA).rejects.toBeInstanceOf(
        IdempotencyRequestInProgressError,
      );
      expect(repository.committed).toEqual(['refund-B']);
      const handlerC = jest.fn(acceptRefund('refund-C'));
      await expect(service.execute(command, handlerC)).resolves.toEqual(
        responseB,
      );
      expect(handlerC).not.toHaveBeenCalled();
    });

    it('처리 트랜잭션 안에서 처리 중인 요청의 기록은 기한이 지나도 다른 요청이 이어받지 못한다', async () => {
      const command = {
        requesterId,
        operation,
        key,
        request,
        authorize: allow,
      };
      let finishA!: () => void;
      const requestA = service.execute(command, (tx) => {
        (tx as unknown as FakeTx).writes.push('refund-A');
        return new Promise<IdempotentResult<object>>((resolve) => {
          finishA = () =>
            resolve({ status: 202, body: { refundId: 'refund-A' } });
        });
      });
      await flush();
      expireClaims();

      await expect(
        service.execute(command, acceptRefund('refund-B')),
      ).rejects.toBeInstanceOf(IdempotencyRequestInProgressError);
      finishA();

      await expect(requestA).resolves.toEqual({
        status: 202,
        body: { refundId: 'refund-A' },
      });
      expect(repository.committed).toEqual(['refund-A']);
    });

    it('기한이 지난 같은 기록을 두 요청이 동시에 이어받으려 하면 하나만 처리한다', async () => {
      const command = {
        requesterId,
        operation,
        key,
        request,
        authorize: allow,
      };
      repository.pauseNextTransaction = new Promise<void>(() => {});
      void service.execute(command, acceptRefund('refund-A'));
      await flush();
      expireClaims();
      const handlerB = jest.fn(acceptRefund('refund-B'));
      const handlerC = jest.fn(acceptRefund('refund-C'));

      const results = await Promise.allSettled([
        service.execute(command, handlerB),
        service.execute(command, handlerC),
      ]);

      expect(handlerB.mock.calls.length + handlerC.mock.calls.length).toBe(1);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });
});
