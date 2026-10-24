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
  TicketStatus,
  TicketType,
  SeatAssignmentStatus,
  SeatStatus,
  SeatType,
  UsageSessionStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';

describe('TicketPauseController (E2E)', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;
  let jwtService: JwtService;

  // 테스트 엔티티 ID 추적 (정리용)
  let ownerUser: { id: string; email: string };
  let normalUser: { id: string; email: string };
  let shop: { id: string };
  let seat: { id: string };
  let product: { id: string };

  let ownerToken: string;
  let userToken: string;

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
        email: `e2e-owner-${Date.now()}@test.com`,
        role: UserRole.OWNER,
        password: 'hashed',
      },
    });
    normalUser = await prisma.user.create({
      data: {
        email: `e2e-user-${Date.now()}@test.com`,
        role: UserRole.USER,
        password: 'hashed',
      },
    });

    ownerToken = jwtService.sign({
      sub: ownerUser.id,
      email: ownerUser.email,
      role: 'OWNER',
      type: 'access',
      jti: randomUUID(),
    });
    userToken = jwtService.sign({
      sub: normalUser.id,
      email: normalUser.email,
      role: 'USER',
      type: 'access',
      jti: randomUUID(),
    });

    // 매장 + 좌석 + 상품 생성
    shop = await prisma.shop.create({
      data: { name: `E2E정지테스트매장-${Date.now()}` },
    });
    await prisma.shopOwner.create({
      data: { shopId: shop.id, userId: ownerUser.id },
    });
    seat = await prisma.seat.create({
      data: { number: 1, shopId: shop.id, status: SeatStatus.AVAILABLE },
    });
    product = await prisma.product.create({
      data: {
        name: `E2E시간권상품-${Date.now()}`,
        ticketType: TicketType.TIME,
        amount: 10000,
        shopId: shop.id,
        usableDays: 30,
        purchasedMinutes: 120,
      },
    });
  });

  afterAll(async () => {
    // 역순 정리 (FK 제약 충돌 방지)
    // 실제 결제 흐름 테스트는 일반 사용자 이용권·결제·좌석 배정·상품 이력도 만든다
    await prisma.seatAssignment.deleteMany({
      where: { seat: { shopId: shop.id } },
    });
    await prisma.ticketPause.deleteMany({
      where: { ticket: { userId: { in: [ownerUser.id, normalUser.id] } } },
    });
    await prisma.usageSession.deleteMany({
      where: { userId: { in: [ownerUser.id, normalUser.id] } },
    });
    await prisma.ticket.deleteMany({
      where: { userId: { in: [ownerUser.id, normalUser.id] } },
    });
    await prisma.payment.deleteMany({
      where: { order: { userId: { in: [ownerUser.id, normalUser.id] } } },
    });
    await prisma.orderItem.deleteMany({
      where: { order: { userId: { in: [ownerUser.id, normalUser.id] } } },
    });
    await prisma.order.deleteMany({
      where: { userId: { in: [ownerUser.id, normalUser.id] } },
    });
    await prisma.productHistory.deleteMany({
      where: { product: { shopId: shop.id } },
    });
    await prisma.product.deleteMany({ where: { shopId: shop.id } });
    await prisma.seat.deleteMany({ where: { shopId: shop.id } });
    await prisma.shopOwner.deleteMany({ where: { shopId: shop.id } });
    await prisma.shop.delete({ where: { id: shop.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerUser.id, normalUser.id] } },
    });

    await prisma.$disconnect();
    await app.close();
  });

  // ── 헬퍼 함수 ──────────────────────────────────

  /**
   * ACTIVE 시간권 + 관련 Order/OrderItem 생성
   */
  async function createActiveTimeTicket(
    remainingMinutes = 120,
  ): Promise<string> {
    const order = await prisma.order.create({
      data: {
        shopId: shop.id,
        userId: ownerUser.id,
        originalAmount: 10000,
        discountAmount: 0,
        totalAmount: 10000,
      },
    });
    const orderItem = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        ticketType: TicketType.TIME,
        originalAmount: 10000,
        discountAmount: 0,
        amount: 10000,
        purchasedMinutes: 120,
        usableDays: 30,
      },
    });
    const ticket = await prisma.ticket.create({
      data: {
        userId: ownerUser.id,
        type: TicketType.TIME,
        status: TicketStatus.ACTIVE,
        orderItemId: orderItem.id,
        purchasedMinutes: 120,
        remainingMinutes,
        minuteExpireDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    return ticket.id;
  }

  /**
   * 티켓에 활성 세션 생성
   */
  async function createActiveSession(ticketId: string): Promise<string> {
    const session = await prisma.usageSession.create({
      data: {
        ticketId,
        shopId: shop.id,
        seatId: seat.id,
        userId: ownerUser.id,
        startedAt: new Date(Date.now() - 30 * 60 * 1000), // 30분 전 시작
        plannedEndAt: new Date(Date.now() + 90 * 60 * 1000),
        status: UsageSessionStatus.ACTIVE,
      },
    });
    return session.id;
  }

  // ── PATCH /tickets/:ticketId/pause ─────────────

  describe('PATCH /tickets/:ticketId/pause', () => {
    it('ACTIVE 시간권을 정지할 수 있다 (세션 없음)', async () => {
      const ticketId = await createActiveTimeTicket();

      const { body } = await request(server)
        .patch(`/tickets/${ticketId}/pause`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ reason: '환불 심사' })
        .expect(200);

      // 응답 형식 검증 (TransformInterceptor)
      expect(body.success).toBe(true);
      expect(body.statusCode).toBe(200);

      // DB 검증: TicketPause 생성됨
      const pause = await prisma.ticketPause.findFirst({
        where: { ticketId, resumedAt: null },
      });
      expect(pause).not.toBeNull();
      expect(pause!.pausedBy).toBe(ownerUser.id);
      expect(pause!.pausedReason).toBe('환불 심사');
    });

    it('활성 세션이 있으면 정지 시 세션을 종료한다', async () => {
      const ticketId = await createActiveTimeTicket(120);
      const sessionId = await createActiveSession(ticketId);

      await request(server)
        .patch(`/tickets/${ticketId}/pause`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(200);

      // DB 검증: 세션이 ENDED로 전이
      const session = await prisma.usageSession.findUnique({
        where: { id: sessionId },
      });
      expect(session!.status).toBe(UsageSessionStatus.ENDED);
      expect(session!.endedAt).not.toBeNull();

      // DB 검증: 시간권 remainingMinutes 차감
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
      });
      expect(ticket!.remainingMinutes).toBeLessThan(120);

      // DB 검증: TicketPause 생성됨
      const pause = await prisma.ticketPause.findFirst({
        where: { ticketId, resumedAt: null },
      });
      expect(pause).not.toBeNull();
    });

    it('이미 정지 중인 티켓에 재정지하면 409 반환', async () => {
      const ticketId = await createActiveTimeTicket();

      // 첫 번째 정지
      await request(server)
        .patch(`/tickets/${ticketId}/pause`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(200);

      // 두 번째 정지 시도
      const { body } = await request(server)
        .patch(`/tickets/${ticketId}/pause`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(409);

      expect(body.success).toBe(false);
      expect(body.statusCode).toBe(409);
    });

    it('ACTIVE가 아닌 티켓을 정지하면 400 반환', async () => {
      // UNUSED 상태의 티켓 생성
      const order = await prisma.order.create({
        data: {
          shopId: shop.id,
          userId: ownerUser.id,
          originalAmount: 10000,
          discountAmount: 0,
          totalAmount: 10000,
        },
      });
      const orderItem = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: product.id,
          ticketType: TicketType.TIME,
          originalAmount: 10000,
          discountAmount: 0,
          amount: 10000,
          purchasedMinutes: 120,
          usableDays: 30,
        },
      });
      const ticket = await prisma.ticket.create({
        data: {
          userId: ownerUser.id,
          type: TicketType.TIME,
          status: TicketStatus.UNUSED,
          orderItemId: orderItem.id,
          purchasedMinutes: 120,
          remainingMinutes: 120,
        },
      });

      const { body } = await request(server)
        .patch(`/tickets/${ticket.id}/pause`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(400);

      expect(body.success).toBe(false);
      expect(body.statusCode).toBe(400);
    });

    it('인증 없이 요청하면 401 반환', async () => {
      const ticketId = await createActiveTimeTicket();

      await request(server)
        .patch(`/tickets/${ticketId}/pause`)
        .send({})
        .expect(401);
    });

    it('USER 역할로 요청하면 401 반환 (권한 부족)', async () => {
      const ticketId = await createActiveTimeTicket();

      await request(server)
        .patch(`/tickets/${ticketId}/pause`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({})
        .expect(401);
    });

    it('존재하지 않는 티켓 ID로 요청하면 404 반환', async () => {
      const fakeId = randomUUID();

      await request(server)
        .patch(`/tickets/${fakeId}/pause`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(404);
    });

    it('유효하지 않은 UUID 형식이면 400 반환', async () => {
      await request(server)
        .patch('/tickets/not-a-uuid/pause')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(400);
    });

    it('reason 없이도 정지할 수 있다', async () => {
      const ticketId = await createActiveTimeTicket();

      await request(server)
        .patch(`/tickets/${ticketId}/pause`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(200);

      const pause = await prisma.ticketPause.findFirst({
        where: { ticketId, resumedAt: null },
      });
      expect(pause).not.toBeNull();
      expect(pause!.pausedReason).toBeNull();
    });

    it('시간이 소진된 세션 종료 시 티켓이 EXHAUSTED로 전이한다', async () => {
      // remainingMinutes를 1로 설정하여 소진 유도
      const ticketId = await createActiveTimeTicket(1);

      // 30분 전에 시작된 세션 → 소비 시간 30분 > 잔여 1분
      await createActiveSession(ticketId);

      await request(server)
        .patch(`/tickets/${ticketId}/pause`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(200);

      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
      });
      expect(ticket!.status).toBe(TicketStatus.EXHAUSTED);
      expect(ticket!.remainingMinutes).toBe(0);
    });
  });

  // ── 결제·입실을 API로 거친 시간권 (bug: time-pass-pause-rejected) ──
  // 위 테스트들은 시간권을 DB에 ACTIVE로 직접 만든다.
  // 여기서는 결제 → 입실 → 정지·재개를 모두 API로 실행해 실제 흐름의 이용권 상태를 검증한다.

  describe('결제·입실한 시간권 정지·재개 (bug: time-pass-pause-rejected)', () => {
    // 입실 API는 대기 후 무작위로 실패하는 외부 API 스텁을 재시도와 함께 거치므로 기본 제한 시간(5초)보다 넉넉히 잡는다
    const flowTimeoutMs = 10000;

    // 매장 내 좌석 번호는 유일하므로 기존 좌석(1번)과 겹치지 않게 100번부터 쓴다
    let nextSeatNumber = 100;

    /**
     * 테스트 좌석을 DB에 직접 만든다
     * @param type 좌석 타입
     * @returns 좌석 ID
     */
    async function createSeat(type: SeatType): Promise<string> {
      const created = await prisma.seat.create({
        data: {
          number: nextSeatNumber++,
          shopId: shop.id,
          type,
          status: SeatStatus.AVAILABLE,
        },
      });
      return created.id;
    }

    /**
     * 점주 권한으로 시간권 상품을 API로 등록한다
     * @param seatType 상품의 좌석 타입
     * @returns 상품 ID
     */
    async function createTimeProduct(seatType: SeatType): Promise<string> {
      const { body } = await request(server)
        .post(`/shops/${shop.id}/products`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          type: TicketType.TIME,
          name: `E2E시간권-${seatType}-${Date.now()}`,
          amount: 10000,
          usableDays: 30,
          isActive: true,
          seatType,
          purchasedMinutes: 600,
        })
        .expect(201);
      return body.data as string;
    }

    /**
     * 일반 사용자로 시간권을 주문·결제해 발급받는다(주문 → 결제 요청 → PG 승인 콜백)
     * @param seatType 상품 좌석 타입
     * @param seatId 고정석 상품이면 배정할 좌석 ID
     * @returns 이용권 ID
     */
    async function issueTimeTicket(
      seatType: SeatType,
      seatId?: string,
    ): Promise<string> {
      const productId = await createTimeProduct(seatType);
      const { body: order } = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          shopId: shop.id,
          userId: normalUser.id,
          orderedProducts: [
            { productId, quantity: 1, ...(seatId ? { seatId } : {}) },
          ],
        })
        .expect(201);
      const orderId = order.data.id as string;

      const { body: paymentBody } = await request(server)
        .post('/payments')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ orderId, userId: normalUser.id })
        .expect(201);
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: paymentBody.data.paymentId as string },
      });
      await request(server)
        .post('/payments/callback')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          success: true,
          pgTransactionId: payment.pgTransactionId,
          amount: payment.amount,
          reason: null,
        })
        .expect(201);

      const ticket = await prisma.ticket.findFirstOrThrow({
        where: { orderItem: { orderId } },
      });
      return ticket.id;
    }

    /**
     * 일반 사용자로 입실한다
     * @param ticketId 이용권 ID
     * @param seatId 좌석 ID
     */
    async function enterSeat(ticketId: string, seatId: string): Promise<void> {
      await request(server)
        .post('/usage-sessions')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ ticketId, shopId: shop.id, seatId, userId: normalUser.id })
        .expect(201);
    }

    /**
     * 점주 권한으로 이용권을 정지한다
     * @param ticketId 이용권 ID
     * @param reason 정지 사유
     * @returns supertest 요청
     */
    function pauseTicket(ticketId: string, reason: string) {
      return request(server)
        .patch(`/tickets/${ticketId}/pause`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ reason });
    }

    /**
     * 점주 권한으로 이용권을 재개한다
     * @param ticketId 이용권 ID
     * @param reason 재개 사유
     * @returns supertest 요청
     */
    function resumeTicket(ticketId: string, reason: string) {
      return request(server)
        .patch(`/tickets/${ticketId}/resume`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ reason });
    }

    it(
      '결제 후 입실한 시간권을 일시정지할 수 있다',
      async () => {
        const seatId = await createSeat(SeatType.FREE);
        const ticketId = await issueTimeTicket(SeatType.FREE);
        await enterSeat(ticketId, seatId);

        await pauseTicket(ticketId, '외출').expect(200);

        // 정지 결과 상태: 활성 TicketPause가 1개 생기고 이용권 상태는 ACTIVE로 유지된다
        const pauses = await prisma.ticketPause.findMany({
          where: { ticketId, resumedAt: null },
        });
        expect(pauses).toHaveLength(1);
        expect(pauses[0].pausedBy).toBe(ownerUser.id);
        expect(pauses[0].pausedReason).toBe('외출');
        const ticket = await prisma.ticket.findUniqueOrThrow({
          where: { id: ticketId },
        });
        expect(ticket.status).toBe(TicketStatus.ACTIVE);

        // 정지의 부수 효과: 진행 중 세션은 종료되고 이용한 시간만큼 남은 시간이 줄어든다
        const sessions = await prisma.usageSession.findMany({
          where: { ticketId },
        });
        expect(sessions).toHaveLength(1);
        expect(sessions[0].status).toBe(UsageSessionStatus.ENDED);
        expect(ticket.remainingMinutes).toBeLessThan(600);
      },
      flowTimeoutMs,
    );

    it(
      '결제 후 입실해 정지한 시간권을 재개하면 정지 기간만큼 minuteExpireDeadline이 늘어난다',
      async () => {
        const seatId = await createSeat(SeatType.FREE);
        const ticketId = await issueTimeTicket(SeatType.FREE);
        await enterSeat(ticketId, seatId);
        await pauseTicket(ticketId, '외출').expect(200);
        const pausedTicket = await prisma.ticket.findUniqueOrThrow({
          where: { id: ticketId },
        });

        await request(server)
          .patch(`/tickets/${ticketId}/resume`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ reason: '복귀' })
          .expect(200);

        // 재개 결과 상태: 정지 기록에 재개 시각이 남고, 활성 정지는 없다
        const pause = await prisma.ticketPause.findFirstOrThrow({
          where: { ticketId },
        });
        expect(pause.resumedAt).not.toBeNull();
        expect(pause.resumedBy).toBe(ownerUser.id);
        expect(
          await prisma.ticketPause.count({
            where: { ticketId, resumedAt: null },
          }),
        ).toBe(0);

        // 시간권 기한(minuteExpireDeadline)이 정지 기간(resumedAt - pausedAt)만큼 늘어난다
        const resumedTicket = await prisma.ticket.findUniqueOrThrow({
          where: { id: ticketId },
        });
        expect(resumedTicket.status).toBe(TicketStatus.ACTIVE);
        expect(
          resumedTicket.minuteExpireDeadline!.getTime() -
            pausedTicket.minuteExpireDeadline!.getTime(),
        ).toBe(pause.resumedAt!.getTime() - pause.pausedAt.getTime());
      },
      flowTimeoutMs,
    );

    it(
      '시간권을 정지했다가 재개해도 누가·언제·왜 정지하고 재개했는지가 한 기록에 모두 남는다',
      async () => {
        const seatId = await createSeat(SeatType.FREE);
        const ticketId = await issueTimeTicket(SeatType.FREE);
        await enterSeat(ticketId, seatId);

        const beforePause = new Date();
        await pauseTicket(ticketId, '외출').expect(200);
        const afterPause = new Date();
        await resumeTicket(ticketId, '복귀').expect(200);
        const afterResume = new Date();

        // 검수용 이력: 재개 후에도 정지 정보가 지워지거나 덮어써지지 않고 재개 정보와 함께 남는다
        const pauses = await prisma.ticketPause.findMany({
          where: { ticketId },
        });
        expect(pauses).toHaveLength(1);
        const [history] = pauses;
        expect(history.pausedBy).toBe(ownerUser.id);
        expect(history.pausedReason).toBe('외출');
        expect(history.pausedAt.getTime()).toBeGreaterThanOrEqual(
          beforePause.getTime(),
        );
        expect(history.pausedAt.getTime()).toBeLessThanOrEqual(
          afterPause.getTime(),
        );
        expect(history.resumedBy).toBe(ownerUser.id);
        expect(history.resumedReason).toBe('복귀');
        expect(history.resumedAt!.getTime()).toBeGreaterThanOrEqual(
          afterPause.getTime(),
        );
        expect(history.resumedAt!.getTime()).toBeLessThanOrEqual(
          afterResume.getTime(),
        );
      },
      flowTimeoutMs,
    );

    it(
      '시간권을 정지·재개를 두 번 반복하면 이력이 2건 차례로 쌓인다',
      async () => {
        const seatId = await createSeat(SeatType.FREE);
        const ticketId = await issueTimeTicket(SeatType.FREE);
        await enterSeat(ticketId, seatId);

        await pauseTicket(ticketId, '1차 정지').expect(200);
        await resumeTicket(ticketId, '1차 재개').expect(200);
        await pauseTicket(ticketId, '2차 정지').expect(200);
        await resumeTicket(ticketId, '2차 재개').expect(200);

        // 이력은 정지 시각 순으로 2건이며, 각 건의 정지·재개 사유가 섞이지 않는다
        const pauses = await prisma.ticketPause.findMany({
          where: { ticketId },
          orderBy: { pausedAt: 'asc' },
        });
        expect(
          pauses.map((pause) => [pause.pausedReason, pause.resumedReason]),
        ).toEqual([
          ['1차 정지', '1차 재개'],
          ['2차 정지', '2차 재개'],
        ]);
        expect(pauses.every((pause) => pause.resumedAt !== null)).toBe(true);
        // 1차 재개가 끝난 뒤에 2차 정지가 시작됐다
        expect(pauses[0].resumedAt!.getTime()).toBeLessThanOrEqual(
          pauses[1].pausedAt.getTime(),
        );
      },
      flowTimeoutMs,
    );

    it(
      '결제 후 입실한 고정석 시간권을 정지하면 배정이 해제되고, 재개할 때 고른 좌석에 다시 배정된다 (FR-018)',
      async () => {
        const seatId = await createSeat(SeatType.FIXED);
        const ticketId = await issueTimeTicket(SeatType.FIXED, seatId);
        await enterSeat(ticketId, seatId);

        // 정지: 활성 정지가 생기고 확정 배정이 해제된다
        await pauseTicket(ticketId, '장기 출장').expect(200);
        expect(
          await prisma.ticketPause.count({
            where: { ticketId, resumedAt: null },
          }),
        ).toBe(1);
        expect(
          await prisma.seatAssignment.count({
            where: { ticketId, status: SeatAssignmentStatus.ACTIVE },
          }),
        ).toBe(0);

        // 재개: 고른 좌석으로 확정 배정이 다시 생긴다
        await request(server)
          .patch(`/tickets/${ticketId}/resume`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ seatId })
          .expect(200);
        const assignment = await prisma.seatAssignment.findFirstOrThrow({
          where: { ticketId, status: SeatAssignmentStatus.ACTIVE },
        });
        expect(assignment.seatId).toBe(seatId);
        expect(
          await prisma.ticketPause.count({
            where: { ticketId, resumedAt: null },
          }),
        ).toBe(0);
      },
      flowTimeoutMs,
    );

    it(
      '시간권은 첫 입실 때 ACTIVE가 되고 activatedAt이 퇴실 후 재입실해도 바뀌지 않는다',
      async () => {
        const seatId = await createSeat(SeatType.FREE);
        const ticketId = await issueTimeTicket(SeatType.FREE);
        const beforeEntry = new Date();

        // 첫 입실: UNUSED → ACTIVE, activatedAt에 첫 입실 시각 기록
        await enterSeat(ticketId, seatId);
        const first = await prisma.ticket.findUniqueOrThrow({
          where: { id: ticketId },
        });
        expect(first.status).toBe(TicketStatus.ACTIVE);
        expect(first.activatedAt).not.toBeNull();
        expect(first.activatedAt!.getTime()).toBeGreaterThanOrEqual(
          beforeEntry.getTime(),
        );

        // 퇴실 후 재입실: activatedAt은 첫 입실 시각 그대로다
        const session = await prisma.usageSession.findFirstOrThrow({
          where: { ticketId, status: UsageSessionStatus.ACTIVE },
        });
        await request(server)
          .patch(`/usage-sessions/${session.id}/end`)
          .set('Authorization', `Bearer ${userToken}`)
          .expect(200);
        await enterSeat(ticketId, seatId);
        const second = await prisma.ticket.findUniqueOrThrow({
          where: { id: ticketId },
        });
        expect(second.status).toBe(TicketStatus.ACTIVE);
        expect(second.activatedAt).toEqual(first.activatedAt);
      },
      flowTimeoutMs,
    );
  });
});
