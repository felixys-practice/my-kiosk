import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClientKnownRequestError } from '@prisma/client-runtime-utils';

function validateKey(key: string): void {
  const printableAsciiWithoutSpace = /^[\x21-\x7E]+$/;

  if (key.length > 128) {
    throw new Error('키는 128자 이하여야 합니다');
  }

  if (!printableAsciiWithoutSpace.test(key)) {
    throw new Error('키는 공백 없는 ASCII 문자여야 합니다');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RefundIdempotencyType = {
  requesterId: string;
  operation: 'CUSTOMER_REFUND' | 'STORE_REFUND' | 'PAYOUT_RETRY';
  key: string;
  requestFingerprint: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  claimToken?: string;
  claimUntil?: string | Date;
  responseBody?: {
    status: string;
    result: string;
    useCache?: boolean;
  };
};

class RefundIdempotencyRepository {
  private prisma: PrismaClient;

  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    this.prisma = new PrismaClient({ adapter });
    if (!this.prisma) {
      throw new Error('prisma 초기화 실패:');
    }
    this.prisma.$queryRaw`SELECT 1 AS connected`
      .then((r) => console.log('🔗 연결 성공:', r))
      .catch((e) => console.error(e));
  }

  async findAll() {
    return await this.prisma.refundIdempotencyRecord.findMany({
      where: {},
    });
  }

  getIdempotency(key: string, requesterId: string, operation: string) {
    return this.prisma.refundIdempotencyRecord.findUnique({
      where: {
        requesterId_operation_key: { key, requesterId, operation },
      },
    });
  }

  async createIdempotency(
    key: string,
    data: Pick<
      RefundIdempotencyType,
      | 'requesterId'
      | 'operation'
      | 'requestFingerprint'
      | 'status'
      | 'claimUntil'
    >,
  ): Promise<boolean> {
    try {
      await this.prisma.refundIdempotencyRecord.create({
        data: {
          key,
          ...data,
        },
      });
      return true;
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        return false;
      }
      throw e;
    }
  }

  ExtensionIdempotency(key: string, requesterId: string, operation: string) {
    return this.prisma.refundIdempotencyRecord.update({
      where: {
        requesterId_operation_key: { key, requesterId, operation },
      },
      data: {
        claimUntil: new Date(Date.now() + 3_000),
      },
    });
  }

  async completedIdempotency(
    key: string,
    data: Pick<
      RefundIdempotencyType,
      'requesterId' | 'operation' | 'status' | 'responseBody'
    >,
  ): Promise<boolean> {
    const refundIdempotencyRecord =
      await this.prisma.refundIdempotencyRecord.updateMany({
        where: {
          requesterId: data.requesterId,
          operation: data.operation,
          key,
          status: 'IN_PROGRESS',
        },
        data,
      });
    return !!(refundIdempotencyRecord.count === 1);
  }

  async deleteIdempotency(key: string, operation: string, requesterId: string) {
    await this.prisma.refundIdempotencyRecord.delete({
      where: {
        requesterId_operation_key: {
          requesterId,
          operation,
          key,
        },
      },
    });
  }
}

class RefundIdempotencyService {
  constructor(private repo: RefundIdempotencyRepository) {}

  // 내부는 아직 미구현
  async processRefund(key?: string): Promise<string> {
    await sleep(2_000);
    return Promise.resolve(`환불 처리 결과: ${key}`);
  }

  async execute<T extends string>(
    key: string | undefined,
    work: (key?: string) => Promise<T>,
  ): Promise<{
    status: 'PG_PENDING' | 'PG_COMPLETE';
    result?: string;
    useCache?: boolean;
  }> {
    const userId = '5fea3154-4a5c-472c-bf30-290d6f2e5b54';
    const operation = 'CUSTOMER_REFUND';

    // 1. key 가 없이 요청이 오면 멱등성 처리 없이 바로 실행한다
    if (key === undefined) {
      const result = await work();
      return { status: 'PG_COMPLETE' as const, result };
    }

    // 2. 멱등성 키를 확인한다
    const foundRecord = await this.repo.getIdempotency(key, userId, operation);

    if (foundRecord) {
      // 2.1. 작업이 완료 되었으면 저장해 둔 응답 본문을 그대로 반환한다
      if (foundRecord.status === 'COMPLETED') {
        return {
          status: 'PG_COMPLETE',
          result: JSON.stringify(foundRecord.responseBody),
          useCache: true,
        };
      }
      // 2.2. 이전 작업이 진행 중이면 처리 중 에러 처리
      if (
        foundRecord.claimUntil &&
        foundRecord.claimUntil > new Date(Date.now())
      ) {
        throw new Error(`아직 처리 중입니다: ${key}`);
      }
      // 2.3. 기한이 만료된 작업이다
      console.log(`처리 기한 만료: 이번 실행이 작업을 시작합니다. ${key}`);
    }

    validateKey(key);

    // 3. 기한이 만료된 작업 또는 새로운 작업

    // 3.1. 작업 시작 기록(만료 기간 셋팅)
    const created = await this.repo.createIdempotency(key, {
      requesterId: userId,
      operation,
      requestFingerprint: 'requestFingerprint',
      status: 'IN_PROGRESS',
      claimUntil: new Date(Date.now() + 1_000),
    });

    if (!created) {
      // 이미 진행 중인 작업이 있는지 확인
      const idempotency = await this.repo.getIdempotency(
        key,
        userId,
        operation,
      );

      if (!idempotency) {
        throw new Error('조회 실패');
      }

      // 작업이 이미 완료되었는지 확인
      if (idempotency.status === 'COMPLETED') {
        return {
          status: 'PG_COMPLETE',
          result: JSON.stringify(idempotency.responseBody),
        };
      }

      // 작업 대기 시간이 유효하다. 아직 진행 중으로 알린다,
      if (
        idempotency.claimUntil &&
        idempotency.claimUntil > new Date(Date.now())
      ) {
        throw new Error(`아직 작업 진행 중: ${key}`);
      }

      // 작업 대기 기간 만료되었다.
      throw new Error(`기존 작업의 대기 시간이 만료됨: ${key}`);
    }

    try {
      // 4. 환불 확정 처리(트랜잭션)
      const result = await work(key);

      // 5. 작업 완료 기록
      const responseBody = {
        status: 'PG_COMPLETE' as const,
        result,
      };
      await this.repo.completedIdempotency(key, {
        requesterId: userId,
        operation,
        status: 'COMPLETED',
        responseBody,
      });

      // 6. 응답 본문을 리턴
      return responseBody;
    } catch (err) {
      // 환불 확정 작업 중 오류가 발생하면 멱등성 기록을 지운다
      await this.repo.deleteIdempotency(key, operation, userId);
      throw err;
    }
  }
}

class myRefundService {}

async function main() {
  const idempotencyKey = 'i-key:' + crypto.randomUUID();

  const repository = new RefundIdempotencyRepository();
  const service = new RefundIdempotencyService(repository);
  const result = await Promise.allSettled([
    service.execute(idempotencyKey, (key) => service.processRefund(key)),
    service.execute(idempotencyKey, (key) => service.processRefund(key)),
    (async () => {
      await sleep(1_500);
      return await service.execute(idempotencyKey, (key) =>
        service.processRefund(key),
      );
    })(),
    // (async () => {
    //   await sleep(2_000);
    //   return await service.execute(idempotencyKey, (key) =>
    //     service.processRefund(key),
    //   );
    // })()
  ]);
  console.log(
    `🚀 | main | result:`,
    result.map((r) =>
      r.status === 'fulfilled'
        ? { status: r.status, value: r.value }
        : { status: r.status, reason: r.reason as unknown },
    ),
  );
}

main().catch((e) => console.error(e));
