import { RefundIdempotencyStatus } from '@prisma/client';
import { RefundIdempotencyService } from './refund-idempotency.service';
import {
  IdempotencyKeyReusedError,
  IdempotencyRequestInProgressError,
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
});
