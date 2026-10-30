import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import {
  PrismaClient,
  UserRole,
  OAuthProvider,
  TicketType,
  TicketStatus,
  PaymentType,
  PaymentStatus,
  UsageSessionStatus,
  SeatStatus,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { addDays, addMinutes, addHours, subDays, subHours, subMinutes } from 'date-fns';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const now = new Date();

// ─────────────────────────────────────────────────────────
// 고정 ID (재실행 시 동일한 데이터로 초기화되도록 UUID를 고정한다)
// ─────────────────────────────────────────────────────────

const USER = {
  manager: '10000000-0000-0000-0000-000000000001', // manager@test.com
  ownerGangnam: '10000000-0000-0000-0000-000000000002', // owner-gangnam@test.com (강남점 단독 점주)
  ownerShared: '10000000-0000-0000-0000-000000000003', // owner-shared@test.com (홍대점 공동 점주 1)
  ownerShared2: '10000000-0000-0000-0000-000000000004', // owner-shared2@test.com (홍대점 공동 점주 2)
  ownerClosed: '10000000-0000-0000-0000-000000000005', // owner-closed@test.com (폐업 매장 점주)
  user1: '10000000-0000-0000-0000-000000000011', // user1@test.com
  user2: '10000000-0000-0000-0000-000000000012', // user2@test.com
  user3: '10000000-0000-0000-0000-000000000013', // user3@test.com
  user4: '10000000-0000-0000-0000-000000000014', // user4@test.com
  userOauth: '10000000-0000-0000-0000-000000000015', // oauth-user@test.com (OAuth 전용, 비밀번호 없음)
};

const SHOP = {
  gangnam: '20000000-0000-0000-0000-000000000001', // 정상 운영 매장, 단독 점주
  hongdae: '20000000-0000-0000-0000-000000000002', // 정상 운영 매장, 공동 점주 2인
  suspended: '20000000-0000-0000-0000-000000000003', // isActive=false (일시 운영중단)
  closed: '20000000-0000-0000-0000-000000000004', // deletedAt 존재 (폐업)
};

const SEAT = {
  gangnamA1: '21000000-0000-0000-0000-000000000001',
  gangnamA2: '21000000-0000-0000-0000-000000000002',
  gangnamA3Broken: '21000000-0000-0000-0000-000000000003', // UNAVAILABLE
  hongdaeB1: '21000000-0000-0000-0000-000000000004',
  hongdaeB2: '21000000-0000-0000-0000-000000000005',
  hongdaeB3Broken: '21000000-0000-0000-0000-000000000006', // UNAVAILABLE
};

const PRODUCT = {
  gangnamPeriod30: '30000000-0000-0000-0000-000000000001', // 정기권 30일 - 활성
  gangnamTime600: '30000000-0000-0000-0000-000000000002', // 시간권 600분 - 활성
  hongdaePeriod30: '30000000-0000-0000-0000-000000000003', // 정기권 30일 - 활성
  gangnamTime300Inactive: '30000000-0000-0000-0000-000000000004', // 시간권 300분 - 판매 중지(isActive=false)
  gangnamPeriod7Deleted: '30000000-0000-0000-0000-000000000005', // 정기권 7일 - 소프트 삭제(deletedAt)
  hongdaeTime120: '30000000-0000-0000-0000-000000000006', // 시간권 120분 - 활성(짧은 시간권, 소진 시나리오용)
};

const SYSTEM_ACTOR = 'SYSTEM'; // 특정 사용자가 아닌 매장 스태프/시스템에 의한 조치를 나타내는 식별자

// ─────────────────────────────────────────────────────────
// 초기화 — 이 시드가 생성하는 모든 테이블을 자식 → 부모 순서로 정리한다
// ─────────────────────────────────────────────────────────

async function resetSeedData() {
  await prisma.usageSession.deleteMany({});
  await prisma.ticketPause.deleteMany({});
  await prisma.refundLock.deleteMany({});
  await prisma.paymentCancel.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.ticket.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.productHistory.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.seat.deleteMany({});
  await prisma.shopOwner.deleteMany({});
  await prisma.shop.deleteMany({});
  await prisma.oAuthAccount.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.user.deleteMany({});
  console.log('기존 시드 데이터 초기화 완료');
}

// ─────────────────────────────────────────────────────────
// 1. User
// ─────────────────────────────────────────────────────────

async function seedUsers() {
  // 테스트 환경 전용 비밀번호 해시 (평문: test1234)
  const hashedPassword = await bcrypt.hash('test1234', 10);
  await prisma.user.createMany({
    data: [
      { id: USER.manager, email: 'manager@test.com', role: UserRole.MANAGER, password: hashedPassword },
      { id: USER.ownerGangnam, email: 'owner-gangnam@test.com', role: UserRole.OWNER, password: hashedPassword },
      { id: USER.ownerShared, email: 'owner-shared@test.com', role: UserRole.OWNER, password: hashedPassword },
      { id: USER.ownerShared2, email: 'owner-shared2@test.com', role: UserRole.OWNER, password: hashedPassword },
      { id: USER.ownerClosed, email: 'owner-closed@test.com', role: UserRole.OWNER, password: hashedPassword },
      { id: USER.user1, email: 'user1@test.com', role: UserRole.USER, password: hashedPassword },
      { id: USER.user2, email: 'user2@test.com', role: UserRole.USER, password: hashedPassword },
      { id: USER.user3, email: 'user3@test.com', role: UserRole.USER, password: hashedPassword },
      { id: USER.user4, email: 'user4@test.com', role: UserRole.USER, password: hashedPassword },
      // OAuth 전용 유저 — password null
      { id: USER.userOauth, email: 'oauth-user@test.com', role: UserRole.USER, password: null },
    ],
  });
  console.log('User 생성 완료: 10명 (MANAGER 1, OWNER 4, USER 5 — OAuth 전용 1명 포함)');
}

async function seedOAuthAccounts() {
  await prisma.oAuthAccount.createMany({
    data: [
      // OAuth 전용 유저 — Google 연결
      { userId: USER.userOauth, provider: OAuthProvider.GOOGLE, providerId: 'google-uid-00015' },
      // 로컬 로그인 유저가 추가로 Github 연결한 케이스 (멀티 프로바이더 시나리오)
      { userId: USER.user1, provider: OAuthProvider.GITHUB, providerId: 'github-uid-00011' },
    ],
  });
  console.log('OAuthAccount 생성 완료: 2건 (Google 1, Github 1)');
}

// ─────────────────────────────────────────────────────────
// 2. Shop + ShopOwner (공동 점주 포함) + Seat
// ─────────────────────────────────────────────────────────

async function seedShopsAndSeats() {
  await prisma.shop.createMany({
    data: [
      { id: SHOP.gangnam, name: '강남점', isActive: true },
      { id: SHOP.hongdae, name: '홍대점', isActive: true },
      { id: SHOP.suspended, name: '운영중단점', isActive: false },
      { id: SHOP.closed, name: '폐업점', isActive: false, deletedAt: subDays(now, 30) },
    ],
  });

  await prisma.shopOwner.createMany({
    data: [
      { shopId: SHOP.gangnam, userId: USER.ownerGangnam },
      // 홍대점: 공동 점주 2인 - Shop:User N:N 관계 커버
      { shopId: SHOP.hongdae, userId: USER.ownerShared },
      { shopId: SHOP.hongdae, userId: USER.ownerShared2 },
      { shopId: SHOP.suspended, userId: USER.ownerGangnam }, // 한 점주가 여러 매장을 소유하는 케이스
      { shopId: SHOP.closed, userId: USER.ownerClosed },
    ],
  });

  await prisma.seat.createMany({
    data: [
      { id: SEAT.gangnamA1, shopId: SHOP.gangnam, number: 1, name: 'A1', status: SeatStatus.AVAILABLE },
      { id: SEAT.gangnamA2, shopId: SHOP.gangnam, number: 2, name: 'A2', status: SeatStatus.AVAILABLE },
      { id: SEAT.gangnamA3Broken, shopId: SHOP.gangnam, number: 3, name: 'A3', status: SeatStatus.UNAVAILABLE },
      { id: SEAT.hongdaeB1, shopId: SHOP.hongdae, number: 1, name: 'B1', status: SeatStatus.AVAILABLE },
      { id: SEAT.hongdaeB2, shopId: SHOP.hongdae, number: 2, name: 'B2', status: SeatStatus.AVAILABLE },
      { id: SEAT.hongdaeB3Broken, shopId: SHOP.hongdae, number: 3, name: 'B3', status: SeatStatus.UNAVAILABLE },
    ],
  });

  console.log('Shop(4, 정상/공동점주/운영중단/폐업) + Seat(6, AVAILABLE/UNAVAILABLE) 생성 완료');
}

// ─────────────────────────────────────────────────────────
// 3. Product + ProductHistory
// ─────────────────────────────────────────────────────────

async function seedProducts() {
  await prisma.product.createMany({
    data: [
      {
        id: PRODUCT.gangnamPeriod30,
        name: '한달 정기권',
        ticketType: TicketType.PERIOD,
        amount: 100000,
        shopId: SHOP.gangnam,
        usableDays: 30,
        purchasedDurationDays: 30,
        isActive: true,
      },
      {
        id: PRODUCT.gangnamTime600,
        name: '10시간 이용권',
        ticketType: TicketType.TIME,
        amount: 50000,
        shopId: SHOP.gangnam,
        usableDays: 60,
        purchasedMinutes: 600,
        isActive: true,
      },
      {
        id: PRODUCT.hongdaePeriod30,
        name: '한달 정기권',
        ticketType: TicketType.PERIOD,
        amount: 90000,
        shopId: SHOP.hongdae,
        usableDays: 30,
        purchasedDurationDays: 30,
        isActive: true,
      },
      {
        id: PRODUCT.gangnamTime300Inactive,
        name: '5시간 이용권(판매종료)',
        ticketType: TicketType.TIME,
        amount: 30000,
        shopId: SHOP.gangnam,
        usableDays: 60,
        purchasedMinutes: 300,
        isActive: false, // 판매 비활성화 상품 — 과거 구매 이력은 남아 있어야 함
      },
      {
        id: PRODUCT.gangnamPeriod7Deleted,
        name: '체험 정기권(삭제됨)',
        ticketType: TicketType.PERIOD,
        amount: 20000,
        shopId: SHOP.gangnam,
        usableDays: 7,
        purchasedDurationDays: 7,
        isActive: false,
        deletedAt: subDays(now, 10), // 소프트 삭제 상품
      },
      {
        id: PRODUCT.hongdaeTime120,
        name: '2시간 이용권',
        ticketType: TicketType.TIME,
        amount: 12000,
        shopId: SHOP.hongdae,
        usableDays: 30,
        purchasedMinutes: 120,
        isActive: true,
      },
    ],
  });

  // 상품 가격 변경 이력(ProductHistory) — 강남 정기권이 90000원 → 100000원으로 인상된 이력
  const changeGroupId = crypto.randomUUID();
  await prisma.productHistory.createMany({
    data: [
      {
        changeGroupId,
        productId: PRODUCT.gangnamPeriod30,
        changedField: 'amount',
        oldValue: '90000',
        newValue: '100000',
        changedBy: USER.ownerGangnam,
        changedAt: subDays(now, 20),
      },
      {
        changeGroupId,
        productId: PRODUCT.gangnamPeriod30,
        changedField: 'usableDays',
        oldValue: '14',
        newValue: '30',
        changedBy: USER.ownerGangnam,
        changedAt: subDays(now, 20),
      },
      {
        changeGroupId: crypto.randomUUID(),
        productId: PRODUCT.gangnamTime300Inactive,
        changedField: 'isActive',
        oldValue: 'true',
        newValue: 'false',
        changedBy: USER.ownerGangnam,
        changedAt: subDays(now, 5),
      },
    ],
  });

  console.log(
    'Product(6, 활성/비활성/소프트삭제) + ProductHistory(3) 생성 완료',
  );
}

// ─────────────────────────────────────────────────────────
// 4. Order + OrderItem + Payment (+ 성공 건은 Ticket까지)
// ─────────────────────────────────────────────────────────

interface OrderItemInput {
  productId: string;
  ticketType: TicketType;
  originalAmount: number;
  discountAmount: number;
  usableDays: number;
  purchasedMinutes?: number;
  purchasedDurationDays?: number;
}

async function createOrderWithRelations(params: {
  userId: string;
  shopId: string;
  items: OrderItemInput[];
  paymentType: PaymentType;
  paymentStatus: PaymentStatus;
  paymentReason?: string;
  createdAt?: Date;
}) {
  const originalAmount = params.items.reduce(
    (sum, item) => sum + item.originalAmount,
    0,
  );
  const discountAmount = params.items.reduce(
    (sum, item) => sum + item.discountAmount,
    0,
  );
  const totalAmount = originalAmount - discountAmount;
  const orderCreatedAt = params.createdAt ?? now;

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        shopId: params.shopId,
        userId: params.userId,
        originalAmount,
        discountAmount,
        totalAmount,
        createdAt: orderCreatedAt,
      },
    });

    const orderItems: Awaited<ReturnType<typeof tx.orderItem.create>>[] = [];
    for (const item of params.items) {
      const orderItem = await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: item.productId,
          ticketType: item.ticketType,
          originalAmount: item.originalAmount,
          discountAmount: item.discountAmount,
          amount: item.originalAmount - item.discountAmount,
          purchasedMinutes: item.purchasedMinutes,
          purchasedDurationDays: item.purchasedDurationDays,
          usableDays: item.usableDays,
          createdAt: orderCreatedAt,
        },
      });
      orderItems.push(orderItem);
    }

    // 결제 상태별 요청/승인/취소 시각 및 사유
    const isRequested = params.paymentStatus !== PaymentStatus.PENDING;
    const isApproved = params.paymentStatus === PaymentStatus.SUCCESS;
    const isTerminalCancelled =
      params.paymentStatus === PaymentStatus.CANCELLED;

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        type: params.paymentType,
        status: params.paymentStatus,
        amount: totalAmount,
        van: params.paymentType === PaymentType.CARD ? 'NICE' : undefined,
        pgTransactionId:
          isRequested || isTerminalCancelled
            ? `PG-${order.id.slice(0, 8)}`
            : undefined,
        requestedAt:
          isRequested || isTerminalCancelled ? orderCreatedAt : undefined,
        approvedAt:
          isApproved || isTerminalCancelled ? orderCreatedAt : undefined,
        reason: params.paymentReason,
        createdAt: orderCreatedAt,
      },
    });

    // 결제 성공 건만 order_item마다 실제 이용권(Ticket) 발급
    const tickets: Awaited<ReturnType<typeof tx.ticket.create>>[] = [];
    if (isApproved) {
      for (let i = 0; i < orderItems.length; i++) {
        const orderItem = orderItems[i];
        const item = params.items[i];
        const isTimeType = item.ticketType === TicketType.TIME;
        const ticket = await tx.ticket.create({
          data: {
            userId: params.userId,
            type: item.ticketType,
            status: TicketStatus.UNUSED,
            orderItemId: orderItem.id,
            purchasedMinutes: isTimeType ? item.purchasedMinutes : undefined,
            minuteExpireDeadline: isTimeType
              ? addDays(orderCreatedAt, item.usableDays)
              : undefined,
            remainingMinutes: isTimeType ? item.purchasedMinutes : undefined,
            purchasedDurationDays: !isTimeType
              ? item.purchasedDurationDays
              : undefined,
            activationDeadline: !isTimeType
              ? addDays(orderCreatedAt, item.usableDays)
              : undefined,
            createdAt: orderCreatedAt,
          },
        });
        tickets.push(ticket);
      }
    }

    return { order, orderItems, payment, tickets };
  });
}

interface PaymentAttemptInput {
  type: PaymentType;
  status: PaymentStatus;
  reason?: string; // 실패 사유
  attemptOffsetMinutes?: number; // 주문 시각 대비 이 결제가 시도된 시점(분) — 재시도 흐름의 시간 간격 표현용
}

/**
 * 주문 1건에 결제(Payment) 여러 건이 붙는 시나리오 전용 — Order 1:N Payment 관계.
 * 이 프로젝트에서 한 주문에 결제가 여러 건 남는 유일한 경로는 "실패 후 전액으로 재시도"뿐이다
 * (payment.repository.ts:createPayment()가 PENDING/REQUESTED/SUCCESS 상태 결제가 있으면 새 결제
 * 생성을 막고, amount도 항상 order.totalAmount로 고정한다 — FAILED만 재시도를 막지 않는다).
 * "분할결제(금액을 쪼개 동시 진행)"는 이 서비스에 구현되어 있지 않으므로 여기서 다루지 않는다.
 */
async function createOrderWithMultiplePayments(params: {
  userId: string;
  shopId: string;
  items: OrderItemInput[];
  payments: PaymentAttemptInput[];
  createdAt?: Date;
}) {
  const originalAmount = params.items.reduce(
    (sum, item) => sum + item.originalAmount,
    0,
  );
  const discountAmount = params.items.reduce(
    (sum, item) => sum + item.discountAmount,
    0,
  );
  const totalAmount = originalAmount - discountAmount;
  const orderCreatedAt = params.createdAt ?? now;

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        shopId: params.shopId,
        userId: params.userId,
        originalAmount,
        discountAmount,
        totalAmount,
        createdAt: orderCreatedAt,
      },
    });

    const orderItems: Awaited<ReturnType<typeof tx.orderItem.create>>[] = [];
    for (const item of params.items) {
      const orderItem = await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: item.productId,
          ticketType: item.ticketType,
          originalAmount: item.originalAmount,
          discountAmount: item.discountAmount,
          amount: item.originalAmount - item.discountAmount,
          purchasedMinutes: item.purchasedMinutes,
          purchasedDurationDays: item.purchasedDurationDays,
          usableDays: item.usableDays,
          createdAt: orderCreatedAt,
        },
      });
      orderItems.push(orderItem);
    }

    // 실제 코드(createPayment)와 동일하게 매 시도의 amount는 항상 주문 총액 전체로 고정한다
    // (부분 금액 결제라는 개념 자체가 서비스 레이어에 존재하지 않는다)
    const payments: Awaited<ReturnType<typeof tx.payment.create>>[] = [];
    let hasSucceeded = false;
    for (let i = 0; i < params.payments.length; i++) {
      const attempt = params.payments[i];
      const attemptAt = addMinutes(
        orderCreatedAt,
        attempt.attemptOffsetMinutes ?? i * 5,
      );
      const isRequested = attempt.status !== PaymentStatus.PENDING;
      const isApprovedOne = attempt.status === PaymentStatus.SUCCESS;
      const isTerminalCancelled = attempt.status === PaymentStatus.CANCELLED;

      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          type: attempt.type,
          status: attempt.status,
          amount: totalAmount,
          van: attempt.type === PaymentType.CARD ? 'KCP' : undefined,
          // 한 주문에 여러 결제가 붙으므로 pgTransactionId 충돌 방지를 위해 시도 순번을 접미사로 붙인다
          pgTransactionId:
            isRequested || isTerminalCancelled
              ? `PG-${order.id.slice(0, 8)}-${i + 1}`
              : undefined,
          requestedAt:
            isRequested || isTerminalCancelled ? attemptAt : undefined,
          approvedAt:
            isApprovedOne || isTerminalCancelled ? attemptAt : undefined,
          reason: attempt.reason,
          createdAt: attemptAt,
        },
      });
      payments.push(payment);
      if (isApprovedOne) hasSucceeded = true;
    }

    // 시도 중 SUCCESS가 하나라도 있으면(createPayment 가드상 SUCCESS는 최대 1건) order_item마다 실제 이용권(Ticket) 발급
    const tickets: Awaited<ReturnType<typeof tx.ticket.create>>[] = [];
    if (hasSucceeded) {
      for (let i = 0; i < orderItems.length; i++) {
        const orderItem = orderItems[i];
        const item = params.items[i];
        const isTimeType = item.ticketType === TicketType.TIME;
        const ticket = await tx.ticket.create({
          data: {
            userId: params.userId,
            type: item.ticketType,
            status: TicketStatus.UNUSED,
            orderItemId: orderItem.id,
            purchasedMinutes: isTimeType ? item.purchasedMinutes : undefined,
            minuteExpireDeadline: isTimeType
              ? addDays(orderCreatedAt, item.usableDays)
              : undefined,
            remainingMinutes: isTimeType ? item.purchasedMinutes : undefined,
            purchasedDurationDays: !isTimeType
              ? item.purchasedDurationDays
              : undefined,
            activationDeadline: !isTimeType
              ? addDays(orderCreatedAt, item.usableDays)
              : undefined,
            createdAt: orderCreatedAt,
          },
        });
        tickets.push(ticket);
      }
    }

    return { order, orderItems, payments, tickets };
  });
}

/**
 * 결제를 아예 시도하지 않은 주문 — Order 1:N Payment 관계의 하한(0건)을 커버한다.
 * order.repository.ts:createOrder()와 payment.service.ts:requestPayment()는 서로 다른
 * 트랜잭션/API(POST /orders와 POST /payments)라서, 주문만 생성되고 사용자가 결제 버튼을
 * 아직 누르지 않았거나 장바구니를 이탈한 상태가 실제로 흔하다. 이 경우 Payment 행 자체가
 * 없다 — PENDING 상태(Payment 행은 이미 존재)와는 다른 상태다.
 */
async function createOrderWithoutPayment(params: {
  userId: string;
  shopId: string;
  items: OrderItemInput[];
  createdAt?: Date;
}) {
  const originalAmount = params.items.reduce(
    (sum, item) => sum + item.originalAmount,
    0,
  );
  const discountAmount = params.items.reduce(
    (sum, item) => sum + item.discountAmount,
    0,
  );
  const totalAmount = originalAmount - discountAmount;
  const orderCreatedAt = params.createdAt ?? now;

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        shopId: params.shopId,
        userId: params.userId,
        originalAmount,
        discountAmount,
        totalAmount,
        createdAt: orderCreatedAt,
      },
    });

    const orderItems: Awaited<ReturnType<typeof tx.orderItem.create>>[] = [];
    for (const item of params.items) {
      const orderItem = await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: item.productId,
          ticketType: item.ticketType,
          originalAmount: item.originalAmount,
          discountAmount: item.discountAmount,
          amount: item.originalAmount - item.discountAmount,
          purchasedMinutes: item.purchasedMinutes,
          purchasedDurationDays: item.purchasedDurationDays,
          usableDays: item.usableDays,
          createdAt: orderCreatedAt,
        },
      });
      orderItems.push(orderItem);
    }

    return { order, orderItems };
  });
}

// ─────────────────────────────────────────────────────────
// 5. TicketPause
// ─────────────────────────────────────────────────────────

async function createTicketPause(params: {
  ticketId: string;
  pausedAt: Date;
  pausedReason: string;
  pausedBy: string;
  resumedAt?: Date;
  resumedReason?: string;
  resumedBy?: string;
}) {
  return prisma.ticketPause.create({
    data: {
      ticketId: params.ticketId,
      pausedAt: params.pausedAt,
      pausedReason: params.pausedReason,
      pausedBy: params.pausedBy,
      resumedAt: params.resumedAt,
      resumedReason: params.resumedReason,
      resumedBy: params.resumedBy,
      createdAt: params.pausedAt,
    },
  });
}

// ─────────────────────────────────────────────────────────
// 6. UsageSession
// ─────────────────────────────────────────────────────────

async function createUsageSession(params: {
  ticketId: string;
  seatId: string;
  shopId: string;
  userId: string;
  startedAt: Date;
  plannedEndAt: Date;
  status: UsageSessionStatus;
  endedAt?: Date;
  bullmqJobId?: string;
  failureReason?: string;
}) {
  return prisma.usageSession.create({
    data: {
      ticketId: params.ticketId,
      seatId: params.seatId,
      shopId: params.shopId,
      userId: params.userId,
      startedAt: params.startedAt,
      plannedEndAt: params.plannedEndAt,
      status: params.status,
      endedAt: params.endedAt,
      bullmqJobId: params.bullmqJobId,
      failureReason: params.failureReason,
      createdAt: params.startedAt,
    },
  });
}

// ─────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────

async function main() {
  await resetSeedData();
  await seedUsers();
  await seedOAuthAccounts();
  await seedShopsAndSeats();
  await seedProducts();

  // ═══════════════════════════════════════════════════════
  // Order/Payment 상태별 시나리오
  // ═══════════════════════════════════════════════════════

  // 1) 결제 성공 - 정기권(강남) 단일 상품 - user1 (아래에서 ACTIVE 세션으로 사용됨)
  const order1 = await createOrderWithRelations({
    userId: USER.user1,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamPeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 100000,
        discountAmount: 0,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: subDays(now, 15),
  });

  // 2) 결제 성공 - 시간권(강남, 할인 적용) 단일 상품 - user1 (아래에서 전액 환불 완료됨)
  const order2 = await createOrderWithRelations({
    userId: USER.user1,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 5000,
        usableDays: 60,
        purchasedMinutes: 600,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: subDays(now, 12),
  });

  // 3) 결제 대기중(PENDING) - 정기권(홍대) 단일 상품 - user2, 현금 결제 요청 전
  const order3 = await createOrderWithRelations({
    userId: USER.user2,
    shopId: SHOP.hongdae,
    items: [
      {
        productId: PRODUCT.hongdaePeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 90000,
        discountAmount: 0,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
    ],
    paymentType: PaymentType.CASH,
    paymentStatus: PaymentStatus.PENDING,
    createdAt: subHours(now, 2),
  });

  // 4) 결제 요청중(REQUESTED) - 시간권(강남) 단일 상품 - user2, VAN사 승인 대기 중
  const order4 = await createOrderWithRelations({
    userId: USER.user2,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.REQUESTED,
    createdAt: subMinutes(now, 30),
  });

  // 5) 결제 실패 - 시간권(강남) 단일 상품 - user2, 카드 한도 초과
  const order5 = await createOrderWithRelations({
    userId: USER.user2,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.FAILED,
    paymentReason: '카드 한도 초과',
    createdAt: subDays(now, 3),
  });

  // 6) 결제 취소(CANCELLED) - 정기권(강남) 단일 상품 - user3, 결제 자체가 승인 직후 매장 사정으로 취소됨
  const order6 = await createOrderWithRelations({
    userId: USER.user3,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamPeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 100000,
        discountAmount: 0,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.CANCELLED,
    paymentReason: '매장 요청으로 결제 취소',
    createdAt: subDays(now, 7),
  });

  // 7) 결제 성공 - 정기권 + 시간권 동시 구매(order_items 2건) - user1 (아래에서 시간권만 부분 환불)
  const order7 = await createOrderWithRelations({
    userId: USER.user1,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamPeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 100000,
        discountAmount: 10000,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: subDays(now, 20),
  });

  // 8) 결제 성공 - 같은 상품(시간권) 2개 재구매(order_items 2건) - user1 (아래에서 순차 부분취소로 전액 소진)
  const order8 = await createOrderWithRelations({
    userId: USER.user1,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: subDays(now, 18),
  });

  // 9) 결제 성공 - 정기권+시간권+시간권 3개 상품 묶음(order_items 3건) - user2 (아래에서 전체 취소)
  const order9 = await createOrderWithRelations({
    userId: USER.user2,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamPeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 100000,
        discountAmount: 0,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 5000,
        usableDays: 60,
        purchasedMinutes: 600,
      },
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 5000,
        usableDays: 60,
        purchasedMinutes: 600,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: subDays(now, 25),
  });

  // 10) 결제 대기중 - 정기권+시간권 다건 주문(2건, 미승인이라 Ticket 없음) - user2
  const order10 = await createOrderWithRelations({
    userId: USER.user2,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamPeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 100000,
        discountAmount: 0,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
    ],
    paymentType: PaymentType.CASH,
    paymentStatus: PaymentStatus.PENDING,
    createdAt: subHours(now, 5),
  });

  // 11) 결제 실패 - 시간권 2개 다건 주문(2건, 승인 실패라 Ticket 없음) - user1
  const order11 = await createOrderWithRelations({
    userId: USER.user1,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.FAILED,
    paymentReason: '카드 유효기간 만료',
    createdAt: subDays(now, 4),
  });

  // 12) 결제 성공 - 홍대점 정기권 2개 수량(2건) - user2 (아래에서 순차 부분취소, 미완료 잔여 남김)
  const order12 = await createOrderWithRelations({
    userId: USER.user2,
    shopId: SHOP.hongdae,
    items: [
      {
        productId: PRODUCT.hongdaePeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 90000,
        discountAmount: 0,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
      {
        productId: PRODUCT.hongdaePeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 90000,
        discountAmount: 9000,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: subDays(now, 22),
  });

  // 13) 결제 성공 - 정기권+시간권 동시구매(2건) - user1 (아래에서 전체 환불 요청, 미확정 상태)
  const order13 = await createOrderWithRelations({
    userId: USER.user1,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamPeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 100000,
        discountAmount: 0,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: subDays(now, 9),
  });

  // 14) 결제 성공 - 시간권+시간권+정기권 3건 - user2 (아래에서 PG 취소 거절(FAILED) 이력 포함)
  const order14 = await createOrderWithRelations({
    userId: USER.user2,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
      {
        productId: PRODUCT.gangnamPeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 100000,
        discountAmount: 0,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: subDays(now, 6),
  });

  // 15) 결제 성공 - 짧은 시간권(120분, 홍대) - user3, 소진(EXHAUSTED) 시나리오 전용
  const order15 = await createOrderWithRelations({
    userId: USER.user3,
    shopId: SHOP.hongdae,
    items: [
      {
        productId: PRODUCT.hongdaeTime120,
        ticketType: TicketType.TIME,
        originalAmount: 12000,
        discountAmount: 0,
        usableDays: 30,
        purchasedMinutes: 120,
      },
    ],
    paymentType: PaymentType.CASH,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: subDays(now, 40),
  });

  // 16) 결제 성공 - 이미 판매 종료(비활성)된 상품을 과거에 구매한 이력 - user4
  const order16 = await createOrderWithRelations({
    userId: USER.user4,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamTime300Inactive,
        ticketType: TicketType.TIME,
        originalAmount: 30000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 300,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: subDays(now, 50),
  });

  // 17) 결제 성공 - 소프트 삭제된 상품(체험 정기권)을 과거에 구매한 이력 - user4, 활성화 기한이 지나 EXPIRED 대상
  const order17 = await createOrderWithRelations({
    userId: USER.user4,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamPeriod7Deleted,
        ticketType: TicketType.PERIOD,
        originalAmount: 20000,
        discountAmount: 0,
        usableDays: 7,
        purchasedDurationDays: 7,
      },
    ],
    paymentType: PaymentType.CASH,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: subDays(now, 60),
  });

  // 18) 결제 성공 - 정기권(강남) - user3, 관리자 강제 회수(REVOKED) 시나리오 전용
  const order18 = await createOrderWithRelations({
    userId: USER.user3,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamPeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 100000,
        discountAmount: 0,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: subDays(now, 11),
  });

  // 19) 결제 성공 - 정기권(강남) - user3, 여러 번 입퇴실 + 일시정지가 교차하는 다회 이용 시나리오 전용
  const order19 = await createOrderWithRelations({
    userId: USER.user3,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamPeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 100000,
        discountAmount: 0,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
    ],
    paymentType: PaymentType.CARD,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: subDays(now, 14),
  });

  // ═══════════════════════════════════════════════════════
  // Order 1:N Payment(분할결제/재시도) 시나리오 — 결제 1건만 붙는 주문과 별개로 다건 결제를 커버한다
  // ═══════════════════════════════════════════════════════

  // 20) 결제 재시도 끝에 성공(FAILED 2건 + SUCCESS 1건) - 정기권+시간권(150000원) - user4
  //     1차 카드 한도초과 실패 → 2차 PG사 응답없음 실패 → 3차 카드 재시도로 성공, 티켓은 성공 시점에 발급
  const order20 = await createOrderWithMultiplePayments({
    userId: USER.user4,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamPeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 100000,
        discountAmount: 0,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
    ],
    payments: [
      { type: PaymentType.CARD, status: PaymentStatus.FAILED, reason: '카드 한도 초과', attemptOffsetMinutes: 0 },
      {
        type: PaymentType.CARD,
        status: PaymentStatus.FAILED,
        reason: 'PG사 응답 없음(타임아웃)',
        attemptOffsetMinutes: 5,
      },
      { type: PaymentType.CARD, status: PaymentStatus.SUCCESS, attemptOffsetMinutes: 12 },
    ],
    createdAt: subDays(now, 17),
  });

  // 21) 결제 재시도 성공(FAILED 1건 + SUCCESS 1건) - 시간권(50000원) - user2, 1차 카드 결제가 한도초과로 실패한 뒤 2차 카드 재시도로 성공, 티켓은 재시도 성공 시점에 발급
  const order21 = await createOrderWithMultiplePayments({
    userId: USER.user2,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
    ],
    payments: [
      { type: PaymentType.CARD, status: PaymentStatus.FAILED, reason: '카드 한도 초과', attemptOffsetMinutes: 0 },
      { type: PaymentType.CARD, status: PaymentStatus.SUCCESS, attemptOffsetMinutes: 10 },
    ],
    createdAt: subDays(now, 6),
  });

  // 22) 재시도 전부 실패로 미해결(FAILED 2건) - 정기권(100000원) - user3, 두 차례 카드 재시도 모두 실패하고 아직 해결되지 않은 주문
  //     SUCCESS가 한 건도 없으므로 티켓 미발급 — 고객이 재시도하거나 주문을 포기할 때까지 남아있는 스냅샷
  const order22 = await createOrderWithMultiplePayments({
    userId: USER.user3,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamPeriod30,
        ticketType: TicketType.PERIOD,
        originalAmount: 100000,
        discountAmount: 0,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
    ],
    payments: [
      { type: PaymentType.CARD, status: PaymentStatus.FAILED, reason: '카드 한도 초과', attemptOffsetMinutes: 0 },
      {
        type: PaymentType.CARD,
        status: PaymentStatus.FAILED,
        reason: 'PG사 시스템 점검으로 인한 일시 오류',
        attemptOffsetMinutes: 30,
      },
    ],
    createdAt: subHours(now, 1),
  });

  // 23) 결제를 아예 시도하지 않은 주문 - 시간권(강남) - user4, 주문만 생성되고 결제 버튼을 누르지 않은 장바구니 이탈 상태(Payment 행 자체가 없음)
  const order23 = await createOrderWithoutPayment({
    userId: USER.user4,
    shopId: SHOP.gangnam,
    items: [
      {
        productId: PRODUCT.gangnamTime600,
        ticketType: TicketType.TIME,
        originalAmount: 50000,
        discountAmount: 0,
        usableDays: 60,
        purchasedMinutes: 600,
      },
    ],
    createdAt: subMinutes(now, 20),
  });

  console.log(
    'Order/OrderItem/Payment 생성 완료: 23건 (PENDING/REQUESTED/SUCCESS/FAILED/CANCELLED 전 상태 커버, order당 payment 다건(재시도 체인) 3건 포함, 결제 미시도(payment 0건) 1건 포함)',
  );

  // 환불 사례는 현재 계약을 사용하는 환불 E2E 컨텍스트에서 생성한다.
  // 이 일반 개발 시드에는 구형 부분 환불·RefundLock 예제를 만들지 않는다.

  // ═══════════════════════════════════════════════════════
  // TicketPause 시나리오 (order1/order7/order9/order12/order13 등의 티켓 활용)
  // ═══════════════════════════════════════════════════════

  // 정지1) 현재 일시정지 중 - user1의 정기권(order1), 고객 본인 요청(여행)
  const pause1 = await createTicketPause({
    ticketId: order1.tickets[0].id,
    pausedAt: subDays(now, 2),
    pausedReason: '여행으로 인한 이용 일시중단 요청',
    pausedBy: USER.user1,
  });

  // 정지2) 완료된 일시정지 - user2의 정기권(order3 대기중이므로 대신 order9의 정기권 사용은 이미 환불이라 order10은 티켓 없음)
  //         → order14의 첫 시간권 대신, 실제로 살아있는 정기권 order18 사용: 매장 기기 점검으로 관리자가 정지 후 재개
  const pause2 = await createTicketPause({
    ticketId: order18.tickets[0].id,
    pausedAt: subDays(now, 5),
    pausedReason: '매장 기기 점검으로 인한 일시정지',
    pausedBy: SYSTEM_ACTOR,
    resumedAt: subDays(now, 4),
    resumedReason: '점검 완료',
    resumedBy: SYSTEM_ACTOR,
  });

  // 정지3a/3b) 순차적인 일시정지 이력 2건(같은 티켓) - user2의 정기권(order9, 전체취소된 정기권이 아니라 실제 남아있는 티켓 필요)
  //            → 다른 예시와 겹치지 않도록 order12 두 번째 정기권 사용
  const pause3a = await createTicketPause({
    ticketId: order12.tickets[1].id,
    pausedAt: subDays(now, 20),
    pausedReason: '해외 출장으로 인한 이용 일시중단',
    pausedBy: USER.user2,
    resumedAt: subDays(now, 18),
    resumedReason: '귀국 후 이용 재개',
    resumedBy: USER.user2,
  });
  const pause3b = await createTicketPause({
    ticketId: order12.tickets[1].id,
    pausedAt: subDays(now, 8),
    pausedReason: '개인 사정으로 인한 이용 일시중단',
    pausedBy: USER.user2,
    resumedAt: subHours(now, 40),
    resumedReason: '이용 재개',
    resumedBy: USER.user2,
  });

  // 정지4) 현재 일시정지 중 - user2의 시간권(order14 첫 번째, 부분 환불 요청 진행 중인 것과 별개 티켓), 결제 분쟁 조사로 관리자 강제 정지
  const pause4 = await createTicketPause({
    ticketId: order14.tickets[0].id,
    pausedAt: subHours(now, 6),
    pausedReason: '결제 분쟁 조사로 인한 강제 일시정지',
    pausedBy: SYSTEM_ACTOR,
  });

  console.log('TicketPause 생성 완료: 5건 (진행중 2, 완료 3, 동일 티켓 순차이력 포함) — 정지6(order19)은 UsageSession 섹션에서 추가 생성');
  void pause1;
  void pause2;
  void pause3a;
  void pause3b;
  void pause4;

  // ═══════════════════════════════════════════════════════
  // Ticket 상태 수동 전환 (도메인 서비스가 아직 배치 처리를 구현하지 않은 EXPIRED/REVOKED)
  // ═══════════════════════════════════════════════════════

  // order17의 정기권: 활성화 기한(구매 후 7일)이 지나도록 방치되어 EXPIRED 처리된 케이스
  await prisma.ticket.update({
    where: { id: order17.tickets[0].id },
    data: { status: TicketStatus.EXPIRED },
  });

  // order18의 정기권: 관리자에 의해 강제 회수(REVOKED)된 케이스 (분쟁/약관 위반 등)
  await prisma.ticket.update({
    where: { id: order18.tickets[0].id },
    data: { status: TicketStatus.REVOKED },
  });

  console.log('Ticket 상태 수동 전환 완료: EXPIRED 1건, REVOKED 1건');

  // ═══════════════════════════════════════════════════════
  // UsageSession 시나리오
  // ═══════════════════════════════════════════════════════

  // 세션1) ACTIVE - user1이 order1의 정기권으로 강남 A1 좌석에서 현재 이용 중 (첫 입장이므로 티켓도 활성화)
  const period1 = order1.tickets[0];
  const activatedAt1 = subHours(now, 1);
  const expiresAt1 = addDays(activatedAt1, 30);
  await prisma.ticket.update({
    where: { id: period1.id },
    data: { status: TicketStatus.ACTIVE, activatedAt: activatedAt1, expiresAt: expiresAt1 },
  });
  await createUsageSession({
    ticketId: period1.id,
    seatId: SEAT.gangnamA1,
    shopId: SHOP.gangnam,
    userId: USER.user1,
    startedAt: activatedAt1,
    plannedEndAt: expiresAt1,
    status: UsageSessionStatus.ACTIVE,
    bullmqJobId: 'bullmq-job-active-0001',
  });

  // 세션2) ENDED - user4가 order16의 시간권(300분)으로 1차 입장, 40분 이용 후 정상 조기 퇴실
  //         (같은 티켓을 여러 번 나눠 쓰는 패턴의 1회차 — 2회차는 세션7, 3회차는 세션7b)
  const time16 = order16.tickets[0];
  const started2 = subDays(now, 49);
  const ended2 = addMinutes(started2, 40);
  await prisma.$executeRawUnsafe(
    `UPDATE tickets SET remaining_minutes = remaining_minutes - 40 WHERE id = $1`,
    time16.id,
  );
  await createUsageSession({
    ticketId: time16.id,
    seatId: SEAT.gangnamA2,
    shopId: SHOP.gangnam,
    userId: USER.user4,
    startedAt: started2,
    plannedEndAt: addMinutes(started2, 300),
    status: UsageSessionStatus.ENDED,
    endedAt: ended2,
    bullmqJobId: 'bullmq-job-ended-0002',
  });

  // 세션3) ENDED + EXHAUSTED - user3의 order15 짧은 시간권(120분)을 정확히 다 소진하고 종료
  const time15 = order15.tickets[0];
  const started3 = subDays(now, 39);
  const ended3 = addMinutes(started3, 120);
  await prisma.ticket.update({
    where: { id: time15.id },
    data: { remainingMinutes: 0, status: TicketStatus.EXHAUSTED },
  });
  await createUsageSession({
    ticketId: time15.id,
    seatId: SEAT.hongdaeB1,
    shopId: SHOP.hongdae,
    userId: USER.user3,
    startedAt: started3,
    plannedEndAt: ended3,
    status: UsageSessionStatus.ENDED,
    endedAt: ended3,
    bullmqJobId: 'bullmq-job-ended-0003',
  });

  // 세션4) JOB_CREATION_FAILED - user2가 order14의 두 번째 시간권으로 입장 시도했으나 BullMQ 큐 연결 실패로 세션 생성 자체가 실패
  const time14b = order14.tickets[1];
  const started4 = subHours(now, 3);
  await createUsageSession({
    ticketId: time14b.id,
    seatId: SEAT.gangnamA1,
    shopId: SHOP.gangnam,
    userId: USER.user2,
    startedAt: started4,
    plannedEndAt: addMinutes(started4, 600),
    status: UsageSessionStatus.JOB_CREATION_FAILED,
    failureReason: 'Redis connection timeout: BullMQ 큐 연결 실패',
  });

  // 세션5) JOB_REGISTER_FAILED - user2가 order12 두 번째 정기권(환불 완료된 티켓은 제외, 첫 번째 정기권 사용)으로
  //         입장 시도, Job은 생성됐으나 DB에 bullmqJobId 등록 단계에서 세션 상태 불일치(P2025)로 실패
  const period12a = order12.tickets[0];
  const started5 = subHours(now, 4);
  await createUsageSession({
    ticketId: period12a.id,
    seatId: SEAT.hongdaeB2,
    shopId: SHOP.hongdae,
    userId: USER.user2,
    startedAt: started5,
    plannedEndAt: addDays(started5, 30),
    status: UsageSessionStatus.JOB_REGISTER_FAILED,
    failureReason: 'JobRegistrationFailedError: 세션 상태가 ACTIVE가 아니어서 job 등록 실패',
  });

  // 세션6) EXTERNAL_API_FAILED - user1이 order13 시간권(전체 환불 요청 중이라도 세션 이력 자체는 그 이전 시도 기록)으로
  //         입장 시도, 문열림 외부 API가 3회 재시도 끝에 실패
  const time13 = order13.tickets[1];
  const started6 = subDays(now, 8);
  await createUsageSession({
    ticketId: time13.id,
    seatId: SEAT.gangnamA2,
    shopId: SHOP.gangnam,
    userId: USER.user1,
    startedAt: started6,
    plannedEndAt: addMinutes(started6, 600),
    status: UsageSessionStatus.EXTERNAL_API_FAILED,
    failureReason: '외부 도어락 API 3회 재시도 실패: 응답 없음',
  });

  // 세션7) ENDED - user4가 order16의 같은 시간권으로 2차 입장(같은 티켓을 여러 번 나눠 쓰는 패턴), 25분 이용 후 조기 퇴실
  const started7 = subDays(now, 45);
  const ended7 = addMinutes(started7, 25);
  await prisma.$executeRawUnsafe(
    `UPDATE tickets SET remaining_minutes = remaining_minutes - 25 WHERE id = $1`,
    time16.id,
  );
  await createUsageSession({
    ticketId: time16.id,
    seatId: SEAT.gangnamA1,
    shopId: SHOP.gangnam,
    userId: USER.user4,
    startedAt: started7,
    plannedEndAt: addMinutes(started7, 300),
    status: UsageSessionStatus.ENDED,
    endedAt: ended7,
    bullmqJobId: 'bullmq-job-ended-0007',
  });

  // 세션7b) ENDED - user4가 order16의 같은 시간권으로 3차 입장(3회차), 60분 이용 후 조기 퇴실
  //          (TIME 티켓 하나를 세 번에 걸쳐 나눠 쓰는 패턴 완성: 세션2 40분 → 세션7 25분 → 세션7b 60분, 잔여 175분)
  const started7b = subDays(now, 3);
  const ended7b = addMinutes(started7b, 60);
  await prisma.$executeRawUnsafe(
    `UPDATE tickets SET remaining_minutes = remaining_minutes - 60 WHERE id = $1`,
    time16.id,
  );
  await createUsageSession({
    ticketId: time16.id,
    seatId: SEAT.gangnamA2,
    shopId: SHOP.gangnam,
    userId: USER.user4,
    startedAt: started7b,
    plannedEndAt: addMinutes(started7b, 300),
    status: UsageSessionStatus.ENDED,
    endedAt: ended7b,
    bullmqJobId: 'bullmq-job-ended-0007b',
  });

  // 세션8a/8b) ENDED × 2 - user3가 order19의 정기권으로 여러 번 입퇴실(PERIOD 티켓도 TIME처럼 여러 세션에 걸쳐 나눠 쓰이는 패턴)
  //            정기권은 첫 입장 시 activatedAt/expiresAt이 확정되므로, 이후 재입장은 티켓을 다시 활성화하지 않고 세션만 추가된다.
  const period19 = order19.tickets[0];
  const activatedAt19 = subDays(now, 13);
  const expiresAt19 = addDays(activatedAt19, 30);
  await prisma.ticket.update({
    where: { id: period19.id },
    data: { status: TicketStatus.ACTIVE, activatedAt: activatedAt19, expiresAt: expiresAt19 },
  });

  const started8a = activatedAt19;
  const ended8a = addHours(started8a, 3);
  await createUsageSession({
    ticketId: period19.id,
    seatId: SEAT.gangnamA1,
    shopId: SHOP.gangnam,
    userId: USER.user3,
    startedAt: started8a,
    plannedEndAt: expiresAt19,
    status: UsageSessionStatus.ENDED,
    endedAt: ended8a,
    bullmqJobId: 'bullmq-job-ended-0008a',
  });

  const started8b = subDays(now, 9);
  const ended8b = addHours(started8b, 2);
  await createUsageSession({
    ticketId: period19.id,
    seatId: SEAT.gangnamA2,
    shopId: SHOP.gangnam,
    userId: USER.user3,
    startedAt: started8b,
    plannedEndAt: expiresAt19,
    status: UsageSessionStatus.ENDED,
    endedAt: ended8b,
    bullmqJobId: 'bullmq-job-ended-0008b',
  });

  // 정지6) 위 정기권(order19)이 두 번째 이용 후 일시정지되었다가 재개된 이력
  //        (입장→퇴실→일시정지→재개→재입장이 교차하는 현실적인 타임라인)
  await createTicketPause({
    ticketId: period19.id,
    pausedAt: addHours(ended8b, 1),
    pausedReason: '건강상의 이유로 일시중단 요청',
    pausedBy: USER.user3,
    resumedAt: subDays(now, 4),
    resumedReason: '컨디션 회복 후 이용 재개',
    resumedBy: USER.user3,
  });

  // 세션9) ACTIVE - user3가 일시정지 재개 후 같은 정기권으로 다시 입장, 현재 이용 중
  //         (같은 티켓에서 세션 종료 → 일시정지 → 재개 → 새 세션 시작까지 전체 생애주기를 커버)
  const started9 = subHours(now, 2);
  await createUsageSession({
    ticketId: period19.id,
    seatId: SEAT.gangnamA1,
    shopId: SHOP.gangnam,
    userId: USER.user3,
    startedAt: started9,
    plannedEndAt: expiresAt19,
    status: UsageSessionStatus.ACTIVE,
    bullmqJobId: 'bullmq-job-active-0009',
  });

  console.log(
    'UsageSession 생성 완료: 11건 (ACTIVE 2, ENDED 7(TIME 티켓 3회 재사용 1건 + PERIOD 티켓 2회 재사용/일시정지 교차 1건 포함), JOB_CREATION_FAILED 1, JOB_REGISTER_FAILED 1, EXTERNAL_API_FAILED 1)',
  );

  console.log('\n✅ 전체 시드 데이터 생성 완료');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
