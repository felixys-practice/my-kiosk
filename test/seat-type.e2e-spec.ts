/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { type App } from 'supertest/types';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import {
  SeatAssignmentStatus,
  SeatStatus,
  SeatType,
  TicketStatus,
  TicketType,
  UsageSessionStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';

/**
 * 좌석 타입(고정석·자유석) 기능 E2E 테스트
 * - 테스트 이름 끝의 (QS-n)은 specs/001-seat-type/quickstart.md의 시나리오 번호
 */
/** 주문·결제를 요청하는 이용자 */
type Buyer = { userId: string; token: string };

describe('좌석 타입 (E2E)', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;
  let jwtService: JwtService;

  // 테스트 엔티티 (정리용으로 ID 추적)
  let ownerUser: { id: string; email: string };
  let normalUser: { id: string; email: string };
  let otherUser: { id: string; email: string };
  let shop: { id: string };
  let periodProduct: { id: string };

  let ownerToken: string;
  let userToken: string;
  let otherUserToken: string;

  // 좌석 번호 중복 방지용 카운터 (매장 내 좌석 번호는 유일)
  let nextSeatNumber = 100;

  /**
   * 테스트용 액세스 토큰을 발급한다
   * @param user 토큰 주체 사용자
   * @param role JWT payload에 담을 역할
   * @returns 서명된 액세스 토큰
   */
  function signAccessToken(
    user: { id: string; email: string },
    role: 'OWNER' | 'USER',
  ): string {
    return jwtService.sign({
      sub: user.id,
      email: user.email,
      role,
      type: 'access',
      jti: randomUUID(),
    });
  }

  /**
   * 테스트 좌석을 DB에 직접 만든다
   * @param type 좌석 타입
   * @returns 좌석 ID
   */
  async function createSeat(type: SeatType): Promise<string> {
    const seat = await prisma.seat.create({
      data: {
        number: nextSeatNumber++,
        shopId: shop.id,
        type,
        status: SeatStatus.AVAILABLE,
      },
    });
    return seat.id;
  }

  /**
   * 좌석에 점유 중인 선점(HELD) 배정을 만든다
   * @param seatId 좌석 ID
   */
  async function holdSeat(seatId: string): Promise<void> {
    await prisma.seatAssignment.create({
      data: {
        seatId,
        status: SeatAssignmentStatus.HELD,
        heldUntil: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
  }

  /**
   * 활성화된 기간권과 그 좌석의 이용 중 세션을 만든다
   * @param seatId 이용 중으로 만들 좌석 ID
   * @returns 세션 ID
   */
  async function occupySeat(seatId: string): Promise<string> {
    const order = await prisma.order.create({
      data: {
        shopId: shop.id,
        userId: normalUser.id,
        originalAmount: 10000,
        discountAmount: 0,
        totalAmount: 10000,
      },
    });
    const orderItem = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: periodProduct.id,
        ticketType: TicketType.PERIOD,
        originalAmount: 10000,
        discountAmount: 0,
        amount: 10000,
        purchasedDurationDays: 30,
        usableDays: 30,
      },
    });
    const ticket = await prisma.ticket.create({
      data: {
        userId: normalUser.id,
        type: TicketType.PERIOD,
        status: TicketStatus.ACTIVE,
        orderItemId: orderItem.id,
        purchasedDurationDays: 30,
        activatedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const session = await prisma.usageSession.create({
      data: {
        ticketId: ticket.id,
        shopId: shop.id,
        seatId,
        userId: normalUser.id,
        startedAt: new Date(Date.now() - 30 * 60 * 1000),
        plannedEndAt: new Date(Date.now() + 60 * 60 * 1000),
        status: UsageSessionStatus.ACTIVE,
      },
    });
    return session.id;
  }

  /**
   * 점주 권한으로 좌석을 수정한다
   * @param seatId 좌석 ID
   * @param body 수정 본문
   * @returns supertest 요청
   */
  function patchSeat(seatId: string, body: object) {
    return request(server)
      .patch(`/seats/${seatId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(body);
  }

  /**
   * 점주 권한으로 상품을 API로 등록한다
   * @param seatType 상품의 좌석 타입
   * @param ticketType 이용권 종류(시간권·기간권)
   * @returns 상품 ID
   */
  async function createProduct(
    seatType: SeatType,
    ticketType: TicketType,
  ): Promise<string> {
    const base = {
      type: ticketType,
      name: `E2E상품-${seatType}-${ticketType}-${Date.now()}`,
      amount: 10000,
      usableDays: 30,
      isActive: true,
      seatType,
    };
    const body =
      ticketType === TicketType.TIME
        ? { ...base, purchasedMinutes: 600 }
        : { ...base, purchasedDurationDays: 30 };

    const res = await request(server)
      .post(`/shops/${shop.id}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(body)
      .expect(201);
    return res.body.data as string;
  }

  /**
   * 일반 사용자로 주문을 만든다
   * @param items 주문 항목 목록
   * @param buyer 주문자(기본: 일반 사용자)
   * @returns supertest 요청
   */
  function createOrder(
    items: { productId: string; quantity: number; seatId?: string }[],
    buyer: Buyer = { userId: normalUser.id, token: userToken },
  ) {
    return request(server)
      .post('/orders')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ shopId: shop.id, userId: buyer.userId, orderedProducts: items });
  }

  /**
   * 좌석 목록 API로 좌석의 선택 가능 여부를 조회한다
   * @param seatId 좌석 ID
   * @returns 선택 가능 여부
   */
  async function isSeatAssignable(seatId: string): Promise<boolean> {
    const { body } = await request(server)
      .get(`/shops/${shop.id}/seats`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const seats = body.data as { id: string; isAssignable: boolean }[];
    return seats.find((seat) => seat.id === seatId)!.isAssignable;
  }

  /**
   * 주문을 결제 요청하고 PG 결과 콜백을 보낸다
   * @param orderId 주문 ID
   * @param success 승인 성공 여부
   * @param buyer 주문자(기본: 일반 사용자)
   * @returns 결제 ID
   */
  async function payOrder(
    orderId: string,
    success = true,
    buyer: Buyer = { userId: normalUser.id, token: userToken },
  ): Promise<string> {
    const paymentId = await requestPayment(orderId, buyer);
    await sendPaymentCallback(paymentId, success);
    return paymentId;
  }

  /**
   * 주문의 결제를 요청한다(콜백은 보내지 않는다)
   * @param orderId 주문 ID
   * @param buyer 주문자(기본: 일반 사용자)
   * @returns 결제 ID
   */
  async function requestPayment(
    orderId: string,
    buyer: Buyer = { userId: normalUser.id, token: userToken },
  ): Promise<string> {
    const { body } = await request(server)
      .post('/payments')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ orderId, userId: buyer.userId })
      .expect(201);
    return body.data.paymentId as string;
  }

  /**
   * PG 결제 결과 콜백을 보낸다
   * @param paymentId 결제 ID(테스트 VAN은 PG 거래 ID로 결제 ID를 쓴다)
   * @param success 승인 성공 여부
   */
  async function sendPaymentCallback(
    paymentId: string,
    success: boolean,
  ): Promise<void> {
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    await request(server)
      .post('/payments/callback')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        success,
        pgTransactionId: payment.pgTransactionId,
        amount: payment.amount,
        reason: success ? null : 'E2E 승인 실패',
      })
      .expect(201);
  }

  /**
   * 주문의 첫 이용권을 조회한다
   * @param orderId 주문 ID
   * @returns 이용권 ID
   */
  async function findTicketIdByOrder(orderId: string): Promise<string> {
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { orderItem: { orderId } },
    });
    return ticket.id;
  }

  /**
   * 상품을 주문·결제해 이용권을 발급받는다
   * @param seatType 상품 좌석 타입
   * @param ticketType 이용권 종류
   * @param seatId 고정석 상품이면 배정할 좌석 ID
   * @returns 이용권 ID
   */
  async function issueTicket(
    seatType: SeatType,
    ticketType: TicketType,
    seatId?: string,
  ): Promise<string> {
    const productId = await createProduct(seatType, ticketType);
    const { body: order } = await createOrder([
      { productId, quantity: 1, ...(seatId ? { seatId } : {}) },
    ]).expect(201);
    await payOrder(order.data.id);
    return findTicketIdByOrder(order.data.id);
  }

  /**
   * 이용권으로 좌석에 입실한다
   * @param ticketId 이용권 ID
   * @param seatId 좌석 ID
   * @returns supertest 요청
   */
  function enterSeat(ticketId: string, seatId: string) {
    return request(server)
      .post('/usage-sessions')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ticketId, shopId: shop.id, seatId, userId: normalUser.id });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // main.ts와 동일하게 설정
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

    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    // 테스트 사용자 생성 (OWNER + USER)
    ownerUser = await prisma.user.create({
      data: {
        email: `e2e-seat-owner-${Date.now()}@test.com`,
        role: UserRole.OWNER,
        password: 'hashed',
      },
    });
    normalUser = await prisma.user.create({
      data: {
        email: `e2e-seat-user-${Date.now()}@test.com`,
        role: UserRole.USER,
        password: 'hashed',
      },
    });
    ownerToken = signAccessToken(ownerUser, 'OWNER');
    userToken = signAccessToken(normalUser, 'USER');

    // 같은 좌석을 두고 경쟁하는 두 번째 이용자
    otherUser = await prisma.user.create({
      data: {
        email: `e2e-seat-other-${Date.now()}@test.com`,
        role: UserRole.USER,
        password: 'hashed',
      },
    });
    otherUserToken = signAccessToken(otherUser, 'USER');

    // 매장 생성 + 점주 연결 + 이용 중 세션 준비용 기간권 상품
    shop = await prisma.shop.create({
      data: { name: `E2E좌석타입매장-${Date.now()}` },
    });
    await prisma.shopOwner.create({
      data: { shopId: shop.id, userId: ownerUser.id },
    });
    periodProduct = await prisma.product.create({
      data: {
        name: `E2E기간권상품-${Date.now()}`,
        ticketType: TicketType.PERIOD,
        amount: 10000,
        shopId: shop.id,
        usableDays: 30,
        purchasedDurationDays: 30,
      },
    });
  });

  afterAll(async () => {
    // 역순 정리 (FK 제약 충돌 방지)
    const userIds = [ownerUser.id, normalUser.id, otherUser.id];
    await prisma.refundLock.deleteMany({
      where: { orderItem: { order: { userId: { in: userIds } } } },
    });
    await prisma.paymentCancel.deleteMany({
      where: { payment: { order: { userId: { in: userIds } } } },
    });
    await prisma.ticketSeatChange.deleteMany({
      where: { ticket: { userId: { in: userIds } } },
    });
    await prisma.seatAssignment.deleteMany({
      where: { seat: { shopId: shop.id } },
    });
    await prisma.ticketPause.deleteMany({
      where: { ticket: { userId: { in: userIds } } },
    });
    await prisma.usageSession.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.ticket.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.payment.deleteMany({
      where: { order: { userId: { in: userIds } } },
    });
    await prisma.orderItem.deleteMany({
      where: { order: { userId: { in: userIds } } },
    });
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.productHistory.deleteMany({
      where: { product: { shopId: shop.id } },
    });
    await prisma.product.deleteMany({ where: { shopId: shop.id } });
    await prisma.seat.deleteMany({ where: { shopId: shop.id } });
    await prisma.shopOwner.deleteMany({ where: { shopId: shop.id } });
    await prisma.shop.delete({ where: { id: shop.id } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });

    await prisma.$disconnect();
    await app.close();
  });

  // ── 사용자 스토리 1: 점주가 좌석에 타입을 지정한다 ──────────

  describe('좌석 등록·조회', () => {
    it('좌석 타입 없이 등록하면 400 (QS-1)', async () => {
      await request(server)
        .post(`/shops/${shop.id}/seats`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: '타입없음' })
        .expect(400);
    });

    it('고정석으로 등록하면 목록에 고정석·선택 가능으로 조회된다 (QS-2)', async () => {
      await request(server)
        .post(`/shops/${shop.id}/seats`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: '고정A', number: 1, type: SeatType.FIXED })
        .expect(201);

      const { body } = await request(server)
        .get(`/shops/${shop.id}/seats`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const seat = body.data.find(
        (item: { number: number }) => item.number === 1,
      );
      expect(seat).toMatchObject({ type: SeatType.FIXED, isAssignable: true });
    });
  });

  describe('좌석 수정 가드', () => {
    it('점유 중인 배정이 있는 고정석을 자유석으로 수정하면 409 (QS-23)', async () => {
      const seatId = await createSeat(SeatType.FIXED);
      await holdSeat(seatId);

      const { body } = await patchSeat(seatId, { type: SeatType.FREE }).expect(
        409,
      );
      expect(body.error.code).toBe('SeatHasAssignmentError');
    });

    it('이용 중인 좌석의 타입 변경은 409, 점주가 퇴실 처리한 뒤에는 성공한다 (QS-26)', async () => {
      const seatId = await createSeat(SeatType.FREE);
      const sessionId = await occupySeat(seatId);

      const { body: rejected } = await patchSeat(seatId, {
        type: SeatType.FIXED,
      }).expect(409);
      expect(rejected.error.code).toBe('SeatAlreadyOccupiedError');

      await request(server)
        .patch(`/usage-sessions/${sessionId}/end`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      await patchSeat(seatId, { type: SeatType.FIXED }).expect(200);
      const seat = await prisma.seat.findUniqueOrThrow({
        where: { id: seatId },
      });
      expect(seat.type).toBe(SeatType.FIXED);
    });

    it('점유 중인 배정이 있는 고정석을 이용 불가로 수정하면 409 (QS-27)', async () => {
      const seatId = await createSeat(SeatType.FIXED);
      await holdSeat(seatId);

      const { body } = await patchSeat(seatId, {
        status: SeatStatus.UNAVAILABLE,
      }).expect(409);
      expect(body.error.code).toBe('SeatHasAssignmentError');
    });

    it('이용 중인 자유석을 이용 불가로 수정하면 409, 점주가 퇴실 처리한 뒤에는 성공한다 (QS-27a)', async () => {
      const seatId = await createSeat(SeatType.FREE);
      const sessionId = await occupySeat(seatId);

      const { body: rejected } = await patchSeat(seatId, {
        status: SeatStatus.UNAVAILABLE,
      }).expect(409);
      expect(rejected.error.code).toBe('SeatAlreadyOccupiedError');

      await request(server)
        .patch(`/usage-sessions/${sessionId}/end`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      await patchSeat(seatId, { status: SeatStatus.UNAVAILABLE }).expect(200);
      const seat = await prisma.seat.findUniqueOrThrow({
        where: { id: seatId },
      });
      expect(seat.status).toBe(SeatStatus.UNAVAILABLE);
    });
  });

  // ── 사용자 스토리 2: 이용자가 최초 구매 시 좌석 타입을 선택한다 ──

  describe('사용자 스토리 2', () => {
    it('고정석 시간권 상품을 등록하면 목록에 고정석으로 조회된다 (QS-3)', async () => {
      const productId = await createProduct(SeatType.FIXED, TicketType.TIME);

      const { body } = await request(server)
        .get(`/shops/${shop.id}/products`)
        .query({ page: 1, limit: 100, sortBy: 'createdAt', sortOrder: 'desc' })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const items = body.data.items as { id: string; seatType?: SeatType }[];
      const product = items.find((item) => item.id === productId);
      expect(product?.seatType).toBe(SeatType.FIXED);
    });

    it('고정석 기간권 상품을 등록하면 목록에 고정석으로 조회된다 (QS-3a)', async () => {
      const productId = await createProduct(SeatType.FIXED, TicketType.PERIOD);

      const { body } = await request(server)
        .get(`/shops/${shop.id}/products`)
        .query({ page: 1, limit: 100, sortBy: 'createdAt', sortOrder: 'desc' })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const items = body.data.items as { id: string; seatType?: SeatType }[];
      const product = items.find((item) => item.id === productId);
      expect(product?.seatType).toBe(SeatType.FIXED);
    });

    it('상품의 좌석 타입과 금액을 수정하면 반영되고 바뀐 필드마다 이력이 남는다 (QS-28)', async () => {
      const productId = await createProduct(SeatType.FREE, TicketType.TIME);

      await request(server)
        .patch(`/shops/${shop.id}/products/${productId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ seatType: SeatType.FIXED, amount: 12000 })
        .expect(200);

      const { body } = await request(server)
        .get(`/shops/${shop.id}/products`)
        .query({ page: 1, limit: 100, sortBy: 'createdAt', sortOrder: 'desc' })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const items = body.data.items as {
        id: string;
        seatType: SeatType;
        amount: number;
      }[];
      expect(items.find((item) => item.id === productId)).toMatchObject({
        seatType: SeatType.FIXED,
        amount: 12000,
      });

      const histories = await prisma.productHistory.findMany({
        where: { productId },
      });
      expect(histories).toHaveLength(2);
      expect(new Set(histories.map((h) => h.changeGroupId)).size).toBe(1);
      expect(histories.map((h) => h.changedField).sort()).toEqual([
        'amount',
        'seatType',
      ]);
    });

    it('상품 수정에서 이용권 종류를 보내면 400 (QS-29)', async () => {
      const productId = await createProduct(SeatType.FREE, TicketType.TIME);

      await request(server)
        .patch(`/shops/${shop.id}/products/${productId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ type: TicketType.PERIOD })
        .expect(400);
    });

    it('고정석 상품을 좌석 없이 주문하면 400 (QS-4)', async () => {
      const productId = await createProduct(SeatType.FIXED, TicketType.TIME);

      const { body } = await createOrder([{ productId, quantity: 1 }]).expect(
        400,
      );
      expect(body.error.code).toBe('SeatSelectionRequiredError');
    });

    it('고정석 상품을 자유석 좌석으로 주문하면 400 (QS-5)', async () => {
      const productId = await createProduct(SeatType.FIXED, TicketType.TIME);
      const freeSeatId = await createSeat(SeatType.FREE);

      const { body } = await createOrder([
        { productId, quantity: 1, seatId: freeSeatId },
      ]).expect(400);
      expect(body.error.code).toBe('SeatTypeMismatchError');
    });

    it('이미 지정된 좌석으로 다른 이용자가 주문하면 409 (QS-7)', async () => {
      const productId = await createProduct(SeatType.FIXED, TicketType.TIME);
      const seatId = await createSeat(SeatType.FIXED);
      await holdSeat(seatId);

      const { body } = await createOrder([
        { productId, quantity: 1, seatId },
      ]).expect(409);
      expect(body.error.code).toBe('SeatNotAssignableError');
    });

    it('같은 좌석으로 두 주문을 동시에 만들면 한 건만 성공한다 (QS-8)', async () => {
      const productId = await createProduct(SeatType.FIXED, TicketType.TIME);
      const seatId = await createSeat(SeatType.FIXED);

      const responses = await Promise.all([
        createOrder([{ productId, quantity: 1, seatId }]),
        createOrder([{ productId, quantity: 1, seatId }]),
      ]);

      expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
      const rejected = responses.find((res) => res.status === 409);
      expect(rejected?.body.error.code).toBe('SeatNotAssignableError');
    });

    it('고정석 주문을 취소하면 그 좌석이 즉시 선택 가능해진다 (QS-24)', async () => {
      const productId = await createProduct(SeatType.FIXED, TicketType.TIME);
      const seatId = await createSeat(SeatType.FIXED);
      const { body } = await createOrder([
        { productId, quantity: 1, seatId },
      ]).expect(201);
      expect(await isSeatAssignable(seatId)).toBe(false);

      await request(server)
        .patch(`/orders/${body.data.id}/cancel`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(await isSeatAssignable(seatId)).toBe(true);
    });

    it('고정석 주문 후 방치되면 좌석이 선택 가능해지고 같은 좌석으로 새 주문이 성공한다 (QS-25)', async () => {
      const productId = await createProduct(SeatType.FIXED, TicketType.TIME);
      const seatId = await createSeat(SeatType.FIXED);
      await createOrder([{ productId, quantity: 1, seatId }]).expect(201);

      // 결제 없이 선점 유효시간이 지난 상황
      await prisma.seatAssignment.updateMany({
        where: { seatId, status: SeatAssignmentStatus.HELD },
        data: { heldUntil: new Date(Date.now() - 60 * 1000) },
      });

      expect(await isSeatAssignable(seatId)).toBe(true);
      await createOrder([{ productId, quantity: 1, seatId }]).expect(201);
    });

    it('고정석 상품 주문 후 결제가 성공하면 이용권에 고정석과 선택 좌석이 조회된다 (QS-6)', async () => {
      const productId = await createProduct(SeatType.FIXED, TicketType.TIME);
      const seatId = await createSeat(SeatType.FIXED);
      const { body: order } = await createOrder([
        { productId, quantity: 1, seatId },
      ]).expect(201);

      await payOrder(order.data.id);

      const ticketId = await findTicketIdByOrder(order.data.id);
      const { body } = await request(server)
        .get(`/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      expect(body.data.seatType).toBe(SeatType.FIXED);
      expect(body.data.assignedSeat?.id).toBe(seatId);
    });

    it('자유석 상품을 좌석 없이 주문·결제하면 이용권이 자유석이고 배정 좌석이 없다 (QS-10)', async () => {
      // 활성화 전 기간권은 기존 이용권 조회가 expiresAt 필수 예외를 던지므로 시간권으로 확인한다
      const productId = await createProduct(SeatType.FREE, TicketType.TIME);
      const { body: order } = await createOrder([
        { productId, quantity: 1 },
      ]).expect(201);

      await payOrder(order.data.id);

      const ticketId = await findTicketIdByOrder(order.data.id);
      const { body } = await request(server)
        .get(`/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      expect(body.data.seatType).toBe(SeatType.FREE);
      expect(body.data.assignedSeat).toBeNull();
    });

    it('승인 전에 좌석을 다른 이용자가 확정하면 이용권 발급 후 자동 환불되고 환불 콜백 후 이용권이 소멸된다 (QS-31)', async () => {
      const productId = await createProduct(SeatType.FIXED, TicketType.TIME);
      const seatId = await createSeat(SeatType.FIXED);
      const other: Buyer = { userId: otherUser.id, token: otherUserToken };

      // 첫 이용자: 주문·결제 요청 후 승인 콜백 전에 선점이 만료됨
      const { body: firstOrder } = await createOrder([
        { productId, quantity: 1, seatId },
      ]).expect(201);
      const firstPaymentId = await requestPayment(firstOrder.data.id);
      await prisma.seatAssignment.updateMany({
        where: { seatId, status: SeatAssignmentStatus.HELD },
        data: { heldUntil: new Date(Date.now() - 60 * 1000) },
      });

      // 다른 이용자가 같은 좌석을 주문·결제해 배정을 확정함
      const { body: otherOrder } = await createOrder(
        [{ productId, quantity: 1, seatId }],
        other,
      ).expect(201);
      await payOrder(otherOrder.data.id, true, other);

      // 첫 결제의 승인 콜백 - 이용권은 발급되지만 좌석을 줄 수 없어 자동 환불 요청
      await sendPaymentCallback(firstPaymentId, true);
      const firstTicketId = await findTicketIdByOrder(firstOrder.data.id);
      const firstTicket = await prisma.ticket.findUniqueOrThrow({
        where: { id: firstTicketId },
        include: { orderItem: true },
      });
      const cancel = await prisma.paymentCancel.findFirst({
        where: { orderItemId: firstTicket.orderItemId },
      });
      expect(cancel).not.toBeNull();
      expect(cancel!.reason).toContain('자동 결제 취소');

      // PG 환불 성공 콜백 후 이용권 소멸
      await request(server)
        .post('/refund/callback')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          success: true,
          pgTransactionId: `refund-${cancel!.id}`,
          orderItemId: firstTicket.orderItemId,
          paymentCancelId: cancel!.id,
          amount: cancel!.amount,
        })
        .expect(201);
      const revoked = await prisma.ticket.findUniqueOrThrow({
        where: { id: firstTicketId },
      });
      expect(revoked.status).toBe(TicketStatus.REVOKED);
    });

    it('결제 실패 후 같은 좌석으로 새 주문이 성공한다 (QS-9)', async () => {
      const productId = await createProduct(SeatType.FIXED, TicketType.TIME);
      const seatId = await createSeat(SeatType.FIXED);
      const { body: order } = await createOrder([
        { productId, quantity: 1, seatId },
      ]).expect(201);

      await payOrder(order.data.id, false);

      await createOrder([{ productId, quantity: 1, seatId }]).expect(201);
    });

    it('선점이 만료된 주문으로 결제를 요청하면 409이고 선점은 HOLD_EXPIRED로 해제된다 (QS-30)', async () => {
      const productId = await createProduct(SeatType.FIXED, TicketType.TIME);
      const seatId = await createSeat(SeatType.FIXED);
      const { body: order } = await createOrder([
        { productId, quantity: 1, seatId },
      ]).expect(201);
      await prisma.seatAssignment.updateMany({
        where: { seatId, status: SeatAssignmentStatus.HELD },
        data: { heldUntil: new Date(Date.now() - 60 * 1000) },
      });

      const { body } = await request(server)
        .post('/payments')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ orderId: order.data.id, userId: normalUser.id })
        .expect(409);
      expect(body.error.code).toBe('SeatHoldExpiredError');

      const assignment = await prisma.seatAssignment.findFirstOrThrow({
        where: { seatId },
      });
      expect(assignment).toMatchObject({
        status: SeatAssignmentStatus.RELEASED,
        releaseReason: 'HOLD_EXPIRED',
      });
    });
  });

  // ── 사용자 스토리 3: 이용권의 좌석 타입에 맞는 좌석을 이용한다 ──

  describe('사용자 스토리 3', () => {
    it('자유석 이용권은 자유석에 입실하고 고정석 입실은 400 (QS-12)', async () => {
      const ticketId = await issueTicket(SeatType.FREE, TicketType.TIME);
      const fixedSeatId = await createSeat(SeatType.FIXED);
      const freeSeatId = await createSeat(SeatType.FREE);

      const { body } = await enterSeat(ticketId, fixedSeatId).expect(400);
      expect(body.error.code).toBe('SeatTypeMismatchError');

      await enterSeat(ticketId, freeSeatId).expect(201);
    });

    it('고정석 이용권으로 자유석에 입실하면 400 (QS-11a)', async () => {
      const assignedSeatId = await createSeat(SeatType.FIXED);
      const ticketId = await issueTicket(
        SeatType.FIXED,
        TicketType.TIME,
        assignedSeatId,
      );
      const freeSeatId = await createSeat(SeatType.FREE);

      const { body } = await enterSeat(ticketId, freeSeatId).expect(400);
      expect(body.error.code).toBe('SeatTypeMismatchError');
    });

    it('고정석 이용권은 배정 좌석에 입실하고 다른 고정석 입실은 400 (QS-11)', async () => {
      const assignedSeatId = await createSeat(SeatType.FIXED);
      const ticketId = await issueTicket(
        SeatType.FIXED,
        TicketType.TIME,
        assignedSeatId,
      );
      const otherFixedSeatId = await createSeat(SeatType.FIXED);

      const { body } = await enterSeat(ticketId, otherFixedSeatId).expect(400);
      expect(body.error.code).toBe('NotAssignedSeatError');

      await enterSeat(ticketId, assignedSeatId).expect(201);
    });

    it('배정 좌석이 없는 고정석 이용권으로 입실하면 400 (QS-11b)', async () => {
      // 자동 취소 대기 중 상황: 고정석 이용권만 있고 배정은 없다
      const order = await prisma.order.create({
        data: {
          shopId: shop.id,
          userId: normalUser.id,
          originalAmount: 10000,
          discountAmount: 0,
          totalAmount: 10000,
        },
      });
      const orderItem = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: periodProduct.id,
          ticketType: TicketType.TIME,
          seatType: SeatType.FIXED,
          originalAmount: 10000,
          discountAmount: 0,
          amount: 10000,
          purchasedMinutes: 600,
          usableDays: 30,
        },
      });
      const ticket = await prisma.ticket.create({
        data: {
          userId: normalUser.id,
          type: TicketType.TIME,
          status: TicketStatus.UNUSED,
          seatType: SeatType.FIXED,
          orderItemId: orderItem.id,
          purchasedMinutes: 600,
          remainingMinutes: 600,
          minuteExpireDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      const fixedSeatId = await createSeat(SeatType.FIXED);

      const { body } = await enterSeat(ticket.id, fixedSeatId).expect(400);
      expect(body.error.code).toBe('TicketSeatUnassignedError');
    });

    it('고정석 시간권을 이용 중 잔여시간이 소진되면 배정이 해제된다 (QS-20)', async () => {
      const seatId = await createSeat(SeatType.FIXED);
      const ticketId = await issueTicket(
        SeatType.FIXED,
        TicketType.TIME,
        seatId,
      );
      await enterSeat(ticketId, seatId).expect(201);

      // 잔여시간 1분, 이용 시작 2분 전 → 종료 시 소진
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { remainingMinutes: 1 },
      });
      const session = await prisma.usageSession.findFirstOrThrow({
        where: { ticketId, status: UsageSessionStatus.ACTIVE },
      });
      await prisma.usageSession.update({
        where: { id: session.id },
        data: { startedAt: new Date(Date.now() - 2 * 60 * 1000) },
      });

      await request(server)
        .patch(`/usage-sessions/${session.id}/end`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      // 조회 시점 판정(isAssignable)과 별개로 배정 행이 즉시 해제됐는지 확인한다
      const assignment = await prisma.seatAssignment.findFirstOrThrow({
        where: { ticketId },
      });
      expect(assignment).toMatchObject({
        status: SeatAssignmentStatus.RELEASED,
        releaseReason: 'TICKET_EXHAUSTED',
      });
      expect(await isSeatAssignable(seatId)).toBe(true);
    });

    it('고정석 이용권의 환불이 확정되면 배정이 해제된다 (QS-21)', async () => {
      const seatId = await createSeat(SeatType.FIXED);
      const ticketId = await issueTicket(
        SeatType.FIXED,
        TicketType.TIME,
        seatId,
      );

      await request(server)
        .post('/refund')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ ticketId })
        .expect(201);
      const ticket = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticketId },
      });
      const cancel = await prisma.paymentCancel.findFirstOrThrow({
        where: { orderItemId: ticket.orderItemId },
      });
      await request(server)
        .post('/refund/callback')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          success: true,
          pgTransactionId: `refund-${cancel.id}`,
          orderItemId: ticket.orderItemId,
          paymentCancelId: cancel.id,
          amount: cancel.amount,
        })
        .expect(201);

      // 조회 시점 판정(isAssignable)과 별개로 배정 행이 즉시 해제됐는지 확인한다
      const assignment = await prisma.seatAssignment.findFirstOrThrow({
        where: { ticketId },
      });
      expect(assignment).toMatchObject({
        status: SeatAssignmentStatus.RELEASED,
        releaseReason: 'TICKET_REVOKED',
      });
      expect(await isSeatAssignable(seatId)).toBe(true);
    });

    it('기간이 만료된 고정석 이용권의 좌석으로 새 주문이 성공하고 기존 배정은 TICKET_EXPIRED로 해제된다 (QS-22)', async () => {
      const seatId = await createSeat(SeatType.FIXED);
      const ticketId = await issueTicket(
        SeatType.FIXED,
        TicketType.PERIOD,
        seatId,
      );
      // 활성화된 기간권의 만료일이 지난 상황
      await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.ACTIVE,
          activatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(Date.now() - 60 * 1000),
        },
      });

      const productId = await createProduct(SeatType.FIXED, TicketType.TIME);
      await createOrder([{ productId, quantity: 1, seatId }]).expect(201);

      const oldAssignment = await prisma.seatAssignment.findFirstOrThrow({
        where: { ticketId },
      });
      expect(oldAssignment).toMatchObject({
        status: SeatAssignmentStatus.RELEASED,
        releaseReason: 'TICKET_EXPIRED',
      });
    });
  });
});
