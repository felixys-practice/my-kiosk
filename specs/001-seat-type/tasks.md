---
description: "좌석 타입(고정석·자유석) 추가 기능의 구현 작업 목록"
---

# 작업 목록: 좌석 타입(고정석·자유석) 추가

**입력**: `specs/001-seat-type/`의 설계 문서
**선행 문서**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/rest-api.md](./contracts/rest-api.md), [quickstart.md](./quickstart.md)

**테스트**: TDD로 작성한다(헌법 원칙 III v1.1.0). 각 단계에서 테스트 작업 → **실패 확인 작업** → 구현 작업 순서를 지킨다.
구현 후 테스트를 통과시키기 위해 테스트의 기대값을 바꾸지 않는다. 기대값 변경이 필요하면 사용자 확인을 받는다.

**구성**: 사용자 스토리별 단계로 묶어, 스토리마다 독립적으로 구현·검증할 수 있게 한다.

## 형식: `[ID] [P?] [Story] 설명`

- **[P]**: 동시에 진행 가능(다른 파일, 미완료 작업에 의존하지 않음)
- **[Story]**: 해당 사용자 스토리(US1~US4)
- `QS-n`: [quickstart.md](./quickstart.md) 시나리오 번호
- 단위 테스트는 프로젝트 관례대로 소스 옆 `*.spec.ts`, E2E는 `test/seat-type.e2e-spec.ts`에 둔다.

## 경로 관례

- 소스: `src/`, 스키마: `prisma/schema.prisma`, 마이그레이션: `prisma/migrations/`, E2E: `test/`

---

## Phase 1: 준비 (공통 설정)

**목적**: 기능에 필요한 설정값과 E2E 테스트 골격을 준비한다.

- [x] T001 `src/config/validation.schema.spec.ts`, `src/config/configuration.spec.ts`에 `SEAT_HOLD_MINUTES` 기본값 10과 1 미만 거부 테스트를 **먼저** 작성하고, `npm run test -- --testPathPatterns=config`로 실패를 확인한다
- [x] T002 `src/config/validation.schema.ts`에 `SEAT_HOLD_MINUTES`(Joi `number().integer().min(1).default(10)`)를 추가하고, `src/config/configuration.ts`에 타입 안전한 접근 경로(예: `seat.holdMinutes`)를 추가한다. `.env.example`에 `SEAT_HOLD_MINUTES=10`과 한글 주석(고정석 선점 유효시간, 분)을 추가한다. T001 테스트 통과 확인 (research R2)
- [x] T003 [P] `test/seat-type.e2e-spec.ts` 골격을 만든다. `test/ticket-pause.e2e-spec.ts`의 부트스트랩 방식(AppModule, ValidationPipe, TransformInterceptor, HttpExceptionFilter, JwtService로 OWNER·일반 사용자 토큰 발급, 생성 데이터 추적 후 `afterAll` 정리)을 따른다. 시나리오는 아직 넣지 않는다

---

## Phase 2: 기반 (모든 스토리의 선행 조건)

**목적**: 스키마·마이그레이션·좌석 지정(`SeatAssignment`) 모듈. 이 단계가 끝나기 전에는 어떤 스토리도 시작하지 않는다.

### 기반 테스트 (먼저 작성) ⚠️

- [x] T004 [P] `src/seat-assignment/seat-assignment.policy.spec.ts`에 "유효한 지정 판정" 단위 테스트를 작성한다(판정은 업무 규칙이므로 Repository가 아닌 Service 계층의 순수 함수 `src/seat-assignment/seat-assignment.policy.ts`에 둔다, 헌법 원칙 I)(data-model.md "유효한 지정 판정"). 케이스: `HELD`이고 `heldUntil > now` → 유효 / `HELD`이고 `heldUntil <= now` → 무효 / `ACTIVE`이고 이용권 `UNUSED`·`ACTIVE`이며 기간권 `expiresAt`(활성화 전이면 `activationDeadline`)·시간권 `minuteExpireDeadline`이 `now` 이후 → 유효 / 기한이 지났거나 이용권 상태가 `EXPIRED`·`EXHAUSTED`·`REVOKED` → 무효. 판정 함수는 순수 함수로 분리해 DB 없이 테스트한다
- [x] T005 [P] `src/seat-assignment/seat-assignment.service.spec.ts`에 단위 테스트를 작성한다: `hold`는 대상 좌석의 무효 지정을 `RELEASED`(사유 `HOLD_EXPIRED` 또는 `TICKET_EXPIRED`)로 바꾼 뒤 새 `HELD`를 만든다 / 유효 지정이 있으면 `DomainConflictError` / `findValidBySeat`는 무효 행을 같은 `tx`에서 `RELEASED`로 바꾸고 유효 행만 반환 / `activateByOrderItem`은 `HELD` → `ACTIVE` + `ticketId`·`assignedAt` 설정 / `assign`은 `orderItemId` 없이 `ACTIVE`를 바로 생성 / `releaseByTicket`·`releaseByOrderItems`는 `RELEASED` + `releasedAt`·`releaseReason` 설정 / `getAssignableMap`은 자유석 false, 유효 지정 없는 고정석 true / 이미 RELEASED인 행은 다시 바꾸지 않고 새 행을 만든다(quickstart 경우의 수 표 3 마지막 줄) / 부분 유일 인덱스 위반(Prisma `P2002`)은 `DomainConflictError`로 변환
- [ ] T006 `npm run test -- --testPathPatterns=seat-assignment`를 실행해 T004·T005가 **실패하는 것을 확인**하고 실패 사유(모듈 없음·함수 없음)를 기록한다

### 기반 구현

- [x] T007 `prisma/schema.prisma`에 enum을 추가한다: `SeatType { FIXED FREE }`, `SeatAssignmentStatus { HELD ACTIVE RELEASED }`, `SeatReleaseReason { ORDER_CANCELLED PAYMENT_FAILED HOLD_EXPIRED TICKET_EXPIRED TICKET_EXHAUSTED TICKET_REVOKED TICKET_PAUSED SEAT_TYPE_CHANGED SEAT_MOVED }`, `TicketSeatChangeType { TYPE_CHANGE SEAT_MOVE }`. 각 값에 한글 주석
- [x] T008 `prisma/schema.prisma`의 기존 모델에 필드를 추가한다: `Seat.type SeatType @default(FREE) @map("type")`, `Product.seatType SeatType @default(FREE) @map("seat_type")`, `OrderItem.seatType SeatType @default(FREE) @map("seat_type")`(구매 시점 스냅샷), `Ticket.seatType SeatType @default(FREE) @map("seat_type")`. 관계 필드(`Seat.seatAssignments`, `Ticket.seatAssignments`, `Ticket.seatChanges`, `OrderItem.seatAssignments`, `User` 역관계) 추가 (data-model.md "기존 모델 변경", FR-016)
- [x] T009 `prisma/schema.prisma`에 `SeatAssignment` 모델을 추가한다(`seatId`, `orderItemId?`, `ticketId?`, `status @default(HELD)`, `heldUntil?`, `assignedAt?`, `releasedAt?`, `releaseReason?`, `createdAt`, `updatedAt`, `@@index([ticketId, status])`, `@@index([orderItemId])`, `@@map("seat_assignments")`)와 `TicketSeatChange` 모델(`ticketId`, `changeType`, `fromSeatType`, `toSeatType`, `fromSeatId?`, `toSeatId?`, `reason`, `changedBy`, `endedSessionId?`, `changedAt @default(now())`, `@@index([ticketId, changedAt])`, `@@map("ticket_seat_changes")`)을 추가한다. 부분 유일 인덱스는 스키마에 NOTE 주석으로 남긴다(기존 `UsageSession` 주석 형식)
- [x] T010 `npx prisma migrate dev --create-only --name add_seat_type`로 마이그레이션을 만들고, 생성된 `prisma/migrations/<timestamp>_add_seat_type/migration.sql` 끝에 raw SQL을 추가한다: `CREATE UNIQUE INDEX "seat_assignments_seat_id_valid_key" ON "seat_assignments"("seat_id") WHERE "status" IN ('HELD','ACTIVE');`, `CREATE UNIQUE INDEX "seat_assignments_ticket_id_active_key" ON "seat_assignments"("ticket_id") WHERE "status" = 'ACTIVE';`. 그 뒤 `npx prisma migrate dev`, `npx prisma generate` 실행. 기존 행이 모두 `FREE`인지 SQL로 확인한다 (research R1, R11, FR-016)
- [x] T011 [P] `src/seat-assignment/errors/`에 도메인 에러를 추가한다: `SeatNotAssignableError`(409, 유효 지정 있음), `SeatTypeMismatchError`(400), `SeatSelectionRequiredError`(400). 기존 `src/common/errors`의 `DomainConflictError`·`DomainBadRequestError`를 상속한다
- [x] T012 `src/seat-assignment/seat-assignment.policy.ts`(유효 판정 순수 함수 `isValidAssignment(assignment, ticket, now)`)와 `src/seat-assignment/seat-assignment.repository.ts`를 구현한다. **Repository는 데이터 접근만 담당한다(헌법 원칙 I)**: `lockSeat(seatId, tx)`(`SELECT ... FOR UPDATE`), `findOpenBySeat(seatId, tx)`(HELD·ACTIVE 행 + 연결 이용권 기한 필드), `findOpenBySeatIds(seatIds)`, `findActiveByTicket(ticketId, tx)`, `findHeldByOrderItems(orderItemIds, tx)`, `findLatestByOrderItem(orderItemId, tx)`(상태 무관 최근 지정, T005 작성 중 추가), `create(data, tx)`, `updateStatus(ids, data, tx)`. 판정·해제 결정·순서 조율은 넣지 않는다. 모든 메서드는 `TransactionClient`를 선택 인자로 받는다 (data-model.md, research R3)
- [x] T013 `src/seat-assignment/seat-assignment.service.ts`에 업무 로직을 구현한다: `findValidBySeat(seatId, now, tx)`(무효 행은 같은 `tx`에서 `RELEASED` 처리 후 유효 행만 반환), `hold`, `activateByOrderItem`, `assign`(점주 변경·재개용 ACTIVE 직접 생성), `releaseByTicket(ticketId, reason, now, tx)`, `releaseByOrderItems`, `getActiveByTicket`, `getAssignableMap(seatIds, now)`(좌석 목록의 `isAssignable` 계산용). 고정석 여부·매장 일치 검증과 `P2002` → `SeatNotAssignableError` 변환을 포함한다. 다른 모듈은 Repository가 아니라 이 Service를 쓴다. `src/seat-assignment/seat-assignment.module.ts`에서 Service만 export한다(`@Global()` 사용 금지)
- [x] T014 `npm run test -- --testPathPatterns=seat-assignment`로 T004·T005가 통과하는지 확인한다. 기대값은 바꾸지 않는다

**체크포인트**: 스키마·마이그레이션·좌석 지정 모듈 준비 완료. 이제 사용자 스토리를 시작할 수 있다.

---

## Phase 3: 사용자 스토리 1 — 점주가 좌석에 타입을 지정한다 (우선순위: P1) 🎯 MVP

**목표**: 좌석 등록·수정 시 타입을 지정하고, 조회 시 타입과 선택 가능 여부를 보여 준다. 이용 중·지정된 좌석의 변경을 막는다.

**독립 테스트**: 좌석을 고정석으로 등록 → 조회 시 `FIXED` → 자유석으로 수정 → 조회 시 `FREE`.

### US1 테스트 (먼저 작성) ⚠️

- [x] T015 [P] [US1] `src/seat/seat.service.spec.ts`에 단위 테스트를 작성한다: 타입 지정 등록 / 이용 중(활성 세션 있음) 좌석의 `type`·`status` 변경 시 `DomainConflictError`(FR-003, research R8·R9) / 유효 지정 있는 고정석의 `FREE` 변경 시 409 / 유효 지정 있는 고정석의 `UNAVAILABLE` 변경 시 409(FR-022) / 조회 결과에 `type`, `isAssignable`(자유석은 항상 false) 포함
- [x] T016 [P] [US1] `src/seat/dto/create-seat.dto.spec.ts`(신규)에 class-validator 검증 테스트를 작성한다: `type` 누락 시 오류, `FIXED`·`FREE` 외 값 오류(FR-002, FR-004), `UpdateSeatDto`의 `status`는 `AVAILABLE`·`UNAVAILABLE`만 허용
- [x] T017 [US1] `test/seat-type.e2e-spec.ts`에 US1 E2E를 작성한다: QS-1(`type` 없이 등록 → 400), QS-2(고정석 등록 후 목록 → `type = FIXED`, `isAssignable = true`), QS-23(유효 지정 있는 고정석을 자유석으로 수정 → 409), QS-26(이용 중 좌석 타입 변경 → 409, 점주 퇴실 처리 후 → 성공), QS-27(유효 지정 있는 고정석을 `UNAVAILABLE` → 409), QS-27a(이용 중 자유석 `UNAVAILABLE` → 409, 점주 퇴실 처리 후 → 성공). 지정 데이터는 `prisma.seatAssignment.create`로 직접 준비한다
- [x] T018 [US1] `npm run test -- --testPathPatterns=seat`와 `npm run test:e2e -- --testPathPatterns=seat-type`를 실행해 T015~T017이 **실패하는 것을 확인**하고 실패 사유를 기록한다

### US1 구현

- [x] T019 [P] [US1] `src/seat/dto/create-seat.dto.ts`에 `type!: SeatType`(`@IsEnum(SeatType)`, Swagger `enum` 설명 한글)을 추가한다. `src/seat/shop-seat.controller.ts`의 `@ApiBody({ required: false })`와 선택 본문(`createSeatDto?`)을 필수로 바꾼다
- [x] T020 [P] [US1] `src/seat/dto/update-seat.dto.ts`에 `type?: SeatType`(`@IsOptional() @IsEnum(SeatType)`), `status?: SeatStatus`(`@IsOptional() @IsEnum(SeatStatus)`)를 추가한다. 사용하지 않는 `IsUUID` import를 정리한다
- [ ] T021 [US1] `src/seat/seat.repository.ts`에 `hasActiveSession(seatId, tx)`를 추가하고, `updateSeat`가 `type`·`status`를 받도록 한다
- [ ] T022 [US1] `src/seat/seat.service.ts`의 `createSeat`에 `type`을 전달하고, `updateSeat`에 가드를 구현한다: `type` 또는 `status` 변경 시 하나의 트랜잭션에서 좌석 행 잠금 → 활성 세션 있으면 409 → 고정석이고 `SeatAssignmentService.findValidBySeat`가 유효 지정을 반환하면 `FREE`·`UNAVAILABLE` 변경 409. `SeatModule`에서 `SeatAssignmentModule`을 import한다
- [ ] T023 [US1] `src/seat/dto/get-seat-out.dto.ts`에 `type`, `isAssignable`를 추가하고 `SeatService.getSeat`에서 `SeatAssignmentService.getAssignableMap`으로 계산한다(조회 시점 판정, research R3)
- [ ] T024 [US1] T015~T017을 다시 실행해 통과를 확인한다. 기대값은 바꾸지 않는다

**체크포인트**: US1 단독으로 동작·검증 가능(MVP).

---

## Phase 4: 사용자 스토리 2 — 이용자가 최초 구매 시 좌석 타입을 선택한다 (우선순위: P2)

**목표**: 상품에 좌석 타입을 지정하고(등록·수정), 고정석 상품은 주문 시 좌석을 선점·결제 시 확정하며, 취소·실패 시 해제한다.

**독립 테스트**: 고정석 시간권 상품 주문(좌석 지정) → 결제 성공 → 이용권 조회 시 `FIXED` + 지정 좌석.

### US2 테스트 (먼저 작성) ⚠️

- [ ] T025 [P] [US2] `src/product/product.service.spec.ts`(신규)에 단위 테스트를 작성한다: 등록 시 `seatType` 저장 / 수정 시 바뀐 필드마다 `ProductHistory` 1행(같은 `changeGroupId`, `oldValue`·`newValue` 문자열) / 시간권 상품에 `purchasedDurationDays` 또는 기간권 상품에 `purchasedMinutes` 수정 시 400 / 삭제됐거나 다른 매장 상품이면 404 (FR-005, research R8)
- [ ] T026 [P] [US2] `src/product/dto/update-product.dto.spec.ts`(신규)에 검증 테스트를 작성한다: `type`(이용권 종류) 필드는 whitelist로 거부(전역 `forbidNonWhitelisted`), 나머지 필드는 모두 선택, `seatType`은 `FIXED`·`FREE`만 허용 (research R8 "이용권 종류 변경 불가")
- [ ] T027 [P] [US2] `src/order/order.service.spec.ts`(신규)에 단위 테스트를 작성한다: 고정석 줄 `seatId` 누락 → 400 / 고정석 줄 `quantity != 1` → 400 / 자유석 줄에 `seatId` → 400 / 다른 매장 좌석 또는 자유석 좌석 → 400 / 같은 주문 안 같은 좌석 중복 → 409 / 성공 시 줄마다 `hold`(heldUntil = now + `SEAT_HOLD_MINUTES`) 호출, `OrderItem.seatType` 스냅샷 저장 / `cancelOrder`: HELD 해제(`ORDER_CANCELLED`), 이미 해제됐으면 성공(멱등), 결제 SUCCESS 주문은 409 (FR-007~009, research R2·R4)
- [ ] T028 [P] [US2] `src/payment/payment.service.spec.ts`(신규)에 단위 테스트를 작성한다: 결제 요청 시 주문의 고정석 HELD가 하나라도 만료·해제됐으면 VAN 요청 전에 409 + 해당 HELD `RELEASED(HOLD_EXPIRED)`(research R12-C) / 승인 성공 시 이용권 생성과 같은 트랜잭션에서 `SeatAssignmentService.activateByOrderItem`(이용권 `seatType` = 주문 항목 스냅샷) / 승인 실패·금액 불일치 시 HELD 해제(`PAYMENT_FAILED`) / HELD가 만료됐지만 다른 유효 지정이 없으면 ACTIVE로 확정 / 다른 유효 지정이 있으면 결제는 SUCCESS, 이용권은 발급, **커밋 후** 그 이용권마다 `RefundService.refundBySystem(ticketId, '좌석 선점 만료로 좌석 배정 불가 - 자동 결제 취소')` 호출, 다른 주문 항목은 정상 확정 / `refundBySystem`이 예외를 던져도 결제 콜백은 실패시키지 않고 거래 로그를 남긴다 (contracts 4절, research R12-A)
- [ ] T029 [P] [US2] `src/refund/refund.service.spec.ts`(신규)에 `refundBySystem` 단위 테스트를 작성한다: 소유자 검사 없이 기존 미사용 자동 환불 경로(`createRefundWithLock` → `pgService.requestPaymentCancel`)를 탄다 / `PaymentCancel.reason`에 사유 저장 / 이미 `REVOKED`면 409 / 사용 이력이 있는 이용권이면 승인 대기로 가지 않고 예외(시스템 자동 취소는 미사용 이용권 전용) (research R12-A)
- [ ] T030 [P] [US2] `src/ticket/ticket.service.spec.ts`(신규)에 단위 테스트를 작성한다: 조회 결과에 `seatType`, `assignedSeat`(`{ id, number, name } | null`) 포함 (FR-010)
- [ ] T031 [US2] `test/seat-type.e2e-spec.ts`에 US2 E2E를 작성한다: QS-3, QS-4, QS-5, QS-6, QS-7, QS-8(같은 좌석으로 주문 2건을 `Promise.all`로 동시 요청 → 1건 성공·1건 409), QS-9, QS-10, QS-24(주문 취소 → 즉시 `isAssignable = true`), QS-25(`heldUntil`을 DB에서 과거로 바꿔 방치 상황을 만든 뒤 목록·새 주문), QS-28, QS-29, QS-30(만료된 선점으로 결제 요청 → 409), QS-31(승인 후 좌석 충돌 → 자동 환불 요청 생성, 환불 콜백 `POST /refund/callback` 호출 후 이용권 `REVOKED`). 결제 콜백은 `POST /payments/callback`을 직접 호출한다
- [ ] T032 [US2] `npm run test -- --testPathPatterns="product|order|payment|refund.service|ticket.service"`와 `npm run test:e2e -- --testPathPatterns=seat-type`를 실행해 T025~T031이 **실패하는 것을 확인**하고 실패 사유를 기록한다

### US2 구현

- [ ] T033 [P] [US2] `src/product/dto/create-product.dto.ts`에 `seatType!: SeatType`(`@IsEnum(SeatType)`)을 추가하고, `src/product/product.service.ts`·`product.repository.ts`의 등록 경로에 전달한다. 조회 출력(`get-product-out.dto.ts`)에 `seatType` 추가 (FR-005)
- [ ] T034 [US2] `src/product/dto/update-product.dto.ts`(신규)를 만든다: `CreateProductDto`에서 `type`을 뺀 필드를 모두 `@IsOptional()`로. `src/product/product.service.ts`에 `updateProduct`(종류별 필드 검증, 404 처리, **기존 값과 비교해 바뀐 필드 목록과 `ProductHistory` 행 데이터 생성**, `changeGroupId = randomUUID()`), `src/product/product.repository.ts`에 `updateProductWithHistories(productId, data, histories, tx)`(같은 트랜잭션에서 상품 갱신과 `ProductHistory` 다건 저장만, 비교 로직 없음, 헌법 원칙 I), `src/product/product.controller.ts`에 `@Patch(':productId')` + `@Roles(Role.OWNER, Role.MANAGER)` + `@CurrentUser('userId')`를 추가한다 (research R8)
- [ ] T035 [US2] `src/order/dto/create-order.dto.ts`의 `orderedProducts` 항목을 `OrderedProductDto` 클래스로 분리한다(`productId` `@IsUUID('4')`, `quantity` `@IsInt() @Min(1)`, `seatId?` `@IsOptional() @IsUUID('4')`)하고 `@ValidateNested({ each: true }) @Type(() => OrderedProductDto)`를 적용한다
- [ ] T036 [US2] 주문 생성의 업무 로직을 Service로 옮겨 고정석 검증과 선점을 넣는다(헌법 원칙 I). `src/order/order.service.ts`의 `createOrder`가 `PrismaService.executeTransaction`으로 트랜잭션을 열고 순서를 조율한다: 상품 조회(Repository) → 상품 `seatType`에 따라 `seatId`·`quantity`·좌석 타입·매장 검증 → 금액 계산 → 주문·주문 항목 저장(Repository, `seatType` 스냅샷 포함) → 고정석 주문 항목마다 `SeatAssignmentService.hold`(같은 `tx`). `src/order/order.repository.ts`의 `createOrder`는 `findActiveProducts(ids, tx)`, `createOrderWithItems(data, tx)` 같은 쿼리 메서드로 나누고 검증·계산 로직은 Service로 옮긴다(이 메서드만 대상, 다른 기존 Repository는 건드리지 않는다). `SEAT_HOLD_MINUTES`는 `ConfigService`로 읽는다. `OrderModule`에서 `SeatAssignmentModule` import
- [ ] T037 [US2] `src/order/order.service.ts`에 `cancelOrder(orderId)`, `src/order/order.controller.ts`에 `@Patch(':orderId/cancel')`(`ParseUUIDPipe`)를 추가한다. 결제 SUCCESS 주문이면 `DomainConflictError` (research R2)
- [ ] T038 [US2] `src/refund/refund.service.ts`에 공개 메서드 `refundBySystem(ticketId, reason)`을 추가한다: 기존 `refund`의 공통 검증 중 소유자 검사만 빼고, 미사용 이용권만 `processAutoRefund`로 처리한다. `createRefundWithLock`·`refund.repository.ts`의 `PaymentCancel` 생성에 `reason`을 전달한다. `src/refund/refund.module.ts`에 `exports: [RefundService]` 추가 (research R12-A)
- [ ] T039 [US2] `src/payment/payment.service.ts`·`payment.repository.ts`를 고친다: `requestPayment`에서 VAN 요청 전 고정석 HELD 유효성 확인(만료 시 `RELEASED(HOLD_EXPIRED)` + 409, R12-C) / `PaymentService.successPayment`가 `PrismaService.executeTransaction`으로 트랜잭션을 열고 순서를 조율한다(업무 로직은 Service, 헌법 원칙 I): 결제 상태 갱신(Repository) → 이용권 생성(Repository, `seatType`은 주문 항목 스냅샷에서 복사) → 고정석 주문 항목마다 `SeatAssignmentService.activateByOrderItem`(같은 `tx`) → 확정하지 못한 고정석 이용권 ID 목록 수집. `payment.repository.ts`의 `successPayment`는 `tx`를 받는 결제 갱신·이용권 생성 쿼리 메서드로 나누고, 다른 모듈의 Service를 호출하지 않는다 / 커밋 후 그 목록마다 `RefundService.refundBySystem` 호출(예외는 `TransactionLoggerService`에 기록하고 콜백은 성공 처리, R12-A) / `failedPayment` 경로(승인 실패·금액 불일치)에 `releaseByOrderItems(PAYMENT_FAILED)`. `PaymentModule`에서 `SeatAssignmentModule`, `RefundModule`, `LoggerModule` import (contracts 4절)
- [ ] T040 [US2] `src/ticket/ticket.repository.ts` 조회에 `seatType`과 ACTIVE `seatAssignments`(좌석 `id·number·name`)를 포함하고, `src/ticket/ticket.service.ts`의 `toTicketOutData`·`src/ticket/ticket.types.ts` 출력 타입에 `seatType`, `assignedSeat`를 추가한다 (FR-010)
- [ ] T041 [US2] T025~T031을 다시 실행해 통과를 확인한다. 기대값은 바꾸지 않는다

**체크포인트**: US1·US2가 각각 독립적으로 동작.

---

## Phase 5: 사용자 스토리 3 — 이용권의 좌석 타입에 맞는 좌석을 이용한다 (우선순위: P3)

**목표**: 입실 시 좌석 타입·지정 좌석을 검증하고, 이용권 종료(소진·환불·기한 경과) 시 지정을 해제한다.

**독립 테스트**: 고정석 이용권으로 지정 좌석 입실 성공·다른 좌석 거부, 자유석 이용권으로 고정석 입실 거부.

### US3 테스트 (먼저 작성) ⚠️

- [ ] T042 [P] [US3] `src/usage-session/usage-session.service.spec.ts`(신규)에 단위 테스트를 작성한다: 고정석 이용권 + 지정 좌석 → 세션 생성 / 고정석 이용권 + 다른 좌석 → `SeatTypeMismatchError`(400) / 자유석 이용권 + 자유석 → 생성 / 자유석 이용권 + 고정석 → 400 (FR-011)
- [ ] T043 [P] [US3] `src/session-lifecycle/session-lifecycle.service.spec.ts`(신규)에 단위 테스트를 작성한다: 시간권 소진(EXHAUSTED 전이) 시 같은 트랜잭션에서 `releaseByTicket(TICKET_EXHAUSTED)` 호출 / 소진되지 않으면 호출하지 않음 (FR-017)
- [ ] T044 [P] [US3] `src/refund/refund.service.spec.ts`에 단위 테스트를 추가한다: 환불 확정(`callback()`, `clearStaleLock()`의 SUCCEEDED 분기)에서 `refundRepository.confirmRefundSuccess`와 같은 트랜잭션으로 `SeatAssignmentService.releaseByTicket(TICKET_REVOKED)` 호출 / FAILED 분기에서는 호출하지 않음 (FR-017)
- [ ] T045 [US3] `test/seat-type.e2e-spec.ts`에 US3 E2E를 작성한다: QS-11, QS-11a, QS-11b, QS-12, QS-20(시간권 잔여시간을 1분으로 만든 뒤 세션 종료 API 호출로 소진 → 좌석 `isAssignable = true`), QS-21(환불 확정 경로 호출 → 지정 해제), QS-22(기간권 `expiresAt`을 과거로 바꾼 뒤 같은 좌석으로 새 주문 → 성공, 기존 지정은 `RELEASED(TICKET_EXPIRED)`)
- [ ] T046 [US3] `npm run test -- --testPathPatterns="usage-session|session-lifecycle|refund"`와 E2E를 실행해 T042~T045가 **실패하는 것을 확인**하고 실패 사유를 기록한다

### US3 구현

- [ ] T047 [US3] `src/usage-session/usage-session.service.ts`의 `createSession`에 검증을 추가한다(업무 로직은 Service, 헌법 원칙 I): 좌석 `type`과 이용권 `seatType` 일치, 고정석이면 `SeatAssignmentService.getActiveByTicket`의 좌석과 요청 좌석 일치. 세션 생성 트랜잭션 전에 Service에서 검증하고, 고정석은 세션 생성과 같은 트랜잭션에서 지정 행을 `FOR UPDATE`로 다시 조회해 확인한다(검증과 생성 사이 변경 방지). `usage-session.repository.ts`에는 필요한 조회 쿼리만 추가한다. `UsageSessionModule`에서 `SeatAssignmentModule` import (FR-011)
- [ ] T048 [US3] `src/session-lifecycle/session-lifecycle.service.ts`의 시간권 차감 SQL을 `RETURNING status`로 바꿔 EXHAUSTED 전이를 판별하고, 전이됐으면 같은 `tx`로 `releaseByTicket(TICKET_EXHAUSTED)`를 호출한다. `SessionLifecycleModule`에서 `SeatAssignmentModule` import (FR-017)
- [ ] T049 [US3] `src/refund/refund.service.ts`의 환불 확정 지점 두 곳(`callback()`, `clearStaleLock()`에서 `confirmRefundSuccess`를 호출하는 트랜잭션)에 같은 `tx`로 `SeatAssignmentService.releaseByTicket(TICKET_REVOKED)` 호출을 추가한다. Repository(`refund.repository.ts`)는 바꾸지 않는다(Repository가 다른 모듈의 업무 로직을 부르지 않게 함, 헌법 원칙 I). `RefundModule`에서 `SeatAssignmentModule` import (FR-017)
- [ ] T050 [US3] T042~T045를 다시 실행해 통과를 확인한다. 기대값은 바꾸지 않는다

**체크포인트**: US1~US3이 각각 독립적으로 동작.

---

## Phase 6: 사용자 스토리 4 — 점주가 이용권의 좌석을 변경한다 (우선순위: P3)

**목표**: 이용권 좌석 타입 변경·고정석 이동 API, 변경 이력, 일시정지 해제·재개 재지정.

**독립 테스트**: 자유석 이용권을 고정석으로 변경(좌석 지정) → 조회 시 고정석·지정 좌석 → 자유석으로 변경 → 지정 해제.

### US4 테스트 (먼저 작성) ⚠️

- [ ] T051 [P] [US4] `src/ticket/ticket-seat/ticket-seat.service.spec.ts`(신규)에 단위 테스트를 작성한다: FREE→FIXED(새 ACTIVE, 이용 중이면 `endSession` 호출·자동 입실 없음) / FIXED→FREE(`SEAT_TYPE_CHANGED` 해제, 이용 중이면 `endSession`) / FIXED→FIXED(`SEAT_MOVED` 해제 + 새 ACTIVE, 이용 중이면 세션 `seatId`만 변경·`endSession` 미호출, 대상 좌석에 다른 활성 세션 있으면 409) / 모든 경우 `TicketSeatChange` 1행(`endedSessionId` 포함) / 사유 없음·FIXED인데 `seatId` 없음·자유석 좌석 지정·같은 타입 같은 좌석 → 400 / 종료 상태·일시정지 중 이용권 → 400 / 대상 좌석 유효 지정 있음 → 409 (FR-013~015b, FR-019~021, research R5·R6)
- [ ] T052 [P] [US4] `src/ticket/ticket-seat/dto/change-ticket-seat.dto.spec.ts`(신규)에 검증 테스트를 작성한다: `seatType` 필수(`IsEnum`), `seatType = FIXED`이면 `seatId` 필수(`ValidateIf` + `IsUUID('4')`), `reason` 필수(`IsNotEmpty`, `IsString`, `MaxLength(500)`) (FR-020)
- [ ] T053 [P] [US4] `src/ticket/ticket-pause/ticket-pause.service.spec.ts`(신규)에 단위 테스트를 작성한다: 고정석 이용권 정지 시 같은 트랜잭션에서 `releaseByTicket(TICKET_PAUSED)` / 고정석 재개 시 `seatId` 없으면 400 / 지정 불가 좌석이면 409이고 정지 상태 유지(재개 롤백) / 자유석 재개는 기존과 같음. 테스트 이용권은 활성화된 기간권으로 준비한다(시간권은 현재 일시정지 불가, research R10) (FR-018)
- [ ] T054 [US4] `test/seat-type.e2e-spec.ts`에 US4 E2E를 작성한다: QS-13, QS-13a, QS-14, QS-14a, QS-15(세션 ID 동일·좌석만 변경 확인), QS-15a, QS-15b, QS-16, QS-16a, QS-17(`GET /tickets/:ticketId/seat-changes`), QS-18, QS-19(QS-18·19는 활성화된 기간권으로 준비, research R10)
- [ ] T055 [US4] `npm run test -- --testPathPatterns="ticket-seat|ticket-pause"`와 E2E를 실행해 T051~T054가 **실패하는 것을 확인**하고 실패 사유를 기록한다

### US4 구현

- [ ] T056 [P] [US4] `src/ticket/ticket-seat/dto/change-ticket-seat.dto.ts`(신규)를 만든다: `seatType`(`@IsEnum(SeatType)`), `seatId?`(`@ValidateIf((dto) => dto.seatType === SeatType.FIXED) @IsUUID('4')`), `reason`(`@IsNotEmpty() @IsString() @MaxLength(500)`)
- [ ] T057 [US4] `src/ticket/ticket-seat/ticket-seat.repository.ts`(신규)를 만든다: 이용권 `FOR UPDATE` 조회, 활성 세션 조회, 세션 `seatId` 변경, 이용권 `seatType` 변경, `TicketSeatChange` 생성, 이용권별 이력 조회(최신순)
- [ ] T058 [US4] `src/ticket/ticket-seat/ticket-seat.service.ts`(신규)에 `changeSeat(ticketId, dto, changedBy)`와 `getSeatChanges(ticketId)`를 구현한다. 타입 변경 중 이용 중이면 `SessionLifecycleService.endSession`을 트랜잭션 안에서 호출하고, 커밋 후 BullMQ Job을 제거한다(`TicketPauseService.pauseTicket`과 같은 패턴, research R6). 고정석 이동은 세션 유지(research R5)
- [ ] T059 [US4] `src/ticket/ticket-seat/ticket-seat.controller.ts`(신규)에 `@Patch(':ticketId/seat')`, `@Get(':ticketId/seat-changes')`를 `@Roles(Role.OWNER, Role.MANAGER)`, `ParseUUIDPipe`, `@CurrentUser()`로 추가하고 `src/ticket/ticket.module.ts`에 등록한다(`SeatAssignmentModule`, `SessionLifecycleModule`, BullMQ `usage-session` 큐 import)
- [ ] T060 [US4] `src/ticket/ticket-pause/dto/resume-ticket.dto.ts`에 `seatId?`(`@IsOptional() @IsUUID('4')`)를 추가하고, `src/ticket/ticket-pause/ticket-pause.service.ts`의 `pauseTicket` 트랜잭션에 `releaseByTicket(TICKET_PAUSED)`, `resumeTicket` 트랜잭션에 고정석 재지정(`assign`, 실패 시 예외로 롤백)을 추가한다. `ticket-pause.controller.ts`에서 `dto.seatId` 전달 (FR-018)
- [ ] T061 [US4] T051~T054를 다시 실행해 통과를 확인한다. 기대값은 바꾸지 않는다

**체크포인트**: 모든 사용자 스토리가 독립적으로 동작.

---

## Phase 7: 마무리 및 공통 점검

- [ ] T062 [P] `test/ticket-pause.e2e-spec.ts`, `test/app.e2e-spec.ts` 회귀를 실행한다. 좌석 등록 본문 필수화(T019)·상품 `seatType` 필수(T033)로 깨지는 기존 테스트 준비 코드가 있으면, **기대값이 아니라 준비 데이터만** 고친다. 기대값 변경이 필요해 보이면 멈추고 사용자에게 확인한다. `test/app.e2e-spec.ts:20`의 기존 타입 오류는 이 기능과 무관하므로 건드리지 않는다
- [ ] T063 [P] 변경·신규 Swagger 데코레이터(`@ApiProperty`, `@ApiOperation`)의 설명을 한글로 채운다(`src/seat/`, `src/product/`, `src/order/`, `src/ticket/ticket-seat/`)
- [ ] T064 [P] 변경한 모든 함수에 한글 JSDoc(`@param`, `@returns`, `@throws`)과 논리 단계별 한글 인라인 주석이 있는지 점검한다
- [ ] T065 `npx eslint .`, `npm run build`, `npm run test`, `npm run test:e2e`를 실행해 모두 통과를 확인한다
- [ ] T066 [quickstart.md](./quickstart.md)의 QS-1~QS-31(27a·11a 등 알파벳 붙은 번호 포함)이 모두 E2E 테스트에 있는지, 그리고 "경우의 수 표" 1~3의 모든 칸에 QS 번호나 단위 테스트가 있는지 대조표로 확인한다. E2E 테스트 이름 끝에는 `(QS-n)`을 붙이고, 단위 테스트 이름에는 번호를 붙이지 않는다

---

## 의존 관계와 실행 순서

### 단계 의존

- **Phase 1 준비**: 의존 없음
- **Phase 2 기반**: Phase 1 완료 후. **모든 사용자 스토리를 막는다**
- **Phase 3~6 사용자 스토리**: Phase 2 완료 후
  - US1(P1): 다른 스토리에 의존하지 않음
  - US2(P2): 다른 스토리에 의존하지 않음. 단, E2E QS-24·25의 `isAssignable` 확인은 US1의 T023 이후 가능
  - US3(P3): 고정석 이용권 준비에 US2(주문·결제) 경로를 쓰거나 DB로 직접 준비한다. 단위 테스트는 독립
  - US4(P3): 이용 중 시나리오에 US3의 입실 검증(T047)을 쓴다. 단위 테스트는 독립
- **Phase 7 마무리**: 모든 스토리 완료 후

### 스토리 안의 순서 (TDD)

테스트 작성 → **실패 확인** → DTO → Repository → Service → Controller → 통과 확인

### 동시 진행 가능

- Phase 1: T003은 T001·T002와 동시에 가능
- Phase 2: T004, T005 (테스트), T011 (에러 클래스)
- 각 스토리의 `[P]` 테스트 작업(예: US2의 T025~T030)은 서로 다른 파일이라 동시에 작성 가능
- Phase 2 완료 후 US1과 US2는 동시에 진행 가능

---

## 병렬 예시: 사용자 스토리 2

```text
# US2 테스트를 동시에 작성:
T025 src/product/product.service.spec.ts
T026 src/product/dto/update-product.dto.spec.ts
T027 src/order/order.service.spec.ts
T028 src/payment/payment.service.spec.ts
T030 src/ticket/ticket.service.spec.ts
T029  src/refund/refund.service.spec.ts
# 그 다음 T031(E2E) → T032(실패 확인)
```

---

## 구현 전략

### MVP 먼저 (US1만)

1. Phase 1 준비 → Phase 2 기반
2. Phase 3 US1
3. **멈추고 검증**: US1 단위·E2E 통과, 기존 데이터가 모두 자유석인지 확인
4. 커밋 후 다음 스토리로

### 점진적 진행

US1 → US2 → US3 → US4 순서로, 스토리마다 테스트 → 실패 확인 → 구현 → 통과 확인 → 커밋.

---

## 참고

- 실패 확인 작업(T006, T018, T032, T046, T055)은 실행 결과(실패한 테스트 이름과 사유)를 남긴 뒤 체크한다
- 통과 확인 작업에서 테스트가 실패하면 구현을 고친다. 테스트 기대값을 바꿔야 한다고 판단되면 멈추고 사용자에게 확인한다(헌법 III)
- 커밋 메시지는 한글로 작성한다(헌법 개발 흐름)
