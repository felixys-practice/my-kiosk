/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { type App } from 'supertest/types';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { SeatStatus, SeatType, TicketType, UserRole } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

/**
 * 환불 E2E 공용 컨텍스트
 * - 앱을 main.ts와 같은 파이프·인터셉터·필터로 띄운다(test/seat-type.e2e-spec.ts와 동일)
 * - 고객·점주·공동 점주·다른 매장 점주·MANAGER와 매장 두 개를 만든다
 * - 이용권은 실제 상품 등록·주문·결제 API로 발급한다
 * - close()는 이 컨텍스트가 만든 사용자·매장의 데이터만 FK 역순으로 지운다
 */

/** 테스트 사용자와 그 사용자의 액세스 토큰 */
export type TestActor = {
  id: string;
  email: string;
  role: UserRole;
  token: string;
};

/** 테스트 매장 */
export type TestShop = { id: string; name: string };

/** 발급한 이용권과 주문·결제 식별자 */
export type IssuedTicket = {
  ticketId: string;
  orderId: string;
  orderItemId: string;
  paymentId: string;
  productId: string;
  amount: number; // 결제 금액(원)
  seatId?: string; // 고정석 이용권이면 배정된 좌석 ID
};

/** 이용권 발급 조건 */
export type IssueTicketOptions = {
  shop?: TestShop; // 기본: 주 매장
  owner?: TestActor; // 상품을 등록할 점주(기본: 주 매장 점주)
  buyer?: TestActor; // 구매 고객(기본: 고객)
  amount?: number; // 상품 가격(기본: 10000원)
  fixedSeat?: boolean; // true면 고정석 좌석을 만들어 배정한다(기본: 자유석)
};

export type RefundTestContext = {
  app: INestApplication;
  server: App;
  prisma: PrismaService;
  /** 이용권을 사는 고객 */
  customer: TestActor;
  /** 같은 매장의 다른 고객(본인 아닌 이용권 접근 확인용) */
  otherCustomer: TestActor;
  /** 주 매장 점주 */
  owner: TestActor;
  /** 주 매장의 공동 점주 */
  coOwner: TestActor;
  /** 다른 매장의 점주(소유 범위 밖 접근 확인용) */
  otherShopOwner: TestActor;
  /** 운영자 */
  manager: TestActor;
  /** 주 매장(owner·coOwner 소유) */
  shop: TestShop;
  /** 다른 매장(otherShopOwner 소유) */
  otherShop: TestShop;
  /** 고정석·자유석 좌석을 DB에 직접 만든다 */
  createSeat(type: SeatType, shop?: TestShop): Promise<string>;
  /** 시간권(600분)을 주문·결제해 발급한다 */
  issueTimeTicket(options?: IssueTicketOptions): Promise<IssuedTicket>;
  /** 정기권(30일)을 주문·결제해 발급한다 */
  issuePeriodTicket(options?: IssueTicketOptions): Promise<IssuedTicket>;
  /** 이 컨텍스트가 만든 데이터를 지우고 앱을 닫는다 */
  close(): Promise<void>;
};

/** 기본 상품 가격(원) */
const defaultTicketAmount = 10000;
/** 시간권 구매 시간(분) */
const timeTicketMinutes = 600;
/** 정기권 이용 기간(일)·사용 가능 기간(일) */
const periodTicketDays = 30;

/**
 * 환불 E2E 컨텍스트를 만든다
 * @param options.label 이메일·매장 이름에 붙여 다른 E2E 파일 데이터와 구분할 이름
 * @param options.configure 모듈 컴파일 전에 provider를 바꾸는 함수(PG 대역 교체 등, T018에서 연결)
 * @returns 앱과 기본 사용자·매장, 데이터 생성 함수
 */
export async function createRefundTestContext(options: {
  label: string;
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}): Promise<RefundTestContext> {
  // 앱을 main.ts와 같은 전역 설정으로 띄운다
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleFixture = await (
    options.configure ? options.configure(builder) : builder
  ).compile();
  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();

  const server: App = app.getHttpServer();
  const prisma = app.get(PrismaService);
  const jwtService = app.get(JwtService);

  // 다른 실행·파일과 겹치지 않는 접미사
  const suffix = `${options.label}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const shopIds: string[] = [];
  let nextSeatNumber = 1;

  /**
   * 사용자를 만들고 액세스 토큰을 발급한다
   * @param name 이메일에 넣을 구분 이름
   * @param role 사용자 역할
   * @returns 토큰이 포함된 테스트 사용자
   */
  async function createActor(name: string, role: UserRole): Promise<TestActor> {
    // 사용자 생성 후 정리 대상에 등록한다
    const user = await prisma.user.create({
      data: {
        email: `e2e-refund-${name}-${suffix}@test.com`,
        role,
        password: 'hashed',
      },
    });
    userIds.push(user.id);

    // 로그인 API 대신 같은 형식의 토큰을 직접 서명한다
    const token = jwtService.sign({
      sub: user.id,
      email: user.email,
      role,
      type: 'access',
      jti: randomUUID(),
    });
    return { id: user.id, email: user.email, role, token };
  }

  /**
   * 매장을 만들고 점주들을 연결한다
   * @param name 매장 이름에 넣을 구분 이름
   * @param owners 연결할 점주들
   * @returns 테스트 매장
   */
  async function createShop(
    name: string,
    owners: TestActor[],
  ): Promise<TestShop> {
    // 매장 생성 후 정리 대상에 등록한다
    const shop = await prisma.shop.create({
      data: { name: `E2E환불-${name}-${suffix}` },
    });
    shopIds.push(shop.id);

    // 점주 연결(공동 점주 포함)
    for (const owner of owners) {
      await prisma.shopOwner.create({
        data: { shopId: shop.id, userId: owner.id },
      });
    }
    return { id: shop.id, name: shop.name };
  }

  // 기본 사용자와 매장
  const customer = await createActor('customer', UserRole.USER);
  const otherCustomer = await createActor('other-customer', UserRole.USER);
  const owner = await createActor('owner', UserRole.OWNER);
  const coOwner = await createActor('co-owner', UserRole.OWNER);
  const otherShopOwner = await createActor('other-owner', UserRole.OWNER);
  const manager = await createActor('manager', UserRole.MANAGER);
  const shop = await createShop('main', [owner, coOwner]);
  const otherShop = await createShop('other', [otherShopOwner]);

  /**
   * 좌석을 DB에 직접 만든다
   * @param type 좌석 타입
   * @param targetShop 좌석을 둘 매장(기본: 주 매장)
   * @returns 좌석 ID
   */
  async function createSeat(
    type: SeatType,
    targetShop: TestShop = shop,
  ): Promise<string> {
    const seat = await prisma.seat.create({
      data: {
        number: nextSeatNumber++,
        shopId: targetShop.id,
        type,
        status: SeatStatus.AVAILABLE,
      },
    });
    return seat.id;
  }

  /**
   * 상품을 등록하고 주문·결제해 이용권을 발급한다
   * @param ticketType 이용권 종류
   * @param issueOptions 발급 조건
   * @returns 발급한 이용권과 주문·결제 식별자
   */
  async function issueTicket(
    ticketType: TicketType,
    issueOptions: IssueTicketOptions = {},
  ): Promise<IssuedTicket> {
    const targetShop = issueOptions.shop ?? shop;
    const productOwner =
      issueOptions.owner ??
      (targetShop.id === otherShop.id ? otherShopOwner : owner);
    const buyer = issueOptions.buyer ?? customer;
    const amount = issueOptions.amount ?? defaultTicketAmount;
    const seatType = issueOptions.fixedSeat ? SeatType.FIXED : SeatType.FREE;

    // 점주 권한으로 상품 등록
    const base = {
      type: ticketType,
      name: `E2E환불상품-${ticketType}-${randomUUID().slice(0, 8)}`,
      amount,
      usableDays: periodTicketDays,
      isActive: true,
      seatType,
    };
    const productBody =
      ticketType === TicketType.TIME
        ? { ...base, purchasedMinutes: timeTicketMinutes }
        : { ...base, purchasedDurationDays: periodTicketDays };
    const { body: product } = await request(server)
      .post(`/shops/${targetShop.id}/products`)
      .set('Authorization', `Bearer ${productOwner.token}`)
      .send(productBody)
      .expect(201);
    const productId = product.data as string;

    // 고정석이면 좌석을 만들어 주문에 지정한다
    const seatId = issueOptions.fixedSeat
      ? await createSeat(SeatType.FIXED, targetShop)
      : undefined;

    // 고객 주문
    const { body: order } = await request(server)
      .post('/orders')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        shopId: targetShop.id,
        userId: buyer.id,
        orderedProducts: [
          { productId, quantity: 1, ...(seatId ? { seatId } : {}) },
        ],
      })
      .expect(201);
    const orderId = order.data.id as string;

    // 결제 요청 후 PG 승인 콜백(현재 결제 콜백은 JWT 인증, US7에서 서명 인증으로 바뀌면 함께 수정)
    const { body: paymentRes } = await request(server)
      .post('/payments')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ orderId, userId: buyer.id })
      .expect(201);
    const paymentId = paymentRes.data.paymentId as string;
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    await request(server)
      .post('/payments/callback')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        success: true,
        pgTransactionId: payment.pgTransactionId,
        amount: payment.amount,
        reason: null,
      })
      .expect(201);

    // 발급된 이용권 조회
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { orderItem: { orderId } },
    });
    return {
      ticketId: ticket.id,
      orderId,
      orderItemId: ticket.orderItemId,
      paymentId,
      productId,
      amount,
      seatId,
    };
  }

  /**
   * 이 컨텍스트가 만든 데이터를 FK 역순으로 지우고 앱을 닫는다
   * - 다른 E2E 파일의 데이터는 건드리지 않도록 사용자·매장 ID로만 지운다
   * - 새 환불 테이블은 스키마 작업(T007~T010)에서 생기면 여기에 추가한다
   */
  async function close(): Promise<void> {
    const byOrderUser = { order: { userId: { in: userIds } } };
    await prisma.ledger.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.refundLock.deleteMany({ where: { orderItem: byOrderUser } });
    await prisma.paymentCancel.deleteMany({ where: { payment: byOrderUser } });
    await prisma.ticketSeatChange.deleteMany({
      where: { ticket: { userId: { in: userIds } } },
    });
    await prisma.seatAssignment.deleteMany({
      where: { seat: { shopId: { in: shopIds } } },
    });
    await prisma.ticketPause.deleteMany({
      where: { ticket: { userId: { in: userIds } } },
    });
    await prisma.usageSession.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.ticket.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.payment.deleteMany({ where: byOrderUser });
    await prisma.orderItem.deleteMany({ where: byOrderUser });
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.productHistory.deleteMany({
      where: { product: { shopId: { in: shopIds } } },
    });
    await prisma.product.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.seat.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopOwner.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });

    await prisma.$disconnect();
    await app.close();
  }

  return {
    app,
    server,
    prisma,
    customer,
    otherCustomer,
    owner,
    coOwner,
    otherShopOwner,
    manager,
    shop,
    otherShop,
    createSeat,
    issueTimeTicket: (o) => issueTicket(TicketType.TIME, o),
    issuePeriodTicket: (o) => issueTicket(TicketType.PERIOD, o),
    close,
  };
}
