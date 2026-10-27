import { BadRequestException } from '@nestjs/common';
import { RefundIdempotencyStatus } from '@prisma/client';
import { DomainBadRequestError } from 'src/common/errors';
import { RefundIdempotencyService } from './refund-idempotency.service';
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

/**
 * 멱등 기록 저장소의 메모리 대역
 * - (requesterId, operation, key) 고유성을 실제 DB 제약처럼 흉내 낸다
 */
class InMemoryIdempotencyRepository {
  readonly records = new Map<string, IdempotencyRecord>();
  private nextId = 1;

  private static keyOf(scope: IdempotencyScope): string {
    return `${scope.requesterId}|${scope.operation}|${scope.key}`;
  }

  createInProgress(
    scope: IdempotencyScope,
    requestFingerprint: string,
  ): Promise<IdempotencyRecord | null> {
    const key = InMemoryIdempotencyRepository.keyOf(scope);
    if (this.records.has(key)) return Promise.resolve(null);
    const record: IdempotencyRecord = {
      id: `record-${this.nextId++}`,
      requestFingerprint,
      status: RefundIdempotencyStatus.IN_PROGRESS,
      responseStatus: null,
      responseBody: null,
      createdAt: new Date(),
    };
    this.records.set(key, record);
    return Promise.resolve(record);
  }

  find(scope: IdempotencyScope): Promise<IdempotencyRecord | null> {
    return Promise.resolve(
      this.records.get(InMemoryIdempotencyRepository.keyOf(scope)) ?? null,
    );
  }

  complete(
    id: string,
    response: { status: number; body: unknown },
  ): Promise<void> {
    for (const record of this.records.values()) {
      if (record.id === id) {
        record.status = RefundIdempotencyStatus.COMPLETED;
        record.responseStatus = response.status;
        record.responseBody = response.body;
      }
    }
    return Promise.resolve();
  }

  remove(id: string): Promise<void> {
    for (const [key, record] of this.records) {
      if (record.id === id) this.records.delete(key);
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

  let repository: InMemoryIdempotencyRepository;
  let service: RefundIdempotencyService;

  beforeEach(() => {
    repository = new InMemoryIdempotencyRepository();
    service = new RefundIdempotencyService(
      repository as unknown as RefundIdempotencyRepository,
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
});
