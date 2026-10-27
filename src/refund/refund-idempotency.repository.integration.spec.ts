// src/refund/refund-idempotency.repository.integration.spec.ts
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RefundIdempotencyStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  IdempotencyScope,
  RefundIdempotencyRepository,
} from './refund-idempotency.repository';

/**
 * 멱등 기록 저장소의 담당 조건을 실제 PostgreSQL에서 확인한다 (Phase 2 재검수 P1)
 * - 완료·정리는 현재 담당 토큰일 때만 반영된다
 * - 같은 지난 처리 기한으로 동시에 이어받으면 하나만 성공한다
 * - 처리 트랜잭션이 기록을 잡은 동안의 이어받기는 그 트랜잭션이 끝날 때까지 기다린 뒤 실패한다
 */
describe('RefundIdempotencyRepository (실제 DB)', () => {
  let prisma: PrismaService;
  let repository: RefundIdempotencyRepository;
  let requesterId: string;

  const expired = () => new Date(Date.now() - 60_000);
  const future = () => new Date(Date.now() + 60_000);

  /**
   * 이 테스트 전용 요청자·기능·키 범위를 만든다
   * @returns 새 범위
   */
  function newScope(): IdempotencyScope {
    return { requesterId, operation: 'CUSTOMER_REFUND', key: randomUUID() };
  }

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();
    prisma = module.get(PrismaService);
    repository = new RefundIdempotencyRepository(prisma);
    const user = await prisma.user.create({
      data: {
        email: `idempotency-repo-${randomUUID().slice(0, 8)}@test.com`,
        role: UserRole.USER,
        password: 'hashed',
      },
    });
    requesterId = user.id;
  });

  afterAll(async () => {
    await prisma.refundIdempotencyRecord.deleteMany({ where: { requesterId } });
    await prisma.user.delete({ where: { id: requesterId } });
    await prisma.$disconnect();
  });

  it('담당 토큰이 다른 완료는 실패하고 기록을 바꾸지 않는다', async () => {
    const scope = newScope();
    const record = await repository.createInProgress(
      scope,
      'fingerprint',
      'token-new-owner',
      future(),
    );

    await expect(
      repository.runInTransaction((tx) =>
        repository.completeInTransaction(tx, record!.id, 'token-old-owner', {
          status: 202,
          body: { refundId: 'refund-old' },
        }),
      ),
    ).rejects.toThrow('담당이 아니어서');

    const after = await repository.find(scope);
    expect(after?.status).toBe(RefundIdempotencyStatus.IN_PROGRESS);
  });

  it('담당 토큰이 다른 정리는 기록을 지우지 못한다', async () => {
    const scope = newScope();
    const record = await repository.createInProgress(
      scope,
      'fingerprint',
      'token-new-owner',
      future(),
    );

    await repository.remove(record!.id, 'token-old-owner');

    expect(await repository.find(scope)).not.toBeNull();
  });

  it('같은 지난 처리 기한으로 동시에 이어받으면 하나만 성공한다', async () => {
    const scope = newScope();
    const claimUntil = expired();
    const record = await repository.createInProgress(
      scope,
      'fingerprint',
      'token-a',
      claimUntil,
    );

    const results = await Promise.all([
      repository.takeOver(record!.id, claimUntil, 'token-b', future()),
      repository.takeOver(record!.id, claimUntil, 'token-c', future()),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('처리 트랜잭션이 기록을 잡은 동안의 이어받기는 그 트랜잭션이 끝날 때까지 기다린 뒤 실패한다', async () => {
    const scope = newScope();
    const claimUntil = expired();
    const record = await repository.createInProgress(
      scope,
      'fingerprint',
      'token-a',
      claimUntil,
    );
    let takeOverSettled = false;
    let takeOver!: Promise<boolean>;

    await repository.runInTransaction(async (tx) => {
      expect(
        await repository.acquireInTransaction(tx, record!.id, 'token-a'),
      ).toBe(true);
      // 기록을 잡은 상태에서 다른 연결의 이어받기를 시작한다
      takeOver = repository
        .takeOver(record!.id, claimUntil, 'token-b', future())
        .finally(() => {
          takeOverSettled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(takeOverSettled).toBe(false);
      await repository.completeInTransaction(tx, record!.id, 'token-a', {
        status: 202,
        body: { refundId: 'refund-a' },
      });
    });

    await expect(takeOver).resolves.toBe(false);
    const after = await repository.find(scope);
    expect(after?.status).toBe(RefundIdempotencyStatus.COMPLETED);
    expect(after?.responseBody).toEqual({ refundId: 'refund-a' });
  });
});
