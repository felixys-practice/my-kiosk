import 'dotenv/config';
import { test, TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { RefundService, RequestRecord } from './refund-example';

/**
 * 테스트마다 별도 스키마·Prisma 연결·가짜 PG를 준비한다.
 * 종료 시 해당 스키마와 연결을 정리하며 실제 업무 테이블은 사용하지 않는다.
 */
async function fixture(t: TestContext) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL이 필요합니다');
  const schema = 'refund_learning_' + randomUUID().replaceAll('-', '');
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      options: `-c search_path=${schema} -c statement_timeout=5000`,
      application_name: schema,
    }),
  });
  t.after(async () => {
    await prisma.$disconnect();
    try {
      await admin.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
    } finally {
      await admin.$disconnect();
    }
  });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await prisma.$executeRawUnsafe(
    'CREATE TABLE refunds (id uuid PRIMARY KEY, ticket_id text UNIQUE NOT NULL)',
  );
  await prisma.$executeRawUnsafe(`CREATE TABLE requests (
    key text PRIMARY KEY, ticket_id text NOT NULL,
    status text NOT NULL DEFAULT 'IN_PROGRESS',
    claim_token uuid, claim_until timestamptz NOT NULL,
    refund_id uuid REFERENCES refunds(id), response jsonb
  )`);
  // PG 서버 쪽의 멱등성을 흉내 낸다. 호출 수와 실제 취소 반영 수는 다르다.
  const pg = {
    calls: 0,
    cancelled: new Set<string>(),
    loseResponseOnce: false,
    /** 같은 ID의 취소는 한 번만 반영하고, 필요하면 반영 후 응답 유실을 재현한다. */
    async cancel(id: string) {
      this.calls++;
      this.cancelled.add(id);
      if (this.loseResponseOnce) {
        this.loseResponseOnce = false;
        throw new Error('PG 응답 유실');
      }
    },
  };
  const service = new RefundService(prisma, pg);
  const command = { key: randomUUID(), ticketId: 'ticket-1' };
  return { prisma, pg, service, command, schema };
}

void test('최초 환불 뒤 같은 요청은 저장된 응답을 반환한다', async (t) => {
  const { service, command, prisma, pg } = await fixture(t);
  const first = await service.requestRefund(command);
  assert.deepEqual(await service.requestRefund(command), first);
  assert.equal(pg.calls, 1);
  assert.equal(
    (await prisma.$queryRawUnsafe<unknown[]>('SELECT * FROM refunds')).length,
    1,
  );
  await assert.rejects(
    service.requestRefund({ ...command, ticketId: 'other' }),
    /키 재사용/,
  );
});

void test('환불 INSERT 뒤 기록 저장이 실패하면 환불도 롤백된다', async (t) => {
  const { service, command, prisma, pg } = await fixture(t);
  // 환불 행은 만들어졌지만 복구 참조값 저장이 실패하는 상황을 DB 제약으로 만든다.
  await prisma.$executeRawUnsafe(
    'ALTER TABLE requests ADD CONSTRAINT fail_mark CHECK (refund_id IS NULL)',
  );
  await assert.rejects(service.requestRefund(command), /fail_mark/);
  assert.equal(
    (await prisma.$queryRawUnsafe<unknown[]>('SELECT * FROM refunds')).length,
    0,
  );
  assert.equal(
    (await prisma.$queryRawUnsafe<unknown[]>('SELECT * FROM requests')).length,
    0,
  );
  assert.equal(pg.calls, 0);
  await prisma.$executeRawUnsafe(
    'ALTER TABLE requests DROP CONSTRAINT fail_mark',
  );
  await service.requestRefund(command);
});

void test('커밋 후 PG 응답 유실: 환불을 다시 만들지 않고 복구한다', async (t) => {
  const { service, command, prisma, pg } = await fixture(t);
  pg.loseResponseOnce = true;
  await assert.rejects(service.requestRefund(command), /PG 응답 유실/);
  const [before] = await prisma.$queryRawUnsafe<RequestRecord[]>(
    'SELECT * FROM requests',
  );
  assert.equal(before.status, 'IN_PROGRESS');
  assert.ok(before.refund_id);
  await assert.rejects(service.requestRefund(command), /처리 중/);
  // 실제 시간을 기다리는 대신 테스트에서 만료 시각을 과거로 설정한다.
  await prisma.$executeRawUnsafe(
    "UPDATE requests SET claim_until = now() - interval '1 second'",
  );
  const response = await service.requestRefund(command);
  assert.equal(response.refundId, before.refund_id);
  assert.equal(
    (await prisma.$queryRawUnsafe<unknown[]>('SELECT * FROM refunds')).length,
    1,
  );
  assert.equal(pg.calls, 2);
  assert.equal(pg.cancelled.size, 1);
});

void test('행 락이 유지되는 동안 takeOver는 대기하고, 해제 뒤 이전 토큰은 거절된다', async (t) => {
  const { service, prisma, command, schema } = await fixture(t);
  const oldToken = randomUUID();
  const newToken = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO requests (key, ticket_id, claim_token, claim_until)
    VALUES ($1, $2, $3::uuid, now() - interval '1 second')`,
    command.key,
    command.ticketId,
    oldToken,
  );
  let unlock!: () => void;
  const gate = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  let locked!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const owner = prisma.$transaction(
    async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT * FROM requests WHERE key=$1 AND claim_token=$2::uuid FOR UPDATE`,
        command.key,
        oldToken,
      );
      locked();
      await gate;
    },
    { timeout: 10000 },
  );
  // 락 획득 전에 실패해도 무한히 기다리지 않는다.
  await Promise.race([
    ready,
    owner.then(() => {
      throw new Error('락 획득 실패');
    }),
  ]);
  let takeover: Promise<boolean> | undefined;
  try {
    takeover = service.takeOver(command.key, newToken);
    // Prisma의 raw query는 지연 실행된다. 서비스의 await가 DB 실행을 시작한다.
    const deadline = Date.now() + 3000;
    let blocked = false;
    while (Date.now() < deadline) {
      const result = await prisma.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM pg_stat_activity
        WHERE application_name=$1 AND wait_event_type='Lock'
        AND query LIKE 'UPDATE requests%'`,
        schema,
      );
      if (result.length) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(blocked, 'takeOver가 실제로 행 락을 기다려야 한다');
    unlock();
    await owner;
    assert.equal(await takeover, true);
    await assert.rejects(
      service.confirmRefund(command, oldToken),
      /담당을 잃음/,
    );
    assert.equal(
      (await prisma.$queryRawUnsafe<unknown[]>('SELECT * FROM refunds')).length,
      0,
    );
    await service.confirmRefund(command, newToken);
    assert.equal(
      (await prisma.$queryRawUnsafe<unknown[]>('SELECT * FROM refunds')).length,
      1,
    );
  } finally {
    unlock();
    await owner;
    if (takeover) await takeover.catch(() => {});
  }
});
