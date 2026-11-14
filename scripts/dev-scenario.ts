import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { addDays } from 'date-fns';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PaymentStatus,
  PaymentType,
  PrismaClient,
  SeatType,
  TicketStatus,
  TicketType,
  UserRole,
} from '@prisma/client';

// 전용 ID를 사용해 기존 시드 및 수동으로 만든 데이터와 구분한다.
const customerId = 'd3e00000-0000-4000-8000-000000000001';
const ownerId = 'd3e00000-0000-4000-8000-000000000002';
const shopId = 'd3e00000-0000-4000-8000-000000000003';
const productId = 'd3e00000-0000-4000-8000-000000000004';
const customerEmail = 'dev-refund-customer@example.test';
const ownerEmail = 'dev-refund-owner@example.test';
const shopName = '개발용 환불 시나리오 매장';
const productName = '개발용 미사용 시간권 600분';
const password = 'DevRefund123!';
const amount = 10000;
const minutes = 600;
const usableDays = 30;

/** DB에 연결하기 전에 실행 환경과 연결 대상을 확인한다. */
function localDatabaseUrl(): string {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('NODE_ENV=development에서만 실행할 수 있습니다.');
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL이 필요합니다.');
  const url = new URL(connectionString);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error('로컬 PostgreSQL 연결만 허용합니다.');
  }
  return connectionString;
}

async function createUnusedRefundScenario(): Promise<void> {
  const connectionString = localDatabaseUrl();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await prisma.$transaction(async (tx) => {
      // 재실행해도 계정 정보를 덮어쓰지 않는다. 변경된 전용 계정은 확인 후 중단한다.
      for (const account of [
        { id: customerId, email: customerEmail, role: UserRole.USER },
        { id: ownerId, email: ownerEmail, role: UserRole.OWNER },
      ]) {
        const user = await tx.user.upsert({
          where: { id: account.id },
          update: {},
          create: { ...account, password: passwordHash },
        });
        if (
          user.email !== account.email ||
          user.role !== account.role ||
          !user.isActive ||
          !user.password ||
          !(await bcrypt.compare(password, user.password))
        ) {
          throw new Error(
            '전용 계정 정보가 변경됐습니다. 기존 데이터를 확인하세요.',
          );
        }
      }
      const shop = await tx.shop.upsert({
        where: { id: shopId },
        update: {},
        create: { id: shopId, name: shopName },
      });
      if (shop.name !== shopName || !shop.isActive || shop.deletedAt) {
        throw new Error(
          '전용 매장 정보가 변경됐습니다. 기존 데이터를 확인하세요.',
        );
      }
      await tx.shopOwner.upsert({
        where: { shopId_userId: { shopId, userId: ownerId } },
        update: {},
        create: { shopId, userId: ownerId },
      });
      const product = await tx.product.upsert({
        where: { id: productId },
        update: {},
        create: {
          id: productId,
          shopId,
          name: productName,
          ticketType: TicketType.TIME,
          seatType: SeatType.FREE,
          amount,
          purchasedMinutes: minutes,
          usableDays,
        },
      });
      if (
        product.shopId !== shopId ||
        product.name !== productName ||
        product.ticketType !== TicketType.TIME ||
        product.seatType !== SeatType.FREE ||
        product.amount !== amount ||
        product.purchasedMinutes !== minutes ||
        product.usableDays !== usableDays ||
        !product.isActive ||
        product.deletedAt
      ) {
        throw new Error(
          '전용 상품 정보가 변경됐습니다. 기존 데이터를 확인하세요.',
        );
      }

      const now = new Date();
      const order = await tx.order.create({
        data: {
          shopId,
          userId: customerId,
          originalAmount: amount,
          totalAmount: amount,
        },
      });
      const orderItem = await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId,
          ticketType: TicketType.TIME,
          seatType: SeatType.FREE,
          originalAmount: amount,
          discountAmount: 0,
          amount,
          purchasedMinutes: minutes,
          usableDays,
        },
      });
      // 실제 PG 승인이 아니라 환불 API 확인을 위한 개발용 결제 데이터다.
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          type: PaymentType.CARD,
          status: PaymentStatus.SUCCESS,
          amount,
          approvedAmount: amount,
          pgTransactionId: `dev-refund-${randomUUID()}`,
          requestedAt: now,
          approvedAt: now,
        },
      });
      const ticket = await tx.ticket.create({
        data: {
          userId: customerId,
          orderItemId: orderItem.id,
          type: TicketType.TIME,
          seatType: SeatType.FREE,
          status: TicketStatus.UNUSED,
          purchasedMinutes: minutes,
          remainingMinutes: minutes,
          minuteExpireDeadline: addDays(now, usableDays),
        },
      });
      return {
        orderId: order.id,
        orderItemId: orderItem.id,
        paymentId: payment.id,
        ticketId: ticket.id,
      };
    });
    console.log('미사용 시간권의 환불 확인용 데이터를 생성했습니다.');
    console.log(
      JSON.stringify(
        { customerEmail, customerId, shopId, productId, ...result },
        null,
        2,
      ),
    );
    console.log('실제 PG 승인·취소 및 로그인 토큰 발급은 수행하지 않았습니다.');
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('사용법: npm run dev:scenario -- refund-unused');
    console.log(
      '개발 환경의 로컬 DB에 미사용 시간권을 추가합니다. 기존 데이터는 삭제하지 않습니다.',
    );
    return;
  }
  if (args.length !== 1 || args[0] !== 'refund-unused') {
    throw new Error(
      '지원하는 시나리오는 refund-unused입니다. --help를 확인하세요.',
    );
  }
  await createUnusedRefundScenario();
}

void main().catch(() => {
  // 연결 오류에 포함될 수 있는 DB 비밀번호를 출력하지 않는다.
  console.error(
    '시나리오 생성에 실패했습니다. 개발 환경·로컬 DB 연결·전용 데이터 충돌 여부를 확인하세요.',
  );
  process.exitCode = 1;
});
