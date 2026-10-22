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
describe('좌석 타입 (E2E)', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;
  let jwtService: JwtService;

  // 테스트 엔티티 (정리용으로 ID 추적)
  let ownerUser: { id: string; email: string };
  let normalUser: { id: string; email: string };
  let shop: { id: string };
  let periodProduct: { id: string };

  let ownerToken: string;

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
   * 좌석에 유효한 선점(HELD) 지정을 만든다
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
    const userIds = [ownerUser.id, normalUser.id];
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
    it('유효 지정이 있는 고정석을 자유석으로 수정하면 409 (QS-23)', async () => {
      const seatId = await createSeat(SeatType.FIXED);
      await holdSeat(seatId);

      await patchSeat(seatId, { type: SeatType.FREE }).expect(409);
    });

    it('이용 중인 좌석의 타입 변경은 409, 점주가 퇴실 처리한 뒤에는 성공한다 (QS-26)', async () => {
      const seatId = await createSeat(SeatType.FREE);
      const sessionId = await occupySeat(seatId);

      await patchSeat(seatId, { type: SeatType.FIXED }).expect(409);

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

    it('유효 지정이 있는 고정석을 이용 불가로 수정하면 409 (QS-27)', async () => {
      const seatId = await createSeat(SeatType.FIXED);
      await holdSeat(seatId);

      await patchSeat(seatId, { status: SeatStatus.UNAVAILABLE }).expect(409);
    });

    it('이용 중인 자유석을 이용 불가로 수정하면 409, 점주가 퇴실 처리한 뒤에는 성공한다 (QS-27a)', async () => {
      const seatId = await createSeat(SeatType.FREE);
      const sessionId = await occupySeat(seatId);

      await patchSeat(seatId, { status: SeatStatus.UNAVAILABLE }).expect(409);

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
});
