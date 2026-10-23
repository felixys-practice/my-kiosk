---
description: "좌석 타입(고정석·자유석) 추가 기능의 구현 task 목록 (동작 단위 TDD, 동작마다 task 2개)"
---

# Task 목록: 좌석 타입(고정석·자유석) 추가

**입력**: `specs/001-seat-type/`의 설계 문서
**선행 문서**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/rest-api.md](./contracts/rest-api.md), [quickstart.md](./quickstart.md)

**테스트**: 헌법 원칙 III(v1.3.0)에 따라 테스트는 필수이며 TDD로 작성한다. TDD 사이클의 단위는 **동작 하나(테스트 하나)**다.
동작마다 task(작업) 2개로 사이클을 돈다: [작성 + 실패 확인] → [구현 + 통과 확인].
구현 후 테스트를 통과시키기 위해 기대값을 바꾸지 않는다. 기대값 변경이 필요하면 멈추고 사용자 확인을 받는다.

**구성**: 사용자 스토리별 단계로 묶고, 스토리 안에서는 동작(`#### 동작 n`)별로 사이클을 묶는다.
동작을 바꾸지 않는 구조 정리는 `#### 구조 정리: [대상]`으로 따로 두고 동작 번호를 매기지 않는다.

**경과 규정 적용 대상**(헌법 v1.3.0 거버넌스 > 경과 규정): T001~T005, T007~T020은 v1.2.0 개정 이전에 완료한 task다.
완료 상태와 원래 설명을 그대로 두고 다시 수행하지 않으며, 이 task들에서 작성한 테스트의 실패 이유는 소급해 확인하지 않는다.
T006은 적용 대상이 아니다(처리 내용은 T006 아래 기록).

## 형식: `[ID] [P?] [Story] 설명`

- **[P]**: 동시에 진행 가능(다른 파일, 미완료 task에 의존하지 않음). 사이클 안의 두 task는 서로 의존하므로 [P]를 붙이지 않는다
- **[Story]**: 해당 사용자 스토리(US1~US4)
- task 첫 줄은 `- [ ] T### [P?] [Story] task 종류:` 형식이고, 단계는 그 아래 들여쓴 줄에 ①②③으로 적는다
- 단계 설명에는 정확한 파일 경로, 테스트 이름, 기대 실패 사유를 적는다
- `QS-n`: [quickstart.md](./quickstart.md) 시나리오 번호. E2E 테스트 이름 끝에 `(QS-n)`을 붙이고, 단위 테스트 이름에는 번호를 붙이지 않는다

## 실행 명령 약속

task 설명의 "단위 단건", "E2E 단건"은 아래 명령을 뜻한다.

```bash
# 단위 단건: 파일과 테스트 이름으로 테스트 하나만 실행
npm run test -- --testPathPatterns=<파일 경로> -t "<테스트 이름>"

# E2E 단건: QS 번호로 시나리오 하나만 실행 (괄호까지 맞춰 QS-2가 QS-23과 섞이지 않게 한다)
npm run test:e2e -- --testPathPatterns=seat-type -t "\(QS-n\)"
```

## 단계별 규칙 (모든 사이클 공통)

- **task 1 (작성 + 실패 확인)**: 테스트를 작성하고 단건 실행해 실제 실패 사유를 기대 사유와 비교한다.
  메서드·필드·파일·라우트가 없어 생기는 오류(`is not a function`, `Cannot find module`, 라우트 404, whitelist 거부 등)는
  노리는 사유가 아니다. 이때는 빈 구현을 두고 다시 실행해 기대 사유로 실패하는지 확인한다(헌법 III).
  **실제 실패 사유를 task 아래에 기록한 뒤 체크한다. 이 task를 체크하기 전에는 task 2로 넘어가지 않는다**
- **task 2 (구현 + 통과 확인)**: 이 테스트를 통과시키는 데 필요한 만큼만 구현한다. 다음 동작의 조건은 미리 넣지 않는다.
  단건 통과 후 같은 테스트 파일 전체를 실행해 회귀가 없는지 확인한다
- **E2E가 있는 동작**: 바깥 고리(E2E)와 안쪽 고리(단위)를 함께 돈다.
  task 1 = E2E 작성 → E2E 실패 확인 → 단위 작성 → 단위 실패 확인 / task 2 = 구현 → 단위 통과 → E2E 통과
- **조건 깨뜨리기 (task 1개)**: 자기 사이클 전에 이미 통과하는 테스트(구현 전부터 통과하거나, 다른 동작의 구현으로 함께
  통과한 테스트)는 task에 적힌 조건을 잠시 지워 실패하는지 확인하고, 원복한 뒤 다시 통과를 확인한다.
  실패하지 않으면 테스트를 고치지 말고 멈춘 뒤 사용자에게 알린다
- **거부 동작 (헌법 VI)**: 요청 거부를 검증하는 E2E는 상태 코드와 함께 `error.code`를 검증하고,
  단위 테스트는 해당 도메인 에러 클래스를 검증한다. 기대 코드는 [contracts/rest-api.md](./contracts/rest-api.md)의 오류 표를 따른다.
  안내 문구(`error.message`)는 검증하지 않는다. DTO 형식 검증(`ValidationPipe`) 실패와 API 응답으로 나가지 않는 내부 호출(US2 동작 28·29)은 제외한다
- **구조 정리 (task 1개)**: 동작을 바꾸지 않고 구조만 바꾸는 task는 동작의 사이클과 섞지 않는다. 새 테스트를 쓰지 않으며,
  회귀 확인까지 한 task로 하고 다음 동작으로 간다

## 경로 관례

- 소스: `src/`, 스키마: `prisma/schema.prisma`, 마이그레이션: `prisma/migrations/`
- 단위 테스트는 소스 옆 `*.spec.ts`, E2E는 `test/seat-type.e2e-spec.ts`

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
- [x] T006 `npm run test -- --testPathPatterns=seat-assignment`를 실행해 T004·T005가 **실패하는 것을 확인**하고 실패 사유(모듈 없음·함수 없음)를 기록한다
  - 실행 결과(2026-10-22): `seat-assignment.policy.spec.ts`, `seat-assignment.service.spec.ts` 2개 파일 모두 `Cannot find module`로 실패했다(구현 파일 없음)
  - 미완료로 남은 이유: 실패를 확인한 뒤 기록과 체크를 하지 않은 채 T007~T014를 진행했다
  - 처리: T012·T013 구현이 끝나 같은 조건으로 다시 실행할 수 없으므로, 위 실행 결과를 기록하고 닫는다.
    이 task는 헌법 v1.3.0 경과 규정의 대상이 아니다. 노리는 사유로 실패하는지는 확인하지 못했다


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

### US1 테스트 작성과 DTO (완료)

- [x] T015 [P] [US1] `src/seat/seat.service.spec.ts`에 단위 테스트를 작성한다: 타입 지정 등록 / 이용 중(활성 세션 있음) 좌석의 `type`·`status` 변경 시 `DomainConflictError`(FR-003, research R8·R9) / 유효 지정 있는 고정석의 `FREE` 변경 시 409 / 유효 지정 있는 고정석의 `UNAVAILABLE` 변경 시 409(FR-022) / 조회 결과에 `type`, `isAssignable`(자유석은 항상 false) 포함
- [x] T016 [P] [US1] `src/seat/dto/create-seat.dto.spec.ts`(신규)에 class-validator 검증 테스트를 작성한다: `type` 누락 시 오류, `FIXED`·`FREE` 외 값 오류(FR-002, FR-004), `UpdateSeatDto`의 `status`는 `AVAILABLE`·`UNAVAILABLE`만 허용
- [x] T017 [US1] `test/seat-type.e2e-spec.ts`에 US1 E2E를 작성한다: QS-1(`type` 없이 등록 → 400), QS-2(고정석 등록 후 목록 → `type = FIXED`, `isAssignable = true`), QS-23(유효 지정 있는 고정석을 자유석으로 수정 → 409), QS-26(이용 중 좌석 타입 변경 → 409, 점주 퇴실 처리 후 → 성공), QS-27(유효 지정 있는 고정석을 `UNAVAILABLE` → 409), QS-27a(이용 중 자유석 `UNAVAILABLE` → 409, 점주 퇴실 처리 후 → 성공). 지정 데이터는 `prisma.seatAssignment.create`로 직접 준비한다
- [x] T018 [US1] `npm run test -- --testPathPatterns=seat`와 `npm run test:e2e -- --testPathPatterns=seat-type`를 실행해 T015~T017이 **실패하는 것을 확인**하고 실패 사유를 기록한다
- [x] T019 [P] [US1] `src/seat/dto/create-seat.dto.ts`에 `type!: SeatType`(`@IsEnum(SeatType)`, Swagger `enum` 설명 한글)을 추가한다. `src/seat/shop-seat.controller.ts`의 `@ApiBody({ required: false })`와 선택 본문(`createSeatDto?`)을 필수로 바꾼다
- [x] T020 [P] [US1] `src/seat/dto/update-seat.dto.ts`에 `type?: SeatType`(`@IsOptional() @IsEnum(SeatType)`), `status?: SeatStatus`(`@IsOptional() @IsEnum(SeatStatus)`)를 추가한다. 사용하지 않는 `IsUUID` import를 정리한다

### US1 남은 사이클 (이미 작성된 테스트를 하나씩 통과시킨다)

테스트는 T015~T017에서 모두 작성됐으므로 task 1은 작성 없이 **실패 확인**만 한다.
2026-10-22 실행 기준 상태:

- `src/seat/dto/create-seat.dto.spec.ts` 전부, E2E QS-1: 통과(T018에서 실패 확인 후 T019·T020으로 통과, 추가 task 없음)
- `src/seat/seat.service.spec.ts`: 11개 중 10개 실패. 「현재와 같은 값으로 바꾸면 이용 중이어도 가드에 걸리지 않는다」는 **구현 전부터 통과**
- E2E QS-2, QS-23, QS-26, QS-27, QS-27a: 실패

#### 동작 1. 등록 시 좌석 타입을 저장한다

- [x] T021 [US1] 실패 확인:
  ① 실패 확인: 단위 단건(`src/seat/seat.service.spec.ts`, "지정한 좌석 타입으로 좌석을 등록한다").
     기대 사유: 현재 시그니처 `createSeat(shopId, name?, number?)`가 DTO 객체를 `name` 자리로 받아 `repository.createSeat`가 `type` 없이 호출됨
  - 실제 실패(2026-10-22): `toHaveBeenCalledWith` 불일치. 실제 호출은 `{ name: { name, number, type }, number: NaN, shop }`로 최상위 `type` 없음. 기대 사유와 같음
- [x] T022 [US1] 구현 + 통과 확인:
  ① 구현: `src/seat/seat.service.ts`의 `createSeat`를 `createSeat(shopId: string, dto: CreateSeatDto)`로 바꾸고 `repository.createSeat`에 `type`을 함께 넘긴다.
     `src/seat/shop-seat.controller.ts`는 `createSeatDto`를 그대로 넘긴다
  ② 통과 확인: 단위 단건 통과, `npm run test -- --testPathPatterns=src/seat/` 전체에서 DTO 테스트 회귀 없음
  - 결과(2026-10-22): 단건 통과. `src/seat/` 19개 중 11개 통과, 실패 8개는 이후 사이클 대상(DTO 8개 회귀 없음)

#### 동작 2. 번호 없이 등록하면 마지막 번호 다음 값을 쓴다 — 동작 1 구현으로 함께 통과

- [x] T023 [US1] 조건 깨뜨리기:
  ① 통과 확인: 단위 단건("좌석 번호가 없으면 마지막 번호 다음 값으로 등록한다") 통과
  ② 조건 깨뜨리기: `createSeat`의 `getLastSeatNumber(...) + 1`에서 `+ 1`을 잠시 지워 단건이 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 단건 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-22): ① 통과 → ② `+ 1` 제거 시 `number: 7`(기대 8)로 실패 → ③ 원복 후 통과

#### 동작 3. 이름·번호 수정은 트랜잭션 안에서 가드 없이 수정한다

- [x] T024 [US1] 실패 확인:
  ① 실패 확인: 단위 단건("이름·번호만 바꾸면 이용 중이어도 그대로 수정한다").
     기대 사유: `repository.updateSeat`가 세 번째 인자 `tx` 없이 `(seatId, data)`로 호출됨
  - 실제 실패(2026-10-22): 호출 인자가 `("seat-1", {name: "B1"})`로 세 번째 인자(`tx`) 없음. 기대 사유와 같음
- [x] T025 [US1] 구현 + 통과 확인:
  ① 구현: `src/seat/seat.repository.ts`에 `runInTransaction(work)`(`PrismaService.executeTransaction` 위임), `findByIdForUpdate(seatId, tx)`
     (raw SQL `SELECT id, type, status ... FOR UPDATE`, 테이블명은 `schema.prisma`의 `@@map` 확인, 결과 `{ id, type, status } | null`)를 추가하고
     `updateSeat(seatId, data, tx?)`가 `tx`를 받게 한다. `src/seat/seat.service.ts`의 `updateSeat(seatId, dto: UpdateSeatDto)`는
     `runInTransaction` 안에서 `findByIdForUpdate` → `repository.updateSeat(seatId, dto, tx)` 순서로 호출한다(가드는 넣지 않는다)
  ② 통과 확인: 단위 단건 통과, `src/seat/` 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과. `src/seat/` 19개 중 12개 통과(회귀 없음)

#### 동작 4. 없는 좌석을 수정하면 404

- [x] T026 [US1] 실패 확인:
  ⓪ 기대값 변경(2026-10-22 사용자 확인, 헌법 III·VI): `src/seat/seat.service.spec.ts`의
     「좌석이 없으면 DomainNotFoundError를 던진다」를 「좌석이 없으면 SeatNotFoundError를 던진다」로 바꾸고
     `toBeInstanceOf(SeatNotFoundError)`로 검증한다. 에러 파일이 없어 `Cannot find module`이면 `src/seat/errors/seat-not-found.error.ts`에
     빈 클래스(`DomainNotFoundError` 상속, `name = 'SeatNotFoundError'`)를 두고 다시 확인한다
  ① 실패 확인: 단위 단건("좌석이 없으면 SeatNotFoundError를 던진다"). 기대 사유: 예외 없이 resolve됨
  - 실제 실패(2026-10-22): ⓪ 변경 후 1차 `Cannot find module './errors/seat-not-found.error'` → `SeatNotFoundError` 클래스를 두고 2차 `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T027 [US1] 구현 + 통과 확인:
  ① 구현: `src/seat/seat.service.ts`의 `updateSeat`에서 `findByIdForUpdate` 결과가 `null`이면 `SeatNotFoundError`(`src/seat/errors/seat-not-found.error.ts`, 안내 문구 '좌석을 찾을 수 없습니다')
  ② 통과 확인: 단위 단건 통과, `src/seat/` 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과. `src/seat/` 19개 중 13개 통과(회귀 없음)

#### 동작 5. 이용 중인 좌석의 타입 변경은 409 (QS-26)

- [x] T028 [US1] 실패 확인:
  ⓪ 기대값 변경(2026-10-22 사용자 확인, 헌법 III·VI): `src/seat/seat.service.spec.ts`의
     「이용 중인 좌석의 타입을 바꾸면 DomainConflictError(409)를 던진다」를
     「이용 중인 좌석의 타입을 바꾸면 SeatAlreadyOccupiedError(409)를 던진다」로 바꾸고 `toBeInstanceOf(SeatAlreadyOccupiedError)`로 검증한다
     (`src/usage-session/errors/seat-already-occupied.error.ts` 재사용). E2E(QS-26)의 첫 `PATCH`에 `error.code = SeatAlreadyOccupiedError` 검증을 추가한다
  ① E2E 실패 확인: E2E 단건(QS-26). 기대 사유: 첫 `PATCH /seats/:seatId`가 409가 아니라 200.
     500이 나오면 동작 3의 `findByIdForUpdate` SQL을 먼저 고친다
  ② 단위 실패 확인: 단위 단건("이용 중인 좌석의 타입을 바꾸면 SeatAlreadyOccupiedError(409)를 던진다"). 기대 사유: 예외 없이 resolve됨
  - 실제 실패(2026-10-22): ⓪ 변경 반영. E2E(QS-26) `expected 409 "Conflict", got 200 "OK"`(500 아님, `findByIdForUpdate` 정상) /
    단위 `Received promise resolved instead of rejected`. 둘 다 기대 사유와 같음
- [x] T029 [US1] 구현 + 통과 확인:
  ① 구현: `src/seat/seat.repository.ts`에 `hasActiveSession(seatId, tx)`(`UsageSession` 중 `status = ACTIVE`인 행 존재 여부)를 추가한다.
     `src/seat/seat.service.ts`의 `updateSeat`에서 `dto.type`이 있고 **현재 `type`과 다를 때** 이용 중이면
     `SeatAlreadyOccupiedError(seatId)`. `status` 조건은 동작 7에서 넣는다 (FR-003, research R9)
  ② 단위 통과 확인: 단위 단건 통과, `src/seat/` 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-26) 통과(퇴실 처리 후 변경 성공까지)
  - 결과(2026-10-22): 단위 단건 통과, `src/seat/` 19개 중 14개 통과(회귀 없음), E2E(QS-26) 통과

#### 동작 6. 현재와 같은 값이면 가드에 걸리지 않는다 — 구현 전부터 통과

- [x] T030 [US1] 조건 깨뜨리기:
  ① 통과 확인: 단위 단건("현재와 같은 값으로 바꾸면 이용 중이어도 가드에 걸리지 않는다") 통과
  ② 조건 깨뜨리기: 동작 5 구현의 "현재 `type`과 다를 때" 비교를 잠시 지워(값이 있기만 하면 가드) 단건이 `SeatAlreadyOccupiedError`로 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 단건과 `src/seat/` 전체 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-22): ① 통과 → ② 비교 제거 시 `SeatAlreadyOccupiedError`로 실패 → ③ 원복 후 단건 통과, `src/seat/` 14개 통과

#### 동작 7. 이용 중인 좌석의 상태 변경은 409 (QS-27a)

- [x] T031 [US1] 실패 확인:
  ⓪ 기대값 변경(2026-10-22 사용자 확인, 헌법 III·VI): `src/seat/seat.service.spec.ts`의
     「이용 중인 좌석의 상태를 바꾸면 DomainConflictError(409)를 던진다」를
     「이용 중인 좌석의 상태를 바꾸면 SeatAlreadyOccupiedError(409)를 던진다」로 바꾸고 `toBeInstanceOf(SeatAlreadyOccupiedError)`로 검증한다.
     E2E(QS-27a)의 첫 `PATCH`에 `error.code = SeatAlreadyOccupiedError` 검증을 추가한다
  ① E2E 실패 확인: E2E 단건(QS-27a). 기대 사유: 첫 `PATCH`(`status = UNAVAILABLE`)가 409가 아니라 200
  ② 단위 실패 확인: 단위 단건("이용 중인 좌석의 상태를 바꾸면 SeatAlreadyOccupiedError(409)를 던진다"). 기대 사유: 예외 없이 resolve됨
  - 실제 실패(2026-10-22): ⓪ 변경 반영. E2E(QS-27a) `expected 409 "Conflict", got 200 "OK"` / 단위 `Received promise resolved instead of rejected`. 둘 다 기대 사유와 같음
- [x] T032 [US1] 구현 + 통과 확인:
  ① 구현: `src/seat/seat.service.ts`의 이용 중 가드 조건에 "`dto.status`가 있고 현재 `status`와 다름"을 추가한다 (research R8)
  ② 단위 통과 확인: 단위 단건 통과, `src/seat/` 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-27a) 통과
  - 결과(2026-10-22): 단위 단건 통과, `src/seat/` 19개 중 15개 통과(회귀 없음), E2E(QS-27a) 통과

#### 동작 8. 유효 지정이 없는 고정석은 자유석으로 바꿀 수 있다 (지정 확인을 거친다)

- [x] T033 [US1] 실패 확인:
  ① 실패 확인: 단위 단건("유효 지정이 없는 고정석은 자유석으로 바꿀 수 있다"). 기대 사유: `seatAssignmentService.findValidBySeat`가 호출되지 않음
  - 실제 실패(2026-10-22): `findValidBySeat` 기대 호출 `("seat-1", Any<Date>, {})`, 실제 호출 0회. 기대 사유와 같음
- [x] T034 [US1] 구현 + 통과 확인:
  ① 구현: `src/seat/seat.service.ts` 생성자에 `SeatAssignmentService`를 주입하고 `src/seat/seat.module.ts`에서 `SeatAssignmentModule`을 import한다.
     현재 `type = FIXED`이고 (`type`을 `FREE`로 바꾸거나 `status`를 `UNAVAILABLE`로 바꾸는) 경우 `findValidBySeat(seatId, new Date(), tx)`를 호출한다.
     결과에 따른 거부는 동작 9·10에서 넣는다
  ② 통과 확인: 단위 단건 통과, `src/seat/` 전체 회귀 없음
  ③ 주입 확인: `npm run test:e2e -- --testPathPatterns=seat-type`로 의존성 주입 오류 없이 QS-1·QS-26·QS-27a가 계속 통과하는지 확인한다
  - 결과(2026-10-22): 단건 통과, `src/seat/` 19개 중 16개 통과(회귀 없음). E2E 주입 오류 없음, QS-1·26·27a 통과(QS-2·23·27은 이후 사이클 대상)

#### 동작 9. 유효 지정이 있는 고정석을 자유석으로 바꾸면 409 (QS-23)

- [x] T035 [US1] 실패 확인:
  ⓪ 기대값 변경(2026-10-22 사용자 확인, 헌법 III·VI): `src/seat/seat.service.spec.ts`의
     「유효 지정이 있는 고정석을 자유석으로 바꾸면 DomainConflictError(409)를 던진다」를
     「유효 지정이 있는 고정석을 자유석으로 바꾸면 SeatHasAssignmentError(409)를 던진다」로 바꾸고 `toBeInstanceOf(SeatHasAssignmentError)`로 검증한다.
     E2E(QS-23)에 `error.code = SeatHasAssignmentError` 검증을 추가한다. 에러 파일이 없어 `Cannot find module`이면
     `src/seat/errors/seat-has-assignment.error.ts`에 빈 클래스(`DomainConflictError` 상속, `name = 'SeatHasAssignmentError'`)를 두고 다시 확인한다
  ① E2E 실패 확인: E2E 단건(QS-23). 기대 사유: 409가 아니라 200
  ② 단위 실패 확인: 단위 단건("유효 지정이 있는 고정석을 자유석으로 바꾸면 SeatHasAssignmentError(409)를 던진다"). 기대 사유: 예외 없이 resolve되고 `updateSeat`가 호출됨
  - 실제 실패(2026-10-22): ⓪ 변경 반영. E2E(QS-23) `expected 409 "Conflict", got 200 "OK"` / 단위 1차 `Cannot find module './errors/seat-has-assignment.error'` → 클래스를 두고 2차 `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T036 [US1] 구현 + 통과 확인:
  ① 구현: `src/seat/seat.service.ts`에서 `type`을 `FREE`로 바꾸는 경우 `findValidBySeat`가 행을 반환하면
     `SeatHasAssignmentError`(안내 문구 '유효한 지정이 있는 고정석은 자유석으로 바꿀 수 없습니다'). `UNAVAILABLE` 조건은 동작 10에서 넣는다
  ② 단위 통과 확인: 단위 단건 통과, `src/seat/` 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-23) 통과
  - 결과(2026-10-22): 단위 단건 통과, `src/seat/` 19개 중 17개 통과(회귀 없음), E2E(QS-23) 통과

#### 동작 10. 유효 지정이 있는 고정석을 이용 불가로 바꾸면 409 (QS-27)

- [x] T037 [US1] 실패 확인:
  ⓪ 기대값 변경(2026-10-22 사용자 확인, 헌법 III·VI): `src/seat/seat.service.spec.ts`의
     「유효 지정이 있는 고정석을 이용 불가로 바꾸면 DomainConflictError(409)를 던진다」를
     「유효 지정이 있는 고정석을 이용 불가로 바꾸면 SeatHasAssignmentError(409)를 던진다」로 바꾸고 `toBeInstanceOf(SeatHasAssignmentError)`로 검증한다.
     E2E(QS-27)에 `error.code = SeatHasAssignmentError` 검증을 추가한다
  ① E2E 실패 확인: E2E 단건(QS-27). 기대 사유: 409가 아니라 200
  ② 단위 실패 확인: 단위 단건("유효 지정이 있는 고정석을 이용 불가로 바꾸면 SeatHasAssignmentError(409)를 던진다"). 기대 사유: 예외 없이 resolve됨
  - 실제 실패(2026-10-22): ⓪ 변경 반영. E2E(QS-27) `expected 409 "Conflict", got 200 "OK"` / 단위 `Received promise resolved instead of rejected`. 둘 다 기대 사유와 같음
- [x] T038 [US1] 구현 + 통과 확인:
  ① 구현: `src/seat/seat.service.ts`에서 `status`를 `UNAVAILABLE`로 바꾸는 경우에도 유효 지정이 있으면
     `SeatHasAssignmentError`(안내 문구 '유효한 이용권에 지정된 고정석은 이용 불가로 바꿀 수 없습니다. 먼저 이용권의 좌석을 변경하세요') (FR-022)
  ② 단위 통과 확인: 단위 단건 통과, `src/seat/` 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-27) 통과
  - 결과(2026-10-22): 단위 단건 통과, `src/seat/` 19개 중 18개 통과(회귀 없음), E2E(QS-27) 통과

#### 동작 11. 좌석 목록에 타입과 선택 가능 여부를 보여 준다 (QS-2)

- [x] T039 [US1] 실패 확인:
  ① E2E 실패 확인: E2E 단건(QS-2). 기대 사유: 목록 항목에 `type`·`isAssignable`이 없음
  ② 단위 실패 확인: 단위 단건("조회 결과에 좌석 타입과 선택 가능 여부를 포함한다"). 기대 사유: 결과에 `type`·`isAssignable`이 없음
  - 실제 실패(2026-10-22): E2E(QS-2) `toMatchObject` 불일치, 목록 항목에 `type`·`isAssignable` 없음 / 단위 `toEqual` 불일치, 같은 이유. 기대 사유와 같음
- [x] T040 [US1] 구현 + 통과 확인:
  ① 구현: `src/seat/dto/get-seat-out.dto.ts`에 `type: SeatType`, `isAssignable: boolean`(`@ApiProperty` 한글 설명, 자유석은 항상 false)을 추가하고,
     `src/seat/seat.service.ts`의 `getSeat`에서 `seatAssignmentService.getAssignableMap(좌석 ID 목록, new Date())`로 계산한다(조회 시점 판정, research R3)
  ② 단위 통과 확인: 단위 단건 통과, `src/seat/` 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-2) 통과
  - 결과(2026-10-22): 단위 단건 통과, `src/seat/` 19개 모두 통과, E2E `seat-type` 6개 모두 통과

#### US1 마무리

- [x] T041 [US1] `npm run test -- --testPathPatterns="src/seat/|seat-assignment"`, `npm run test:e2e -- --testPathPatterns=seat-type`, `npx eslint src/seat`, `npm run build`를 실행해 모두 통과하는지 확인한다. 기대값은 바꾸지 않는다
  - 결과(2026-10-22): 단위 4개 파일 54개 통과, E2E `seat-type` 6개 통과, `npx eslint src/seat` 통과(기존 미사용 import `Get`·`Seat` 정리), `npm run build` 성공.
    체크포인트 확인: 기존 데이터는 seats 6·products 6·tickets 24건 모두 `FREE`.
    참고: `test/seat-type.e2e-spec.ts:274`(T017 작성분)와 `test/app.e2e-spec.ts:20`에 lint 오류가 있어 T190(`npx eslint .`)에서 처리가 필요하다

**체크포인트**: US1 단독으로 동작·검증 가능(MVP).

---

## Phase 4: 사용자 스토리 2 — 이용자가 최초 구매 시 좌석 타입을 선택한다 (우선순위: P2)

**목표**: 상품에 좌석 타입을 지정하고(등록·수정), 고정석 상품은 주문 시 좌석을 선점·결제 시 확정하며, 취소·실패 시 해제한다.

**독립 테스트**: 고정석 시간권 상품 주문(좌석 지정) → 결제 성공 → 이용권 조회 시 `FIXED` + 지정 좌석.

**새 테스트 파일**: `src/product/product.service.spec.ts`, `src/product/dto/update-product.dto.spec.ts`, `src/order/order.service.spec.ts`,
`src/order/dto/create-order.dto.spec.ts`, `src/payment/payment.service.spec.ts`, `src/refund/refund.service.spec.ts`, `src/ticket/ticket.service.spec.ts`.
파일의 첫 테스트를 작성하는 task에서 테스트 대상 생성과 의존성 목(mock) 준비(`beforeEach`)를 함께 만든다(`src/seat/seat.service.spec.ts` 형식).
E2E에 필요한 준비 함수(상품 등록, 주문, 결제 요청·콜백)는 그 함수를 처음 쓰는 E2E 작성 단계에서 `test/seat-type.e2e-spec.ts`에 추가한다.
결제 콜백 호출 방식은 `test/ticket-pause.e2e-spec.ts`의 결제 준비 방식을 따른다.

### 상품 등록

#### 동작 1. 시간권 상품 등록 시 좌석 타입을 저장하고 목록에 보여 준다 (QS-3)

단위 테스트 없이 E2E로만 검증한다(2026-10-22 사용자 결정 A안). 서비스는 받은 데이터를 그대로 Repository에 넘기고
`seatType`이 빠지는 지점은 Repository의 Prisma `create` 매핑이라, Repository를 목으로 바꾼 서비스 단위 테스트로는 검증할 수 없다.
DB 매핑은 실제 DB를 쓰는 E2E로 검증한다.

- [x] T042 [US2] 작성 + 실패 확인:
  ① E2E 작성: `test/seat-type.e2e-spec.ts`에 `describe('사용자 스토리 2')`를 만들고
     `it('고정석 시간권 상품을 등록하면 목록에 고정석으로 조회된다 (QS-3)')`를 작성한다. 준비 함수 `createProduct(seatType, ticketType)` 추가
  ② E2E 실패 확인: E2E 단건(QS-3). 기대 사유: 목록 항목에 `seatType`이 없거나 `FREE`.
     `seatType`이 whitelist로 거부(400)되면 `src/product/dto/create-product.dto.ts`에 `seatType` 필드만 두고(저장 경로 미연결) 다시 확인한다
  - 실제 실패(2026-10-22): 1차 whitelist 400 → DTO에 `seatType` 필드만 두고 2차 `Expected "FIXED", Received undefined`. 기대 사유와 같음.
    처음 작성한 서비스 단위 테스트는 구현 전부터 통과해(검증 불가 구조) A안 결정에 따라 삭제했다
- [x] T043 [US2] 구현 + 통과 확인:
  ① 구현: `src/product/product.type.ts`의 상품 데이터 타입에 `seatType`, `src/product/product.controller.ts`의 **시간권 분기**에서 `seatType` 전달,
     `src/product/product.repository.ts`의 `create` 매핑과 목록 `select`에 `seatType`, `src/product/dto/get-product-out.dto.ts`에 `seatType` 추가 (FR-005).
     상품 데이터 타입이 시간권·기간권 공용(`BaseProductData`)이라 기간권 분기에도 `seatType`을 넣어야 컴파일된다. 그래서 기간권 분기도 함께 넣고,
     동작 2는 조건 깨뜨리기로 검증한다(2026-10-22 구현 중 확인)
  ② E2E 통과 확인: E2E 단건(QS-3) 통과, `src/product/` 단위 전체 회귀 없음
  - 결과(2026-10-22): E2E(QS-3) 통과. `src/product/`에는 아직 단위 테스트가 없음(회귀 대상 없음). `tsc --noEmit` 오류 없음(기존 `test/app.e2e-spec.ts:20` 제외)

#### 동작 2. 기간권 상품 등록 시 좌석 타입을 저장한다 (QS-3a) — 동작 1 구현으로 함께 통과

- [x] T044 [US2] 작성 + 조건 깨뜨리기:
  ① E2E 작성: `it('고정석 기간권 상품을 등록하면 목록에 고정석으로 조회된다 (QS-3a)')`
  ② 조건 깨뜨리기: E2E 단건(QS-3a) 통과를 확인한 뒤 `src/product/product.controller.ts` 기간권 분기의 `seatType` 전달을 잠시 지워
     목록에 `FREE`가 조회되어 실패하는지 확인한다(타입 오류는 jest `isolatedModules`로 실행에는 영향 없음)
  ③ 원복 후 통과 확인: 원복하고 E2E 단건(QS-3a)·(QS-3) 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-22): ① 통과 → ② 기간권 분기 `seatType` 제거 시 `Expected "FIXED", Received "FREE"`로 실패 → ③ 원복 후 QS-3a·QS-3 통과

### 상품 수정 (research R8)

#### 동작 3. 상품 수정 DTO는 좌석 타입을 FIXED·FREE만 허용한다

- [x] T046 [US2] 작성 + 실패 확인:
  ① 작성: `src/product/dto/update-product.dto.spec.ts`(신규)에 `it('좌석 타입이 고정석·자유석 이외면 isEnum 오류다')`.
     `validate(..., { whitelist: true, forbidNonWhitelisted: true })`로 검증하고 `seatType` 오류의 `constraints`에 `isEnum`이 있는지 확인한다
  ② 실패 확인: 단위 단건. 파일이 없어 `Cannot find module`이면 빈 클래스 `export class UpdateProductDto {}`를 두고 다시 확인한다.
     기대 사유: `constraints`가 `isEnum`이 아니라 `whitelistValidation`
  - 실제 실패(2026-10-22): 1차 `Cannot find module` → 빈 클래스를 두고 2차 `seatType` 오류 항목 자체가 없음(`constraints` undefined).
    빈 클래스에는 검증 메타데이터가 없어 속성별 whitelist 오류가 생기지 않는다. 기대 문구와는 다르지만 "`seatType`에 enum 검증이 없다"는 노리는 사유와 같다
- [x] T047 [US2] 구현 + 통과 확인:
  ① 구현: `src/product/dto/update-product.dto.ts`를 `PartialType(OmitType(CreateProductDto, ['type'] as const))`(`@nestjs/swagger`)로 정의한다.
     이용권 종류(`type`)는 받지 않고 나머지(`name`, `amount`, `usableDays`, `isActive`, `purchasedMinutes`, `purchasedDurationDays`, `seatType`)는 모두 선택 입력
  ② 통과 확인: 단위 단건 통과
  - 결과(2026-10-22): 단건 통과. `src/product/dto/index.ts`에서 export

#### 동작 4. 상품 수정 DTO는 모든 필드가 선택 입력이다 — 동작 3 구현으로 함께 통과

- [x] T048 [US2] 작성 + 조건 깨뜨리기:
  ① 작성: `src/product/dto/update-product.dto.spec.ts`에 `it('좌석 타입만 보내도 오류가 없다')`
  ② 조건 깨뜨리기: 단건 통과를 확인한 뒤 `PartialType`을 잠시 지워(`OmitType`만) 필수 필드 누락 오류로 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 파일 전체 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-22): ① 통과 → ② `PartialType` 제거 시 필수 필드 누락 오류로 실패 → ③ 원복 후 파일 3개 통과

#### 동작 5. 상품 수정 DTO는 이용권 종류(type)를 받지 않는다 — 동작 3 구현으로 함께 통과

- [x] T049 [US2] 작성 + 조건 깨뜨리기:
  ① 작성: `src/product/dto/update-product.dto.spec.ts`에 `it('이용권 종류(type)를 보내면 whitelist 오류다')`
  ② 조건 깨뜨리기: 단건 통과를 확인한 뒤 `OmitType`을 잠시 지워(`PartialType(CreateProductDto)`) 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 파일 전체 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-22): ① 통과 → ② `OmitType` 제거 시 `type` whitelist 오류가 없어져 실패 → ③ 원복 후 파일 3개 통과

#### 동작 6. 상품을 수정하면 바뀐 필드마다 변경 이력을 남긴다 (QS-28)

- [x] T050 [US2] 작성 + 실패 확인:
  ① E2E 작성: `it('상품의 좌석 타입과 금액을 수정하면 반영되고 바뀐 필드마다 이력이 남는다 (QS-28)')`.
     `PATCH /shops/:shopId/products/:productId`로 `seatType`·`amount` 수정 → 목록 조회로 반영 확인 → `prisma.productHistory`에서 같은 `changeGroupId`의 2행 확인
  ② E2E 실패 확인: E2E 단건(QS-28). 라우트가 없어 404이면 빈 구현을 둔다: `src/product/product.controller.ts`에 `@Patch(':productId')` +
     `@Roles(Role.OWNER, Role.MANAGER)` + `ParseUUIDPipe` + `@CurrentUser('userId')`로 `productService.updateProduct(shopId, productId, dto, userId)`를 호출하고,
     서비스 메서드는 비워 둔다. 기대 사유: 값이 바뀌지 않고 이력 0행
  ③ 단위 작성: `src/product/product.service.spec.ts`에 `it('상품 수정 시 바뀐 필드마다 같은 변경 묶음 ID로 이력을 만든다')`.
     기존 값과 같은 필드는 이력에서 빠지는지, 이력 행의 `oldValue`·`newValue`가 문자열인지 검증
  ④ 단위 실패 확인: 단위 단건. 기대 사유: `repository.updateProductWithHistories`가 호출되지 않음(목에 메서드를 두고 확인)
  - 실제 실패(2026-10-22): E2E 1차 404(라우트 없음) → 빈 라우트·서비스를 두고 2차 400 `property productId should not exist`
    (`@Param() ProductParamDto`가 경로 파라미터 전체를 whitelist로 검증) → 라우트를 `@Param('shopId'/'productId', ParseUUIDPipe)`로 고치고 3차
    `amount 10000·seatType FREE`로 값이 바뀌지 않음(기대 사유와 같음) / 단위 `updateProductWithHistories` 호출 0회(기대 사유와 같음)
- [x] T051 [US2] 구현 + 통과 확인:
  ① 구현: `src/product/product.repository.ts`에 `findProductForUpdate(shopId, productId)`(`deletedAt = null` 조건)와
     `updateProductWithHistories(productId, data, histories)`(같은 트랜잭션에서 상품 갱신과 `ProductHistory` 다건 저장만, 비교 로직 없음, 헌법 원칙 I)를 추가한다.
     `src/product/product.service.ts`의 `updateProduct`는 기존 값과 비교해 바뀐 필드 목록과 이력 행 데이터(`changeGroupId = randomUUID()`, `changedBy = userId`)를 만든다
  ② 단위 통과 확인: 단위 단건 통과, `src/product/` 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-28) 통과
  - 결과(2026-10-22): 단위 통과, `src/product/` 4개 통과(회귀 없음), E2E(QS-28) 통과

#### 동작 7. 시간권 상품에 기간 필드를 보내면 400

- [x] T052 [US2] 작성 + 실패 확인:
  ① 작성: `src/product/product.service.spec.ts`에 `it('시간권 상품에 이용 기간(purchasedDurationDays)을 보내면 ProductFieldMismatchError다')`
  ② 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/product/errors/product-field-mismatch.error.ts`에 빈 클래스(`DomainBadRequestError` 상속, `name = 'ProductFieldMismatchError'`)를 두고 다시 확인한다. 기대 사유: 예외 없이 resolve됨
  - 실제 실패(2026-10-22): 1차 `Cannot find module './errors/product-field-mismatch.error'` → 클래스를 두고 2차 `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T053 [US2] 구현 + 통과 확인:
  ① 구현: `updateProduct`에서 현재 상품이 시간권이고 `dto.purchasedDurationDays`가 있으면 `ProductFieldMismatchError`
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과, `src/product/` 5개 통과(회귀 없음)

#### 동작 8. 기간권 상품에 시간 필드를 보내면 400

- [x] T054 [US2] 작성 + 실패 확인:
  ① 작성: `src/product/product.service.spec.ts`에 `it('기간권 상품에 이용 시간(purchasedMinutes)을 보내면 ProductFieldMismatchError다')`
  ② 실패 확인: 단위 단건. 기대 사유: 예외 없이 resolve됨
  - 실제 실패(2026-10-22): `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T055 [US2] 구현 + 통과 확인:
  ① 구현: `updateProduct`에서 현재 상품이 기간권이고 `dto.purchasedMinutes`가 있으면 `ProductFieldMismatchError`
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과, `src/product/` 6개 통과(회귀 없음)

#### 구조 정리: `ProductNotFoundError`를 product 모듈로 옮긴다 (동작 변경 없음)

- [x] T055a [US2] 구조 정리 + 회귀 확인:
  ① 구조 정리: `src/order/errors/product-not-found.error.ts`를 `src/product/errors/product-not-found.error.ts`로 옮기고
     `src/order/order.repository.ts`의 import를 바꾼다. 클래스 내용은 바꾸지 않는다
  ② 회귀 확인: `npm run test -- --testPathPatterns="src/order/|src/product/"`, `npm run test:e2e`가 옮기기 전과 같은 결과인지 확인한다
  - 결과(2026-10-22): `git mv`로 이동, `order.repository.ts` import 변경. 단위 6개 통과(전후 같음).
    E2E 이동 전 20개 중 18개 통과(`app.e2e` `request is not a function` — 기존 문제, `ticket-pause` 「인증 없이 요청하면 401 반환」 404 — 전체 실행에서만 간헐 실패, 단독 실행 시 통과) /
    이동 후 20개 중 19개 통과(`app.e2e`만 실패). 이동으로 생긴 회귀 없음. `ticket-pause` 간헐 실패는 이 기능과 무관한 기존 문제로 T187에서 다시 확인한다

#### 동작 9. 삭제됐거나 다른 매장 상품을 수정하면 404

- [x] T056 [US2] 작성 + 실패 확인:
  ① 작성: `src/product/product.service.spec.ts`에 `it('삭제됐거나 다른 매장 상품이면 ProductNotFoundError다')`(`findProductForUpdate`가 `null` 반환)
  ② 실패 확인: 단위 단건. 기대 사유: `ProductNotFoundError`가 아닌 `TypeError`(null 속성 접근) 또는 resolve
  - 실제 실패(2026-10-22): `Received constructor: TypeError`(null 속성 접근). 기대 사유와 같음
- [x] T057 [US2] 구현 + 통과 확인:
  ① 구현: `updateProduct`에서 조회 결과가 `null`이면 `ProductNotFoundError('상품을 찾을 수 없습니다')`(T055a로 옮긴 `src/product/errors/product-not-found.error.ts`)
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과, `src/product/` 7개 통과(회귀 없음). 임시 non-null 단언(`product!`) 제거

#### 동작 10. 상품 수정 API로 이용권 종류를 바꾸려 하면 400 (QS-29) — 동작 5로 이미 통과

- [x] T058 [US2] 작성 + 조건 깨뜨리기:
  ① E2E 작성: `it('상품 수정에서 이용권 종류를 보내면 400 (QS-29)')`
  ② 조건 깨뜨리기: E2E 단건(QS-29) 통과를 확인한 뒤 `UpdateProductDto`의 `OmitType`을 잠시 지워 400이 아니게 되는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 E2E 단건(QS-29)과 `src/product/` 단위 전체 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-22): ① E2E(QS-29) 통과 → ② `OmitType`을 지워도 400으로 **실패하지 않음**. `type`이 허용되면 `CreateProductDto`의
    `@ValidateIf(type === PERIOD) @IsNotEmpty` 때문에 "기간권인데 이용 기간 없음"이라는 다른 사유로 400이 난다 → 멈추고 사용자 확인.
    사용자 결정(A안): QS-29 E2E는 "엔드포인트가 400으로 거부한다"까지만 보장하고, 거부 사유(`type` whitelist)는 조건 깨뜨리기를 통과한
    단위 테스트 T049로 보장한다. 테스트는 고치지 않았다. ③ 원복 후 QS-29 통과, `src/product/` 7개 통과
  - 알려진 한계(2026-10-22 사용자 결정, 헌법 IV): `UpdateProductDto`는 `type`이 없어 `purchasedMinutes`·`purchasedDurationDays`의
    `@ValidateIf` 조건이 항상 거짓이므로 범위 검증(`@Min`·`@Max`)이 동작하지 않는다. 이번 범위에서는 보완하지 않는다

### 주문

#### 구조 정리: 주문 생성 로직을 Service로 옮긴다 (동작 변경 없음)

- [x] T059 [US2] 구조 정리 + 회귀 확인:
  ① 구조 정리(헌법 원칙 I): `src/order/order.repository.ts`의 `createOrder`에 있는 상품 조회·검증·금액 계산을 `src/order/order.service.ts`로 옮긴다.
     Service가 `PrismaService.executeTransaction`으로 트랜잭션을 열고, Repository는 `findActiveProducts(productIds, tx)`, `createOrderWithItems(data, tx)`
     쿼리 메서드만 갖는다(이 메서드만 대상, 다른 기존 Repository는 건드리지 않는다). 동작은 바꾸지 않는다
  ② 회귀 확인: `npm run test:e2e`(주문을 쓰는 기존 E2E 포함)가 구조 정리 전과 같은 결과인지 확인한다
  - 결과(2026-10-22): Repository는 `findActiveProducts`·`createOrderWithItems`만 남기고 상품 검증·금액 계산을 `OrderService.createOrder`로 옮겼다
    (`PrismaService.executeTransaction` 사용, 저장 데이터 타입 `CreateOrderWithItemsData`는 `order.types.ts`). `tsc` 오류 없음.
    E2E 전후 같은 결과(21개 중 20개 통과, 기존 `app.e2e`만 실패). **주의**: 기존 E2E 중 `POST /orders`를 호출하는 테스트가 없어
    이 회귀 확인은 주문 생성 경로를 검증하지 못한다. 첫 검증은 QS-4(T062)·QS-6(T096)·QS-10(T116)에서 이뤄진다.
    참고: 옮긴 금액 계산 코드(`originalAmount`에 `amount`를 더하고, `totalAmount`에서 할인을 한 번 더 빼는 부분)는 할인 0원인 지금은 결과가 같지만
    할인이 생기면 값이 틀어진다. 동작을 바꾸지 않는 구조 정리라 그대로 두었다

#### 동작 11. 주문 항목의 좌석 ID는 UUID여야 한다

- [x] T060 [US2] 작성 + 실패 확인:
  ① 작성: `src/order/dto/create-order.dto.spec.ts`(신규)에 `it('주문 항목의 좌석 ID가 UUID가 아니면 오류다')`(`orderedProducts[0].seatId = 'abc'`, 중첩 오류 `isUuid` 확인)
  ② 실패 확인: 단위 단건. 기대 사유: 중첩 검증이 없어 오류가 없음
  - 실제 실패(2026-10-22): `seatId` 중첩 오류의 `constraints`가 undefined(중첩 검증 없음). 기대 사유와 같음
- [x] T061 [US2] 구현 + 통과 확인:
  ① 구현: `src/order/dto/create-order.dto.ts`의 항목을 `OrderedProductDto`로 분리한다: `productId`(`@IsUUID('4')`), `quantity`(`@IsInt() @Min(1)`),
     `seatId?`(`@IsOptional() @IsUUID('4')`). `orderedProducts`에 `@ValidateNested({ each: true }) @Type(() => OrderedProductDto)`. 한글 `@ApiProperty`
  ② 통과 확인: 단위 단건 통과
  - 결과(2026-10-22): 단건 통과, `tsc` 오류 없음

#### 동작 12. 고정석 상품을 좌석 없이 주문하면 400 (QS-4)

- [x] T062 [US2] 작성 + 실패 확인:
  ① E2E 작성: `it('고정석 상품을 좌석 없이 주문하면 400 (QS-4)')`. 상태 코드와 `error.code = SeatSelectionRequiredError`를 검증한다. 준비 함수 `createOrder(userToken, items)` 추가
  ② E2E 실패 확인: E2E 단건(QS-4). 기대 사유: 400이 아니라 201
  ③ 단위 작성: `src/order/order.service.spec.ts`(신규)에 `it('고정석 상품 줄에 좌석이 없으면 SeatSelectionRequiredError다')`.
     목: `OrderRepository`(`findActiveProducts`, `createOrderWithItems`), `PrismaService.executeTransaction`, `SeatAssignmentService.hold`, `ConfigService`
  ④ 단위 실패 확인: 단위 단건. 기대 사유: 예외 없이 주문이 저장됨(`createOrderWithItems` 호출)
  - 실제 실패(2026-10-22): E2E(QS-4) `expected 400, got 201`(T059 구조 정리 후 주문 생성 경로가 동작함을 처음 확인) / 단위 `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T063 [US2] 구현 + 통과 확인:
  ① 구현: `src/order/order.service.ts`의 `createOrder`에서 상품 `seatType = FIXED`인 줄에 `seatId`가 없으면 `SeatSelectionRequiredError`.
     `OrderModule`에서 `SeatAssignmentModule` import (FR-007)
  ② 단위 통과 확인: 단위 단건 통과, `src/order/` 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-4) 통과
  - 결과(2026-10-22): 단위 통과, `src/order/` 2개 통과, E2E(QS-4) 통과(`error.code = SeatSelectionRequiredError`). 생성자에 `SeatAssignmentService`·`ConfigService` 주입(동작 18에서 사용)

#### 동작 13. 고정석 상품 줄의 수량이 1이 아니면 400

- [x] T064 [US2] 작성 + 실패 확인:
  ① 작성: `src/order/order.service.spec.ts`에 `it('고정석 상품 줄의 수량이 1이 아니면 FixedSeatQuantityError다')`
  ② 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/order/errors/fixed-seat-quantity.error.ts`에 빈 클래스(`DomainBadRequestError` 상속, `name = 'FixedSeatQuantityError'`)를 두고 다시 확인한다. 기대 사유: 예외 없이 주문이 저장됨
  - 실제 실패(2026-10-22): 1차 `Cannot find module` → 클래스를 두고 2차 `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T065 [US2] 구현 + 통과 확인:
  ① 구현: 고정석 줄의 `quantity !== 1`이면 `FixedSeatQuantityError`(안내 문구 '고정석 상품은 좌석 하나에 한 개씩 주문합니다')
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과. 진행 순서 메모: T066 테스트를 T065 통과 확인 전에 추가해 파일 전체가 `Cannot find module`로 실행되지 않았고, `SeatNotAllowedError` 클래스를 먼저 둔 뒤 T065 통과(`src/order/` 3개 통과)·T066 실패를 각각 확인했다

#### 동작 14. 자유석 상품 줄에 좌석을 보내면 400

- [x] T066 [US2] 작성 + 실패 확인:
  ① 작성: `src/order/order.service.spec.ts`에 `it('자유석 상품 줄에 좌석이 있으면 SeatNotAllowedError다')`
  ② 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/order/errors/seat-not-allowed.error.ts`에 빈 클래스(`DomainBadRequestError` 상속, `name = 'SeatNotAllowedError'`)를 두고 다시 확인한다. 기대 사유: 예외 없이 주문이 저장됨
  - 실제 실패(2026-10-22): `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T067 [US2] 구현 + 통과 확인:
  ① 구현: 자유석 줄에 `seatId`가 있으면 `SeatNotAllowedError`
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과, `src/order/` 4개 통과(회귀 없음)

#### 동작 15. 고정석 상품을 자유석 좌석으로 주문하면 400 (QS-5)

- [x] T068 [US2] 작성 + 실패 확인:
  ① E2E 작성: `it('고정석 상품을 자유석 좌석으로 주문하면 400 (QS-5)')`. 상태 코드와 `error.code = SeatTypeMismatchError`를 검증한다
  ② E2E 실패 확인: E2E 단건(QS-5). 기대 사유: 400이 아니라 201
  ③ 단위 작성: `src/order/order.service.spec.ts`에 `it('고정석 상품 줄의 좌석이 자유석이면 SeatTypeMismatchError다')`
  ④ 단위 실패 확인: 단위 단건. 기대 사유: 예외 없이 주문이 저장됨
  - 실제 실패(2026-10-22): E2E(QS-5) `expected 400, got 201` / 단위 `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T069 [US2] 구현 + 통과 확인:
  ① 구현: 고정석 줄의 좌석을 조회(`OrderRepository.findSeats(seatIds, tx)` 추가)해 `type = FREE`이면 `SeatTypeMismatchError`
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-5) 통과
  - 결과(2026-10-22): `OrderRepository.findSeats` 추가, 단위 통과, `src/order/` 5개 통과(회귀 없음), E2E(QS-5) 통과

#### 동작 16. 고정석 상품을 다른 매장 좌석으로 주문하면 400

- [x] T070 [US2] 작성 + 실패 확인:
  ① 작성: `src/order/order.service.spec.ts`에 `it('고정석 상품 줄의 좌석이 다른 매장 좌석이면 SeatShopMismatchError다')`
  ② 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/seat-assignment/errors/seat-shop-mismatch.error.ts`에 빈 클래스(`DomainBadRequestError` 상속, `name = 'SeatShopMismatchError'`)를 두고 다시 확인한다. 기대 사유: 예외 없이 주문이 저장됨
  - 실제 실패(2026-10-22): 에러 클래스를 먼저 두고 실행, `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T071 [US2] 구현 + 통과 확인:
  ① 구현: 좌석의 `shopId`가 주문의 `shopId`와 다르면(조회되지 않는 경우 포함) `SeatShopMismatchError`. 이용권 좌석 변경(US4 동작 14)도 같은 에러를 쓰므로 `src/seat-assignment/errors/index.ts`에서 export한다
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과, `src/order/` 6개 통과(회귀 없음). 매장 검사는 타입 검사보다 먼저 한다. `src/seat-assignment/errors/index.ts`에서 export

#### 동작 17. 한 주문에서 같은 좌석을 두 번 고르면 409

- [x] T072 [US2] 작성 + 실패 확인:
  ① 작성: `src/order/order.service.spec.ts`에 `it('같은 주문 안에서 같은 좌석을 중복 선택하면 DuplicateSeatInOrderError다')`
  ② 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/order/errors/duplicate-seat-in-order.error.ts`에 빈 클래스(`DomainConflictError` 상속, `name = 'DuplicateSeatInOrderError'`)를 두고 다시 확인한다. 기대 사유: 예외 없이 주문이 저장됨
  - 실제 실패(2026-10-22): 에러 클래스를 먼저 두고 실행, `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T073 [US2] 구현 + 통과 확인:
  ① 구현: 고정석 줄의 `seatId` 중복이 있으면 `DuplicateSeatInOrderError`
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과, `src/order/` 7개 통과(회귀 없음)

#### 동작 18. 고정석 줄마다 좌석을 선점(HELD)한다

- [x] T074 [US2] 작성 + 실패 확인:
  ① 작성: `src/order/order.service.spec.ts`에 `it('고정석 줄마다 선점 유효시간만큼 좌석을 선점한다')`.
     `hold`가 `(seatId, orderItemId, heldUntil = now + SEAT_HOLD_MINUTES분, tx)`로 호출되는지 검증(시각은 `jest.useFakeTimers().setSystemTime`)
  ② 실패 확인: 단위 단건. 기대 사유: `hold`가 호출되지 않음
  - 실제 실패(2026-10-22): `hold` 기대 호출 1회, 실제 0회. 기대 사유와 같음. 테스트는 계획의 인자 형태 대신 실제 시그니처 `hold({ seatId, shopId, orderItemId, heldUntil }, now, tx)`로 검증한다
- [x] T075 [US2] 구현 + 통과 확인:
  ① 구현: 주문 저장 후 같은 `tx`에서 고정석 주문 항목마다 `SeatAssignmentService.hold` 호출. 선점 유효시간은 `ConfigService`의 `seat.holdMinutes` (research R2·R4)
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과, `src/order/` 8개 통과(회귀 없음), `tsc` 오류 없음.
    중첩 생성(`orderItems: { create }`)은 만든 항목과 입력 좌석의 대응을 보장하지 않으므로 주문 항목 ID를 서비스에서 `randomUUID()`로 미리 만들어
    `CreateOrderItemData.id`로 넘기고, 같은 ID로 `hold`를 호출한다

#### 동작 19. 주문 항목에 좌석 타입을 스냅샷으로 저장한다

- [x] T076 [US2] 작성 + 실패 확인:
  ① 작성: `src/order/order.service.spec.ts`에 `it('주문 항목에 구매 시점 상품의 좌석 타입을 저장한다')`
  ② 실패 확인: 단위 단건. 기대 사유: `createOrderWithItems` 데이터의 항목에 `seatType`이 없음
  - 실제 실패(2026-10-22): `toEqual` 불일치, 항목의 `seatType`이 undefined. 기대 사유와 같음
- [x] T077 [US2] 구현 + 통과 확인:
  ① 구현: 주문 항목 데이터에 상품의 `seatType`을 복사한다
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과, `src/order/` 9개 통과(회귀 없음)

#### 동작 20. 이미 지정된 좌석으로 주문하면 409 (QS-7) — 동작 18과 기반 단계로 이미 통과

- [x] T078 [US2] 작성 + 조건 깨뜨리기:
  ① E2E 작성: `it('이미 지정된 좌석으로 다른 이용자가 주문하면 409 (QS-7)')`. 상태 코드와 `error.code = SeatNotAssignableError`를 검증한다
  ② 조건 깨뜨리기: E2E 단건(QS-7) 통과를 확인한 뒤 `createOrder`의 `hold` 호출을 잠시 지워 201로 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 E2E 단건(QS-7) 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-22): ① QS-7 통과 → ② `hold` 호출 제거 시 `expected 409, got 201`로 실패 → ③ 원복 후 통과

#### 동작 21. 같은 좌석 동시 주문은 한 건만 성공한다 (QS-8) — 기반 단계의 잠금·인덱스로 이미 통과

- [x] T079 [US2] 작성 + 조건 깨뜨리기:
  ① E2E 작성: `it('같은 좌석으로 두 주문을 동시에 만들면 한 건만 성공한다 (QS-8)')`. `Promise.all`로 동시 요청 → 상태 코드 `[201, 409]`(순서 무관), 409 응답의 `error.code = SeatNotAssignableError`
  ② 조건 깨뜨리기: E2E 단건(QS-8) 통과를 확인한 뒤 `createOrder`의 `hold` 호출을 잠시 지워 두 건 모두 201로 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 E2E 단건(QS-8) 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-22): ① QS-8 통과 → ② `hold` 호출 제거 시 상태 코드가 `[201, 201]`이 되어 실패 → ③ 원복 후 통과

#### 동작 22. 주문을 취소하면 선점이 즉시 풀린다 (QS-24)

- [x] T080 [US2] 작성 + 실패 확인:
  ① E2E 작성: `it('고정석 주문을 취소하면 그 좌석이 즉시 선택 가능해진다 (QS-24)')`
  ② E2E 실패 확인: E2E 단건(QS-24). 라우트가 없어 404이면 빈 구현을 둔다: `src/order/order.controller.ts`에 `@Patch(':orderId/cancel')`(`ParseUUIDPipe`)와
     빈 `OrderService.cancelOrder(orderId)`. 기대 사유: 취소 후 그 좌석 `isAssignable = false`
  ③ 단위 작성: `src/order/order.service.spec.ts`에 `it('주문을 취소하면 주문 항목의 선점을 ORDER_CANCELLED로 해제한다')`
  ④ 단위 실패 확인: 단위 단건. 기대 사유: `releaseByOrderItems`가 호출되지 않음
  - 실제 실패(2026-10-22): E2E 1차 404(라우트 없음) → 빈 라우트·서비스를 두고 2차 취소 후 `isAssignable` `Expected true, Received false` / 단위 `releaseByOrderItems` 호출 0회. 기대 사유와 같음. 준비 함수 `isSeatAssignable(seatId)` 추가
- [x] T081 [US2] 구현 + 통과 확인:
  ① 구현: `cancelOrder`가 트랜잭션에서 주문 항목 ID를 조회(`OrderRepository.findOrderWithPayments(orderId, tx)` 추가)하고
     `SeatAssignmentService.releaseByOrderItems(ids, ORDER_CANCELLED, now, tx)` 호출. 이미 해제된 경우 그대로 성공(멱등, `releaseByOrderItems`의 동작) (research R2)
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-24) 통과
  - 결과(2026-10-22): `OrderRepository.findOrderWithPayments` 추가, 단위 통과, `src/order/` 10개 통과(회귀 없음), E2E(QS-24) 통과. 주문 조회 결과의 null 처리는 동작 23에서 넣는다

#### 동작 23. 없는 주문을 취소하면 404

- [x] T082 [US2] 작성 + 실패 확인:
  ① 작성: `src/order/order.service.spec.ts`에 `it('없는 주문을 취소하면 OrderNotFoundError다')`
  ② 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/order/errors/order-not-found.error.ts`에 빈 클래스(`DomainNotFoundError` 상속, `name = 'OrderNotFoundError'`)를 두고 다시 확인한다. 기대 사유: `OrderNotFoundError`가 아닌 `TypeError` 또는 resolve
  - 실제 실패(2026-10-22): 에러 클래스를 먼저 두고 실행, `Received constructor: TypeError`(null 접근). 기대 사유와 같음
- [x] T083 [US2] 구현 + 통과 확인:
  ① 구현: 주문 조회 결과가 `null`이면 `OrderNotFoundError`
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과, 임시 non-null 단언 제거. 파일 전체 회귀는 T084 테스트를 함께 둔 상태로 확인해 T084 외 11개 통과

#### 동작 24. 결제가 성공한 주문은 취소할 수 없다

- [x] T084 [US2] 작성 + 실패 확인:
  ① 작성: `src/order/order.service.spec.ts`에 `it('결제가 성공한 주문을 취소하면 OrderAlreadyPaidError다')`
  ② 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/order/errors/order-already-paid.error.ts`에 빈 클래스(`DomainConflictError` 상속, `name = 'OrderAlreadyPaidError'`)를 두고 다시 확인한다. 기대 사유: 예외 없이 해제가 호출됨
  - 실제 실패(2026-10-22): 에러 클래스를 먼저 두고 실행, `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T085 [US2] 구현 + 통과 확인:
  ① 구현: 주문의 결제 중 `SUCCESS`가 있으면 `OrderAlreadyPaidError`(안내 문구 '결제가 완료된 주문은 환불 API를 사용하세요')
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과, `src/order/` 12개 통과(회귀 없음), `tsc` 오류 없음

#### 동작 25. 결제 없이 방치된 선점은 10분 뒤 풀린다 (QS-25) — 기반 단계의 조회 시점 판정으로 이미 통과

- [x] T086 [US2] 작성 + 조건 깨뜨리기:
  ① E2E 작성: `it('고정석 주문 후 방치되면 좌석이 선택 가능해지고 같은 좌석으로 새 주문이 성공한다 (QS-25)')`. `heldUntil`을 DB에서 과거로 바꿔 방치 상황을 만든다
  ② 조건 깨뜨리기: E2E 단건(QS-25) 통과를 확인한 뒤 `src/seat-assignment/seat-assignment.policy.ts`의 `HELD` 만료 비교를 잠시 지워(항상 유효) 실패하는지 확인한다 (research R3)
  ③ 원복 후 통과 확인: 원복하고 E2E 단건(QS-25), `npm run test -- --testPathPatterns=seat-assignment` 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-22): ① QS-25 통과 → ② `isValidAssignment`의 HELD 만료 비교를 `return true`로 바꾸자 방치 후 `isAssignable` `Expected true, Received false`로 실패 → ③ 원복 후 QS-25 통과, `seat-assignment` 35개 통과

### 환불: 시스템 자동 취소 (research R12-A)

결제 콜백(동작 33)이 쓰므로 결제보다 먼저 만든다.

#### 동작 26. 시스템 자동 취소는 소유자 검사 없이 미사용 자동 환불 경로를 탄다

- [x] T087 [US2] 작성 + 실패 확인:
  ① 작성: `src/refund/refund.service.spec.ts`(신규)에 `it('시스템 자동 취소는 소유자 검사 없이 PG 취소를 요청한다')`.
     목: `RefundRepository`, `TransactionLoggerService`, `PgService` 등 생성자 의존성. 미사용 이용권에 대해 `pgService.requestPaymentCancel`이 호출되는지 검증
  ② 실패 확인: 단위 단건. `refundBySystem is not a function`이면 빈 공개 메서드 `refundBySystem(ticketId, reason)`을 두고 다시 확인한다.
     기대 사유: `requestPaymentCancel`이 호출되지 않음
  - 실제 실패(2026-10-22): 1차 `service.refundBySystem is not a function` → 빈 메서드를 두고 2차 `requestPaymentCancel` 호출 0회. 기대 사유와 같음
- [x] T088 [US2] 구현 + 통과 확인:
  ① 구현: `src/refund/refund.service.ts`의 `refundBySystem(ticketId, reason)`이 이용권을 조회하고 기존 `processAutoRefund` 경로
     (`createRefundWithLock` → `pgService.requestPaymentCancel`)를 탄다. 기존 `refund`의 공통 검증 중 소유자 검사는 하지 않는다.
     `src/refund/refund.module.ts`에 `exports: [RefundService]`
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과, `RefundModule`에서 `RefundService` export. PG 요청의 사용자 ID는 이용권 소유자(`ticket.userId`)를 쓴다. 이용권 없음·환불 완료 검사는 동작 28에서 넣는다

#### 동작 27. 시스템 자동 취소 사유를 기록한다

- [x] T089 [US2] 작성 + 실패 확인:
  ① 작성: `src/refund/refund.service.spec.ts`에 `it('시스템 자동 취소 사유를 결제 취소 기록에 남긴다')`
  ② 실패 확인: 단위 단건. 기대 사유: `PaymentCancel` 생성 데이터에 `reason`이 없음
  - 실제 실패(2026-10-22): `createPaymentCancel` 호출 인자 불일치(사유 인자 없음). 기대 사유와 같음
- [x] T090 [US2] 구현 + 통과 확인:
  ① 구현: `createRefundWithLock`과 `src/refund/refund.repository.ts`의 `PaymentCancel` 생성에 `reason`을 전달한다(기존 `refund` 경로는 기존 값 유지)
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): `createPaymentCancel`에 마지막 선택 인자 `reason` 추가(기존 호출은 그대로), 단건 통과, `src/refund/` 2개 통과(회귀 없음)

#### 동작 28. 이미 환불된 이용권의 자동 취소는 409

- [x] T091 [US2] 작성 + 실패 확인:
  ① 작성: `src/refund/refund.service.spec.ts`에 `it('이미 환불된 이용권을 자동 취소하면 DomainConflictError다')`
  ② 실패 확인: 단위 단건. 기대 사유: 예외 없이 취소를 요청함
  - 실제 실패(2026-10-22): `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T092 [US2] 구현 + 통과 확인:
  ① 구현: `refundBySystem`에서 이용권 없음 404, `REVOKED`이면 `DomainConflictError`(기존 `refund`의 검증 순서와 같게)
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과, 임시 non-null 단언 제거. 파일 회귀는 T093 테스트를 함께 둔 상태로 확인해 T093 외 3개 통과

#### 동작 29. 사용 이력이 있는 이용권은 자동 취소하지 않는다

- [x] T093 [US2] 작성 + 실패 확인:
  ① 작성: `src/refund/refund.service.spec.ts`에 `it('사용 이력이 있는 이용권을 자동 취소하면 승인 대기로 가지 않고 예외다')`
  ② 실패 확인: 단위 단건. 기대 사유: 예외 없이 취소를 요청함
  - 실제 실패(2026-10-22): `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T094 [US2] 구현 + 통과 확인:
  ① 구현: `isUnusedTicket(ticket)`이 거짓이면 `DomainConflictError('시스템 자동 취소는 미사용 이용권만 가능합니다')`
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-22): 단건 통과, `src/refund/` 4개 통과(회귀 없음), `tsc` 오류 없음

### 결제

#### 구조 정리: 결제 승인 처리를 Service가 트랜잭션으로 조율한다 (동작 변경 없음)

- [x] T095 [US2] 구조 정리 + 회귀 확인:
  ① 구조 정리(헌법 원칙 I): `src/payment/payment.repository.ts`의 `successPayment`를 `tx`를 받는 결제 갱신·이용권 생성 쿼리 메서드로 나누고,
     `src/payment/payment.service.ts`의 `successPayment`가 `PrismaService.executeTransaction`으로 트랜잭션을 열어 순서를 조율한다.
     Repository는 다른 모듈의 Service를 부르지 않는다. 동작은 바꾸지 않는다
  ② 회귀 확인: `npm run test:e2e`(결제 콜백을 쓰는 기존 E2E 포함)가 구조 정리 전과 같은 결과인지 확인한다
  - 결과(2026-10-22): Repository의 `successPayment`를 `approvePayment(paymentId, now, tx)`·`createTickets(paymentId, data, tx)`로 나누고,
    `PaymentService.successPayment`가 `PrismaService.executeTransaction`으로 두 호출을 묶는다. `tsc` 오류 없음.
    E2E 27개 중 26개 통과(기존 `app.e2e`만 실패, 구조 정리 전과 같음). **주의**: 기존 E2E 중 `/payments`를 호출하는 테스트가 없어
    (계획의 "ticket-pause의 결제 준비 방식"은 실제로 없음) 이 회귀 확인은 결제 승인 경로를 검증하지 못한다

#### 동작 30. 승인 성공 시 선점을 이용권에 확정한다 (QS-6 시작)

QS-6은 동작 30~32를 모두 거쳐야 통과한다. 동작 30에서 E2E를 작성해 실패를 확인하고, 동작 32에서 통과를 확인한다.

- [x] T096 [US2] 작성 + 실패 확인:
  ① E2E 작성: `it('고정석 상품 주문 후 결제가 성공하면 이용권에 고정석과 선택 좌석이 조회된다 (QS-6)')`. 준비 함수 `payOrder(orderId)`(결제 요청 + 성공 콜백) 추가
  ② E2E 실패 확인: E2E 단건(QS-6). 기대 사유: 이용권 조회에 `seatType`·`assignedSeat`가 없거나 `FREE`·`null`
  ③ 단위 작성: `src/payment/payment.service.spec.ts`(신규)에 `it('승인 성공 시 같은 트랜잭션에서 고정석 주문 항목의 선점을 확정한다')`.
     목: `PaymentRepository`, `OrderItemRepository`, `PrismaService.executeTransaction`, `SeatAssignmentService`, `RefundService`, `TransactionLoggerService`
  ④ 단위 실패 확인: 단위 단건. 기대 사유: `activateByOrderItem`이 호출되지 않음
  - 실제 실패(2026-10-23): E2E(QS-6) 결제 요청·콜백(201)은 성공하고 이용권 조회의 `seatType`이 undefined / 단위 `activateByOrderItem` 호출 0회. 기대 사유와 같음.
    결제 준비: `requestVan`의 30% 무작위 예외를 사용자가 무작위 지연(100ms)으로 바꿔(2026-10-23) 실제 `POST /payments` → `POST /payments/callback` 흐름을 쓴다.
    준비 함수 `payOrder`, `sendPaymentCallback`, `findTicketIdByOrder` 추가
- [x] T097 [US2] 구현 + 통과 확인:
  ① 구현: `successPayment` 트랜잭션에서 이용권 생성 후 고정석 주문 항목마다 `SeatAssignmentService.activateByOrderItem(orderItemId, ticketId, now, tx)`.
     `PaymentModule`에서 `SeatAssignmentModule` import
  ② 통과 확인: 단위 단건 통과, `src/payment/` 전체 회귀 없음(E2E QS-6은 동작 32에서 확인)
  - 결과(2026-10-23): 단건 통과, `src/payment/` 1개 통과, `tsc` 오류 없음. `createMany`는 생성 ID를 돌려주지 않으므로 이용권 ID를 서비스에서
    `randomUUID()`로 미리 만들어(`BasePaymentData.id`) 같은 ID로 `activateByOrderItem`을 호출한다.
    참고: 이 구현 직후 E2E 실행 1회가 5분 넘게 끝나지 않아 중단했다. 재실행에서는 정상 종료되어 원인은 재현되지 않았다

#### 동작 31. 이용권 좌석 타입은 주문 항목 스냅샷을 따른다 (QS-6 계속)

- [x] T098 [US2] 작성 + 실패 확인:
  ① 작성: `src/payment/payment.service.spec.ts`에 `it('승인 성공 시 이용권 좌석 타입은 주문 항목 스냅샷을 따른다')`
  ② 실패 확인: 단위 단건. 기대 사유: 이용권 생성 데이터에 `seatType`이 없음
  - 실제 실패(2026-10-23): `toEqual` 불일치, 이용권 데이터의 `seatType`이 undefined. 기대 사유와 같음
- [x] T099 [US2] 구현 + 통과 확인:
  ① 구현: 이용권 생성 데이터(`TimePaymentData`, `PeriodPaymentData`)에 주문 항목의 `seatType`을 복사한다
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): `BasePaymentData.seatType` 추가, 단건 통과, `src/payment/` 2개 통과(회귀 없음), `tsc` 오류 없음

#### 동작 32. 이용권 조회에 좌석 타입과 지정 좌석을 보여 준다 (QS-6 완료)

- [x] T100 [US2] 작성 + 실패 확인:
  ① 작성: `src/ticket/ticket.service.spec.ts`(신규)에 `it('이용권 조회 결과에 좌석 타입과 지정 좌석을 포함한다')`(고정석은 `{ id, number, name }`, 자유석은 `null`)
  ② 실패 확인: 단위 단건. 기대 사유: 결과에 `seatType`·`assignedSeat`가 없음
  - 실제 실패(2026-10-23): `toMatchObject` 불일치, 결과에 `seatType`·`assignedSeat` 없음. 기대 사유와 같음
- [x] T101 [US2] 구현 + 통과 확인:
  ① 구현: `src/ticket/ticket.repository.ts` 조회에 `seatType`과 ACTIVE `seatAssignments`(좌석 `id·number·name`)를 포함하고,
     `src/ticket/ticket.service.ts`의 출력 변환과 `src/ticket/ticket.types.ts`·`src/ticket/get-ticket-out.dto.ts`에 `seatType`, `assignedSeat`를 추가한다 (FR-010)
  ② 단위 통과 확인: 단위 단건 통과, `src/ticket/` 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-6) 통과
  - 결과(2026-10-23): `getTicketById`에 `seatType`과 ACTIVE 배정 좌석(`id·number·name`) 포함, 출력 타입(`TimeTicketOutData`·`PeriodTicketOutData`)에 `seatType`·`assignedSeat` 추가.
    단위 통과, `src/ticket/` 1개 통과, `tsc` 오류 없음, E2E(QS-6) 통과. `get-ticket-out.dto.ts`의 `GetTicketOutDto`는 사용처 없는 빈 클래스라 고치지 않았다.
    참고: 기존 `toTicketOutData`는 활성화 전(expiresAt 없음) 기간권 조회 시 예외를 던진다(이 기능 이전부터 있던 동작)

#### 동작 33. 승인 후 좌석을 줄 수 없으면 자동으로 결제를 취소한다 (QS-31)

- [x] T102 [US2] 작성 + 실패 확인:
  ① E2E 작성: `it('승인 전에 좌석을 다른 이용자가 확정하면 이용권 발급 후 자동 환불되고 환불 콜백 후 이용권이 소멸된다 (QS-31)')`.
     결제 요청 후 `heldUntil`을 과거로 바꾸고, 다른 이용자가 같은 좌석을 주문·결제한 뒤 첫 결제의 성공 콜백 → `PaymentCancel` 생성·사유 확인
     → `POST /refund/callback` 호출 → 이용권 `REVOKED`
  ② E2E 실패 확인: E2E 단건(QS-31). 기대 사유: `PaymentCancel`이 생성되지 않음
  ③ 단위 작성: `src/payment/payment.service.spec.ts`에 `it('좌석을 확정하지 못한 이용권은 커밋 후 시스템 자동 취소를 요청한다')`.
     `activateByOrderItem`이 확정 실패를 반환하는 항목만 `refundBySystem(ticketId, '좌석 선점 만료로 좌석 배정 불가 - 자동 결제 취소')`가
     트랜잭션 종료 후 호출되고 다른 항목은 정상 확정되는지 검증
  ④ 단위 실패 확인: 단위 단건. 기대 사유: `refundBySystem`이 호출되지 않음.
     `activateByOrderItem`이 확정 실패를 알리는 반환값이 없으면 멈추고 반환 형식을 사용자와 정한다(기반 단계 API 변경)
  - 실제 실패(2026-10-23): E2E(QS-31) 첫 결제 콜백 후 `PaymentCancel`이 `null` / 단위 `refundBySystem` 호출 0회. 기대 사유와 같음.
    `activateByOrderItem`은 기반 단계부터 확정 실패 시 `false`를 반환하므로 반환 형식 변경은 필요 없었다.
    E2E에 두 번째 이용자(`otherUser`)와 준비 함수 `requestPayment`, `afterAll`의 `refundLock`·`paymentCancel` 정리를 추가했다
- [x] T103 [US2] 구현 + 통과 확인:
  ① 구현: `successPayment`가 확정하지 못한 고정석 이용권 ID를 모아 커밋 후 `RefundService.refundBySystem`을 호출한다. `PaymentModule`에서 `RefundModule` import (contracts 4절)
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-31) 통과
  - 결과(2026-10-23): 트랜잭션이 확정 실패 이용권 ID를 반환하고 커밋 후 `refundBySystem` 호출. 단위 통과(커밋 후 호출 검증 포함), `src/payment/` 3개 통과, `tsc` 오류 없음, E2E(QS-31) 통과

#### 동작 34. 자동 취소가 실패해도 결제 콜백은 성공으로 처리한다

- [x] T104 [US2] 작성 + 실패 확인:
  ① 작성: `src/payment/payment.service.spec.ts`에 `it('자동 취소 요청이 예외를 던져도 콜백은 성공하고 거래 로그를 남긴다')`
  ② 실패 확인: 단위 단건. 기대 사유: `callbackPayment`가 reject됨
  - 실제 실패(2026-10-23): `Received promise rejected instead of resolved`(`PG 장애`). 기대 사유와 같음
- [x] T105 [US2] 구현 + 통과 확인:
  ① 구현: `refundBySystem` 예외를 잡아 `TransactionLoggerService`에 기록하고 콜백은 성공 처리. `PaymentModule`에서 `LoggerModule` import (R12-A)
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): `refundBySystem` 예외를 잡아 `logTransaction({ type: 'REFUND', status: 'SYSTEM_REFUND_REQUEST_FAILED', metadata: { ticketId, error } })`로 기록. 단건 통과, `src/payment/` 4개 통과, `tsc` 오류 없음

#### 동작 35. 만료된 HELD도 다른 유효 지정이 없으면 확정한다

- [x] T106 [US2] 작성 + 실패 확인:
  ① 작성: `src/seat-assignment/seat-assignment.service.spec.ts`에 `it('선점이 만료됐어도 같은 좌석에 다른 유효 지정이 없으면 결제 확정 시 ACTIVE로 만든다')`
  ② 실패 확인: 단위 단건. 기대 사유: 확정 실패를 반환함.
     기반 단계 구현으로 이미 통과하면 조건 깨뜨리기로 바꿔, `activateByOrderItem`의 "다른 유효 지정 없음" 확인을 잠시 지워(만료 HELD는 무조건 확정 실패)
     실패하는지 확인하고 원복한 뒤 그 결과를 기록한다
  - 결과(2026-10-23): 기반 단계(T005)에 같은 내용의 테스트 「HELD가 만료됐어도 같은 좌석에 다른 유효 배정이 없으면 새 ACTIVE를 만들고 true를 반환한다」가 이미 있어
    중복 테스트를 만들지 않고 그 테스트로 조건 깨뜨리기를 했다. ① 통과 → ② `if (valid && valid.id !== row.id) return false`를 "무조건 확정 실패"로 바꾸자
    `Expected true, Received false`로 실패 → ③ 원복 후 통과, `seat-assignment` 35개 통과
- [x] T107 [US2] 구현 + 통과 확인:
  ① 구현: (task 1에서 실패한 경우만) `activateByOrderItem`에서 만료된 HELD라도 같은 좌석에 다른 유효 지정이 없으면 ACTIVE로 만든다 (contracts 4절)
  ② 통과 확인: 단위 단건 통과, `seat-assignment` 전체 회귀 없음
  - 결과(2026-10-23): task 1이 기반 단계 구현으로 이미 통과해 구현 없음

#### 동작 36. 승인 실패 시 선점을 해제한다 (QS-9)

- [x] T108 [US2] 작성 + 실패 확인:
  ① E2E 작성: `it('결제 실패 후 같은 좌석으로 새 주문이 성공한다 (QS-9)')`
  ② E2E 실패 확인: E2E 단건(QS-9). 기대 사유: 새 주문이 409(선점이 아직 유효)
  ③ 단위 작성: `src/payment/payment.service.spec.ts`에 `it('승인 실패 콜백이면 주문 항목의 선점을 PAYMENT_FAILED로 해제한다')`
  ④ 단위 실패 확인: 단위 단건. 기대 사유: `releaseByOrderItems`가 호출되지 않음
  - 실제 실패(2026-10-23): E2E(QS-9) 새 주문이 `expected 201, got 409`(선점이 아직 유효) / 단위는 첫 단언 `failedPayment`가 `tx` 없이 호출됨에서 실패.
    기대 문구(`releaseByOrderItems` 미호출)와 다른 단언에서 먼저 실패했지만, "결제 실패와 같은 트랜잭션에서 선점을 해제하지 않는다"는 노리는 사유와 같다
- [x] T109 [US2] 구현 + 통과 확인:
  ① 구현: `callbackPayment`의 승인 실패 분기(`!payload.success`)에서 `failedPayment`와 같은 트랜잭션으로
     `releaseByOrderItems(주문 항목 ID, PAYMENT_FAILED, now, tx)`. 금액 불일치 분기는 동작 37에서 넣는다
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-9) 통과
  - 결과(2026-10-23): `failedPayment`에 선택 인자 `tx` 추가, 실패 분기를 `failPaymentAndReleaseHolds`로 분리해 한 트랜잭션에서 처리. 단위 통과, `src/payment/` 5개 통과, `tsc` 오류 없음, E2E(QS-9) 통과

#### 동작 37. 금액 불일치 시 선점을 해제한다

- [x] T110 [US2] 작성 + 실패 확인:
  ① 작성: `src/payment/payment.service.spec.ts`에 `it('승인 금액이 다르면 선점을 PAYMENT_FAILED로 해제한다')`
  ② 실패 확인: 단위 단건. 기대 사유: `PaymentAmountMismatchError`는 던지지만 `releaseByOrderItems`가 호출되지 않음
  - 실제 실패(2026-10-23): `PaymentAmountMismatchError`는 던지지만 `releaseByOrderItems` 호출 0회. 기대 사유와 같음
- [x] T111 [US2] 구현 + 통과 확인:
  ① 구현: 금액 불일치 분기에도 같은 해제를 넣는다(기존 예외는 유지)
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): 금액 불일치 분기도 `failPaymentAndReleaseHolds`를 거친 뒤 기존 예외를 던진다. 단건 통과, `src/payment/` 6개 통과, `tsc` 오류 없음

#### 동작 38. 만료된 선점을 찾아 HOLD_EXPIRED로 해제한다 (QS-30 시작)

QS-30은 동작 38·39를 거쳐야 통과한다. 동작 38에서 E2E를 작성해 실패를 확인하고, 동작 39에서 통과를 확인한다.

- [x] T112 [US2] 작성 + 실패 확인:
  ① E2E 작성: `it('선점이 만료된 주문으로 결제를 요청하면 409이고 선점은 HOLD_EXPIRED로 해제된다 (QS-30)')`. 상태 코드와 `error.code = SeatHoldExpiredError`를 검증한다
  ② E2E 실패 확인: E2E 단건(QS-30). 기대 사유: 409가 아니라 결제 요청 성공
  ③ 단위 작성: `src/seat-assignment/seat-assignment.service.spec.ts`에
     `it('주문 항목의 선점 중 무효인 것을 HOLD_EXPIRED로 해제하고 그 주문 항목 ID를 반환한다')`(이미 해제됐거나 없는 선점도 반환 목록에 포함)
  ④ 단위 실패 확인: 단위 단건. `releaseInvalidHolds is not a function`이면 빈 메서드를 두고 다시 확인한다. 기대 사유: 빈 목록 반환, 해제 미호출
  - 실제 실패(2026-10-23): E2E(QS-30) `expected 409, got 201` / 단위 1차 `releaseInvalidHolds is not a function` → 빈 메서드를 두고 2차 빈 목록 반환으로 `toEqual` 불일치. 기대 사유와 같음
- [x] T113 [US2] 구현 + 통과 확인:
  ① 구현: `src/seat-assignment/seat-assignment.service.ts`에 `releaseInvalidHolds(orderItemIds, now, tx)`.
     판정은 `isValidAssignment`, 조회는 기존 `findHeldByOrderItems`·`findLatestByOrderItem` 사용
  ② 통과 확인: 단위 단건 통과, `seat-assignment` 전체 회귀 없음(E2E QS-30은 동작 39에서 확인)
  - 결과(2026-10-23): 단건 통과, `seat-assignment` 36개 통과(회귀 없음), `tsc` 오류 없음. 고정석 주문 항목 ID만 넘기는 것을 호출 측 책임으로 JSDoc에 적었다

#### 동작 39. 결제 요청 시 선점이 만료됐으면 409 (QS-30 완료)

- [x] T114 [US2] 작성 + 실패 확인:
  ① 작성: `src/payment/payment.service.spec.ts`에 `it('결제 요청 시 무효 선점이 있으면 VAN 요청 전에 SeatHoldExpiredError다')`
  ② 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/seat-assignment/errors/seat-hold-expired.error.ts`에 빈 클래스(`DomainConflictError` 상속, `name = 'SeatHoldExpiredError'`)를 두고 다시 확인한다. 기대 사유: 예외 없이 결제 요청이 진행됨
  - 실제 실패(2026-10-23): 에러 클래스를 먼저 두고 실행, `Received promise resolved instead of rejected`. 기대 사유와 같음. `SeatHoldExpiredError`는 `src/seat-assignment/errors/index.ts`에서 export
- [x] T115 [US2] 구현 + 통과 확인:
  ① 구현: `src/payment/payment.service.ts`의 `requestPayment`에서 VAN 요청 전에 고정석 주문 항목으로 `releaseInvalidHolds`를 트랜잭션으로 실행하고,
     **커밋 후** 반환 목록이 비어 있지 않으면 `SeatHoldExpiredError`(안내 문구 '좌석 선점이 만료되었습니다. 좌석을 다시 선택하세요')(해제가 롤백되지 않도록 커밋 후 예외, R12-C)
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-30) 통과
  - 결과(2026-10-23): 확인 위치를 계획의 "VAN 요청 전"보다 앞인 **결제 생성 전**으로 두었다(거부된 요청이 PENDING 결제를 남기지 않도록).
    고정석 주문 항목만 `releaseInvalidHolds`로 확인하고 커밋 후 `SeatHoldExpiredError`. 단위 `src/payment/` 7개 통과, `tsc` 오류 없음, E2E `seat-type` 20개 모두 통과(QS-30 포함)

#### 동작 40. 자유석 상품은 좌석 없이 주문·결제된다 (QS-10) — 동작 31로 이미 통과

- [x] T116 [US2] 작성 + 조건 깨뜨리기:
  ① E2E 작성: `it('자유석 상품을 좌석 없이 주문·결제하면 이용권이 자유석이고 지정 좌석이 없다 (QS-10)')`
  ② 조건 깨뜨리기: E2E 단건(QS-10) 통과를 확인한 뒤 이용권 생성의 `seatType` 복사(동작 31)를 잠시 `FIXED` 고정으로 바꿔 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 E2E 단건(QS-10) 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-23): ① QS-10 통과 → ② 이용권 생성의 `seatType` 복사를 `SeatType.FIXED`로 고정하자 `Expected "FREE", Received "FIXED"`로 실패 → ③ 원복 후 통과.
    spec US2-3은 "자유석 기간권"이지만, 활성화 전 기간권은 기존 이용권 조회(`toTicketOutData`)가 `expiresAt` 필수 예외를 던져(이 기능 이전부터 있던 동작)
    API로 확인할 수 없어 시간권으로 작성했다

#### US2 마무리

- [x] T117 [US2] `npm run test -- --testPathPatterns="product|order|payment|refund|ticket|seat"`, `npm run test:e2e -- --testPathPatterns=seat-type`, `npx eslint src`, `npm run build`를 실행해 모두 통과하는지 확인한다. 기대값은 바꾸지 않는다
  - 결과(2026-10-23): 단위 11개 파일 86개 통과, E2E `seat-type` 21개 통과, `npm run build` 성공.
    `npx eslint src`는 오류가 남아 있으나 모두 이 기능 이전부터 있던 것이다(US1 커밋 `a158e73` 기준 72건 → 현재 66건, 새로 생긴 오류 0건).
    US2 작업 중 새로 생긴 6건(`no-unnecessary-type-assertion` 5건, `no-base-to-string` 1건)은 동작 변경 없이 고쳤다. 기존 오류 정리는 T190에서 다룬다

**체크포인트**: US1·US2가 각각 독립적으로 동작.

---

## Phase 5: 사용자 스토리 3 — 이용권의 좌석 타입에 맞는 좌석을 이용한다 (우선순위: P3)

**목표**: 입실 시 좌석 타입·지정 좌석을 검증하고, 이용권 종료(소진·환불·기한 경과) 시 지정을 해제한다.

**독립 테스트**: 고정석 이용권으로 지정 좌석 입실 성공·다른 좌석 거부, 자유석 이용권으로 고정석 입실 거부.

**새 테스트 파일**: `src/usage-session/usage-session.service.spec.ts`, `src/session-lifecycle/session-lifecycle.service.spec.ts`.
고정석 이용권 준비는 US2의 주문·결제 경로나 DB 직접 생성(`prisma.ticket.create` + `prisma.seatAssignment.create`)으로 한다.

### 입실 검증 (FR-011)

#### 동작 1. 자유석 이용권으로 고정석에 입실하면 400 (QS-12)

- [x] T118 [US3] 작성 + 실패 확인:
  ① E2E 작성: `test/seat-type.e2e-spec.ts`에 `describe('사용자 스토리 3')`를 만들고 `it('자유석 이용권은 자유석에 입실하고 고정석 입실은 400 (QS-12)')`를 작성한다. 400 응답의 `error.code = SeatTypeMismatchError`를 검증한다
  ② E2E 실패 확인: E2E 단건(QS-12). 기대 사유: 고정석 입실이 400이 아니라 201
  ③ 단위 작성: `src/usage-session/usage-session.service.spec.ts`(신규)에 `it('자유석 이용권으로 고정석에 입실하면 SeatTypeMismatchError다')`.
     목: `UsageSessionRepository`, `TicketRepository`, BullMQ 큐, `SeatAssignmentService`
  ④ 단위 실패 확인: 단위 단건. 기대 사유: 예외 없이 세션이 생성됨
  - 실제 실패(2026-10-23): E2E(QS-12) 고정석 입실이 `expected 400, got 201` / 단위 `Received promise resolved instead of rejected`. 기대 사유와 같음. E2E 준비 함수 `issueTicket`, `enterSeat` 추가
- [x] T119 [US3] 구현 + 통과 확인:
  ① 구현: `src/usage-session/usage-session.service.ts`의 `createSession`에서 세션 생성 트랜잭션 전에 좌석 `type`
     (필요 시 `usage-session.repository.ts`에 좌석 조회 쿼리 추가)과 이용권 `seatType`이 다르면 `SeatTypeMismatchError`.
     `UsageSessionModule`에서 `SeatAssignmentModule` import
  ② 단위 통과 확인: 단위 단건 통과, `src/usage-session/` 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-12) 통과
  - 결과(2026-10-23): `UsageSessionRepository.findSeatType` 추가, 이용권 `seatType`은 T101에서 늘린 `getTicketById`로 조회. 단위 통과, `tsc` 오류 없음, E2E(QS-12) 통과

#### 동작 2. 고정석 이용권으로 자유석에 입실하면 400 (QS-11a) — 동작 1 구현으로 함께 통과

- [x] T120 [US3] 작성 + 조건 깨뜨리기:
  ① 작성: E2E `it('고정석 이용권으로 자유석에 입실하면 400 (QS-11a)')`(상태 코드와 `error.code = SeatTypeMismatchError` 검증)와
     단위 `src/usage-session/usage-session.service.spec.ts`의 `it('고정석 이용권으로 자유석에 입실하면 SeatTypeMismatchError다')`
  ② 조건 깨뜨리기: 단위 단건과 E2E 단건(QS-11a) 통과를 확인한 뒤 타입 비교를 "자유석 이용권일 때만"으로 잠시 좁혀 둘 다 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 단위 단건·E2E 단건(QS-11a) 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-23): ① 단위·E2E(QS-11a) 통과 → ② 1차 시도는 바꾼 조건이 쓰는 `SeatType` import가 빠져 `ReferenceError`(E2E 500)로 실패해 **노리는 사유가 아니었다** →
    import를 넣고 2차 시도에서 단위 `Received promise resolved instead of rejected`, E2E `expected 400, got 201`로 실패(노리는 사유) → ③ 원복 후 단위 2개·QS-11a 통과

#### 동작 3. 고정석 이용권은 지정 좌석이 아니면 입실할 수 없다 (QS-11)

- [x] T121 [US3] 작성 + 실패 확인:
  ① E2E 작성: `it('고정석 이용권은 지정 좌석에 입실하고 다른 고정석 입실은 400 (QS-11)')`. 400 응답의 `error.code = NotAssignedSeatError`를 검증한다
  ② E2E 실패 확인: E2E 단건(QS-11). 기대 사유: 다른 고정석 입실이 400이 아니라 201
  ③ 단위 작성: `src/usage-session/usage-session.service.spec.ts`에 `it('고정석 이용권으로 지정되지 않은 고정석에 입실하면 NotAssignedSeatError다')`
  ④ 단위 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/seat-assignment/errors/not-assigned-seat.error.ts`에 빈 클래스(`DomainBadRequestError` 상속, `name = 'NotAssignedSeatError'`)를 두고 다시 확인한다. 기대 사유: 예외 없이 세션이 생성됨
  - 실제 실패(2026-10-23): 에러 클래스를 먼저 두고 실행. E2E(QS-11) 다른 고정석 입실이 `expected 400, got 201` / 단위 `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T122 [US3] 구현 + 통과 확인:
  ① 구현: 고정석 이용권이면 `SeatAssignmentService.getActiveByTicket`의 좌석과 요청 좌석이 다를 때 `NotAssignedSeatError`(안내 문구 '지정 좌석만 이용할 수 있습니다')
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-11) 통과(지정 좌석 입실 성공 포함)
  - 결과(2026-10-23): 단위 3개 통과, `tsc` 오류 없음, E2E QS-11·11a·12 통과. `NotAssignedSeatError`는 `src/seat-assignment/errors/index.ts`에서 export. 배정이 없는 경우의 처리는 동작 5에서 넣는다

#### 동작 4. 고정석 이용권은 지정 좌석에 입실한다 — 동작 3 구현으로 함께 통과

- [x] T123 [US3] 작성 + 조건 깨뜨리기:
  ① 작성: `src/usage-session/usage-session.service.spec.ts`에 `it('고정석 이용권으로 지정 좌석에 입실하면 세션을 만든다')`
  ② 조건 깨뜨리기: 단건 통과를 확인한 뒤 동작 3의 비교를 잠시 "항상 거부"로 바꿔 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 파일 전체 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-23): ① 통과 → ② 배정 좌석 비교를 "항상 거부"로 바꾸자 `NotAssignedSeatError`로 실패 → ③ 원복 후 `src/usage-session/` 4개 통과.
    세션 생성까지 가는 테스트라 기존 외부 API 스텁(`mockExternalApi`, 1초 대기·30% 실패)이 실행되므로 이 테스트에서만 `Math.random`을 0.99로 고정하고 제한 시간을 10초로 두었다

#### 동작 5. 지정 좌석이 없는 고정석 이용권은 입실할 수 없다 (QS-11b)

- [x] T124 [US3] 작성 + 실패 확인:
  ① E2E 작성: `it('지정 좌석이 없는 고정석 이용권으로 입실하면 400 (QS-11b)')`(자동 취소 대기 중 상황: 고정석 이용권만 만들고 지정은 만들지 않는다). 상태 코드와 `error.code = TicketSeatUnassignedError`를 검증한다
  ② E2E 실패 확인: E2E 단건(QS-11b). 기대 사유: 400이 아니라 500(`null` 접근) 또는 201
  ③ 단위 작성: `src/usage-session/usage-session.service.spec.ts`에 `it('지정 좌석이 없는 고정석 이용권으로 입실하면 TicketSeatUnassignedError다')`
  ④ 단위 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/seat-assignment/errors/ticket-seat-unassigned.error.ts`에 빈 클래스(`DomainBadRequestError` 상속, `name = 'TicketSeatUnassignedError'`)를 두고 다시 확인한다. 기대 사유: `TypeError` 또는 세션 생성
  - 실제 실패(2026-10-23): 에러 클래스를 먼저 두고 실행. E2E(QS-11b) `expected 400, got 500`(`null` 접근) / 단위 `Received constructor: TypeError`. 기대 사유와 같음. 배정 없는 고정석 이용권은 E2E에서 DB로 직접 만든다
- [x] T125 [US3] 구현 + 통과 확인:
  ① 구현: `getActiveByTicket` 결과가 없으면 `TicketSeatUnassignedError`(안내 문구 '지정 좌석이 없는 고정석 이용권입니다') (R12)
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-11b) 통과
  - 결과(2026-10-23): 단위 5개 통과, `tsc` 오류 없음, E2E(QS-11b) 통과. `TicketSeatUnassignedError`는 `src/seat-assignment/errors/index.ts`에서 export

#### 동작 6. 검증과 세션 생성 사이에 지정이 바뀌면 입실하지 않는다

- [x] T126 [US3] 작성 + 실패 확인:
  ① 작성: `src/usage-session/usage-session.service.spec.ts`에 `it('세션 생성 트랜잭션에서 다시 조회한 지정 좌석이 다르면 NotAssignedSeatError다')`
     (트랜잭션 전 조회는 요청 좌석, 트랜잭션 안 재조회는 다른 좌석)
  ② 실패 확인: 단위 단건. 기대 사유: 예외 없이 세션이 생성됨
  - 실제 실패(2026-10-23): `Received promise resolved instead of rejected`. 기대 사유와 같음. 테스트 이름은 "배정" 용어로 작성
- [x] T127 [US3] 구현 + 통과 확인:
  ① 구현: 고정석이면 세션 생성과 같은 트랜잭션에서 지정 행을 `FOR UPDATE`로 다시 조회해(`usage-session.repository.ts`에 쿼리 추가) 요청 좌석과 다르면 `NotAssignedSeatError`로 롤백한다
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): 비교 로직을 Repository에 두지 않도록(헌법 I) `UsageSessionRepository.createSession`에 트랜잭션 시작 직후 실행할 확인 함수 `beforeCreate`를 선택 인자로 추가하고,
    서비스가 그 안에서 `findAssignedSeatIdForUpdate`(배정 행 `FOR UPDATE`)로 다시 조회해 다르면 `NotAssignedSeatError`로 롤백한다.
    단위 6개 통과, `tsc` 오류 없음, E2E QS-11·11a·11b·12 통과(QS-11의 배정 좌석 입실로 재조회 SQL 실행 확인)

#### 동작 7. 자유석 이용권은 자유석에 입실한다 — 구현 전부터 통과

- [x] T128 [US3] 작성 + 조건 깨뜨리기:
  ① 작성: `src/usage-session/usage-session.service.spec.ts`에 `it('자유석 이용권으로 자유석에 입실하면 세션을 만든다')`
  ② 조건 깨뜨리기: 기존 입실 동작으로 통과하는 테스트다. 단건 통과를 확인한 뒤 동작 1의 타입 비교를 잠시 "항상 거부"로 바꿔 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 파일 전체 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-23): ① 통과 → ② 타입 비교를 "항상 거부"로 바꾸자 `SeatTypeMismatchError`로 실패 → ③ 원복 후 `src/usage-session/` 7개 통과. 외부 API 스텁 때문에 `Math.random`을 고정했다

### 이용권 종료 시 지정 해제 (FR-017)

#### 동작 8. 시간권이 소진되면 지정을 해제한다 (QS-20)

- [x] T129 [US3] 작성 + 실패 확인:
  ① E2E 작성: `it('고정석 시간권을 이용 중 잔여시간이 소진되면 지정이 해제된다 (QS-20)')`. 잔여시간을 1분으로 만든 뒤 세션 종료 API를 호출하고 좌석 `isAssignable = true` 확인
  ② E2E 실패 확인: E2E 단건(QS-20). 기대 사유: 소진 후에도 `isAssignable = false`(ACTIVE 지정 남음)
  ③ 단위 작성: `src/session-lifecycle/session-lifecycle.service.spec.ts`(신규)에 `it('시간권이 소진되면 같은 트랜잭션에서 TICKET_EXHAUSTED로 지정을 해제한다')`.
     목: `PrismaService`(트랜잭션 클라이언트의 `$queryRaw`), `SeatAssignmentService`
  ④ 단위 실패 확인: 단위 단건. 기대 사유: `releaseByTicket`이 호출되지 않음
  - 실제 실패(2026-10-23): E2E(QS-20) 소진 후 배정 행이 `ACTIVE`로 남음 / 단위 `releaseByTicket` 호출 0회. 기대 사유와 같음.
    E2E 검증 대상 변경: 좌석 목록의 `isAssignable`은 조회 시점 판정(R3)이라 이용권이 `EXHAUSTED`면 배정을 해제하지 않아도 이미 `true`가 된다.
    그래서 "즉시 해제"는 배정 행의 `RELEASED(TICKET_EXHAUSTED)`로 확인하고 `isAssignable = true`는 함께 확인만 한다
- [x] T130 [US3] 구현 + 통과 확인:
  ① 구현: `src/session-lifecycle/session-lifecycle.service.ts`의 시간권 차감 SQL에 `RETURNING status`를 붙여 `EXHAUSTED` 전이를 판별하고,
     전이됐으면 같은 `tx`로 `releaseByTicket(ticketId, TICKET_EXHAUSTED, now, tx)`. `SessionLifecycleModule`에서 `SeatAssignmentModule` import
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-20) 통과
  - 결과(2026-10-23): 차감 SQL을 `$queryRaw ... RETURNING status`로 바꿔 `EXHAUSTED` 전이 시 같은 `tx`로 `releaseByTicket(TICKET_EXHAUSTED)`. 단위 통과(session-lifecycle·ticket-pause·usage-session 8개), `tsc` 오류 없음, E2E(QS-20) 통과

#### 동작 9. 시간권이 소진되지 않으면 지정을 유지한다 — 동작 8 구현으로 함께 통과

- [x] T131 [US3] 작성 + 조건 깨뜨리기:
  ① 작성: `src/session-lifecycle/session-lifecycle.service.spec.ts`에 `it('시간권이 소진되지 않으면 지정을 해제하지 않는다')`
  ② 조건 깨뜨리기: 단건 통과를 확인한 뒤 `EXHAUSTED` 판별 조건을 잠시 지워(항상 해제) 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 파일 전체 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-23): ① 통과 → ② `EXHAUSTED` 판별을 지워(항상 해제) `releaseByTicket` 호출 1회로 실패 → ③ 원복 후 2개 통과

#### 동작 10. 환불이 확정되면 지정을 해제한다 (QS-21)

- [x] T132 [US3] 작성 + 실패 확인:
  ① E2E 작성: `it('고정석 이용권의 환불이 확정되면 지정이 해제된다 (QS-21)')`. 환불 요청 후 `POST /refund/callback`으로 확정
  ② E2E 실패 확인: E2E 단건(QS-21). 기대 사유: 확정 후에도 `isAssignable = false`
  ③ 단위 작성: `src/refund/refund.service.spec.ts`에 `it('환불 콜백으로 확정되면 같은 트랜잭션에서 TICKET_REVOKED로 지정을 해제한다')`
  ④ 단위 실패 확인: 단위 단건. 기대 사유: `releaseByTicket`이 호출되지 않음
  - 실제 실패(2026-10-23): E2E(QS-21) 환불 확정 후 배정 행이 `ACTIVE` / 단위 `releaseByTicket` 호출 0회. 기대 사유와 같음. QS-20과 같은 이유로 `isAssignable` 대신 배정 행 `RELEASED(TICKET_REVOKED)`를 확인한다
- [x] T133 [US3] 구현 + 통과 확인:
  ① 구현: `src/refund/refund.service.ts`의 `callback()`에서 `confirmRefundSuccess`를 호출하는 트랜잭션에 같은 `tx`로
     `SeatAssignmentService.releaseByTicket(TICKET_REVOKED)`. Repository(`refund.repository.ts`)는 바꾸지 않는다(헌법 원칙 I). `RefundModule`에서 `SeatAssignmentModule` import
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-21) 통과
  - 결과(2026-10-23): `callback()`의 확정 트랜잭션에서 이용권 ID를 조회해 같은 `tx`로 `releaseByTicket(TICKET_REVOKED)`. 단위 5개 통과, `tsc` 오류 없음, E2E(QS-21) 통과.
    계획 차이: 콜백은 `orderItemId`만 받아 이용권 ID 조회가 필요해서, `refund.repository.ts`에 읽기 전용 조회 `findTicketIdByOrderItem`을 추가했다
    (계획의 "Repository는 바꾸지 않는다"는 업무 로직을 넣지 않는다는 취지이고, 조회 쿼리 추가는 헌법 I에 맞다)

#### 동작 11. 낡은 락 정리에서 환불 성공이 확인되면 지정을 해제한다

- [x] T134 [US3] 작성 + 실패 확인:
  ① 작성: `src/refund/refund.service.spec.ts`에 `it('낡은 락 정리에서 PG 취소 성공이 확인되면 TICKET_REVOKED로 지정을 해제한다')`
  ② 실패 확인: 단위 단건. 기대 사유: `releaseByTicket`이 호출되지 않음
  - 실제 실패(2026-10-23): `releaseByTicket` 호출 0회. 기대 사유와 같음. 같은 요청(멱등 키 일치)이 남긴 만료 락을 PG 조회 "성공"으로 확정하는 경로를 `refund()`로 검증
- [x] T135 [US3] 구현 + 통과 확인:
  ① 구현: `clearStaleLock()`의 SUCCEEDED 분기 트랜잭션에도 같은 해제를 넣는다
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): SUCCEEDED 분기에 해제 추가, 콜백 경로와 같은 로직을 `releaseRevokedTicketSeat`로 묶었다. 단위 6개 통과, `tsc` 오류 없음, E2E(QS-21) 통과

#### 동작 12. 환불이 실패하면 지정을 유지한다 — 동작 10·11 구현으로 함께 통과

- [x] T136 [US3] 작성 + 조건 깨뜨리기:
  ① 작성: `src/refund/refund.service.spec.ts`에 `it('환불이 실패로 끝나면 지정을 해제하지 않는다')`
  ② 조건 깨뜨리기: 단건 통과를 확인한 뒤 해제 호출을 FAILED 분기에도 잠시 넣어 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 파일 전체 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-23): 처음 실행에서 테스트 준비 코드의 Repository 목에 `failPaymentCancel`이 없어 `TypeError`로 실패했다(기대값 문제 아님) → 목을 추가.
    ① 통과 → ② 실패 분기에도 해제를 넣자 `releaseByTicket` 호출 1회로 실패 → ③ 원복 후 `src/refund/` 7개 통과

#### 동작 13. 기간이 만료된 이용권의 좌석은 새 주문으로 차지할 수 있다 (QS-22) — 기반 단계의 지연 해제로 이미 통과

- [x] T137 [US3] 작성 + 조건 깨뜨리기:
  ① E2E 작성: `it('기간이 만료된 고정석 이용권의 좌석으로 새 주문이 성공하고 기존 지정은 TICKET_EXPIRED로 해제된다 (QS-22)')`. 기간권 `expiresAt`을 DB에서 과거로 바꾼다
  ② 조건 깨뜨리기: E2E 단건(QS-22) 통과를 확인한 뒤 `seat-assignment.policy.ts`의 기간권 기한 비교를 잠시 지워(항상 유효) 409로 실패하는지 확인한다 (research R3)
  ③ 원복 후 통과 확인: 원복하고 E2E 단건(QS-22), `seat-assignment` 단위 전체 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-23): ① QS-22 통과 → ② `getTicketDeadline`의 기간권 기한을 무한 미래로 바꾸자 새 주문이 `expected 201, got 409`로 실패 → ③ 원복 후 QS-22, `seat-assignment` 36개 통과.
    준비: 고정석 기간권을 주문·결제로 발급한 뒤 DB에서 `ACTIVE`·만료일 과거로 바꾼다

#### US3 마무리

- [x] T138 [US3] `npm run test -- --testPathPatterns="usage-session|session-lifecycle|refund|seat"`, `npm run test:e2e -- --testPathPatterns=seat-type`, `npx eslint src`, `npm run build`를 실행해 모두 통과하는지 확인한다
  - 결과(2026-10-23): 지정 단위 7개 파일 71개 통과, `npm run build` 성공. `npx eslint src`는 새로 생긴 오류 0건(US2 커밋 `3dfe540` 기준 66건 그대로, US3에서 생긴 1건은 고쳤다).
    E2E: `seat-type` 28개 통과. 처음 전체 E2E를 **병렬**로 돌렸을 때 `ticket-pause` 9건과 `seat-type` QS-20이 실패했다(순차 `--runInBand`에서는 통과).
    정리 코드는 각 파일이 만든 데이터만 지워 원인이 아니었고, 입실 API의 외부 API 스텁 재시도 간격을 500ms → 100ms로 줄인 뒤(사용자 변경, 2026-10-23)
    병렬 실행 3회 모두 기존 `app.e2e` 1건 외 38개가 통과했다. 부하에 따른 시간 초과로 추정하지만 실패 당시 메시지를 받아 두지 못해 확정하지 않았다.
    전체 단위 실행의 `src/user` 2건 실패(`ConfigService` 주입 누락)는 이 기능 이전부터 있던 문제다

**체크포인트**: US1~US3이 각각 독립적으로 동작.

---

## Phase 6: 사용자 스토리 4 — 점주가 이용권의 좌석을 변경한다 (우선순위: P3)

**목표**: 이용권 좌석 타입 변경·고정석 이동 API, 변경 이력, 일시정지 해제·재개 재지정.

**독립 테스트**: 자유석 이용권을 고정석으로 변경(좌석 지정) → 조회 시 고정석·지정 좌석 → 자유석으로 변경 → 지정 해제.

**새 테스트 파일**: `src/ticket/ticket-seat/dto/change-ticket-seat.dto.spec.ts`, `src/ticket/ticket-seat/ticket-seat.service.spec.ts`,
`src/ticket/ticket-pause/ticket-pause.service.spec.ts`. 이용 중 시나리오는 US3의 입실 검증을 쓴다.
일시정지 시나리오는 활성화된 기간권으로 준비한다(시간권은 현재 일시정지 불가, research R10).

### 좌석 변경 요청 검증 (FR-020)

#### 동작 1. 좌석 타입은 필수이고 FIXED·FREE만 허용한다

- [x] T139 [US4] 작성 + 실패 확인:
  ① 작성: `src/ticket/ticket-seat/dto/change-ticket-seat.dto.spec.ts`(신규)에 `it('좌석 타입이 없거나 고정석·자유석 이외면 isEnum 오류다')`
  ② 실패 확인: 단위 단건. 파일이 없으면 빈 클래스 `ChangeTicketSeatDto {}`를 두고 다시 확인한다. 기대 사유: `seatType` 오류에 `isEnum`이 없음
  - 실제 실패(2026-10-23): 1차 `Cannot find module` → 빈 클래스를 두고 2차 `seatType` 오류 항목 없음(`constraints` undefined). 노리는 사유(enum 검증 없음)와 같음
- [x] T140 [US4] 구현 + 통과 확인:
  ① 구현: `src/ticket/ticket-seat/dto/change-ticket-seat.dto.ts`에 `seatType`(`@IsEnum(SeatType)`, 한글 `@ApiProperty`)
  ② 통과 확인: 단위 단건 통과
  - 결과(2026-10-23): 단건 통과

#### 동작 2. 고정석으로 바꿀 때는 좌석 ID가 필수다

- [x] T141 [US4] 작성 + 실패 확인:
  ① 작성: `change-ticket-seat.dto.spec.ts`에 `it('좌석 타입이 고정석인데 좌석 ID가 없으면 isUuid 오류다')`
  ② 실패 확인: 단위 단건. 기대 사유: `seatId` 오류가 없음
  - 실제 실패(2026-10-23): `seatId` 오류 항목 없음. 기대 사유와 같음
- [x] T142 [US4] 구현 + 통과 확인:
  ① 구현: `seatId?`(`@ValidateIf((dto) => dto.seatType === SeatType.FIXED) @IsUUID('4')`)
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): 단건 통과, 파일 2개 통과

#### 동작 3. 변경 사유는 필수다

- [x] T143 [US4] 작성 + 실패 확인:
  ① 작성: `change-ticket-seat.dto.spec.ts`에 `it('변경 사유가 없으면 isNotEmpty 오류다')`
  ② 실패 확인: 단위 단건. 기대 사유: `reason` 오류에 `isNotEmpty`가 없음(whitelist 오류만 있거나 오류 없음)
  - 실제 실패(2026-10-23): `reason` 오류 항목 없음. 기대 사유와 같음
- [x] T144 [US4] 구현 + 통과 확인:
  ① 구현: `reason`(`@IsNotEmpty() @IsString()`)
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): 단건 통과, 파일 3개 통과

#### 동작 4. 변경 사유는 500자 이하다

- [x] T145 [US4] 작성 + 실패 확인:
  ① 작성: `change-ticket-seat.dto.spec.ts`에 `it('변경 사유가 500자를 넘으면 maxLength 오류다')`
  ② 실패 확인: 단위 단건. 기대 사유: 오류 없음
  - 실제 실패(2026-10-23): `reason` 오류 없음. 기대 사유와 같음
- [x] T146 [US4] 구현 + 통과 확인:
  ① 구현: `reason`에 `@MaxLength(500)`
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음

### 이용권 좌석 변경 (FR-013~015b, FR-019, FR-021)
  - 결과(2026-10-23): 단건 통과, 파일 4개 통과

#### 동작 5. 이용 중이 아닌 자유석 이용권을 고정석으로 바꾼다 (QS-13a)

- [x] T147 [US4] 작성 + 실패 확인:
  ① E2E 작성: `test/seat-type.e2e-spec.ts`에 `describe('사용자 스토리 4')`를 만들고
     `it('이용 중이 아닌 자유석 이용권을 고정석으로 바꾸면 좌석이 지정되고 이력이 1건 남는다 (QS-13a)')`를 작성한다
  ② E2E 실패 확인: E2E 단건(QS-13a). 라우트가 없어 404이면 빈 구현을 둔다: `src/ticket/ticket-seat/ticket-seat.controller.ts`
     (`@Patch(':ticketId/seat')`, `@Roles(Role.OWNER, Role.MANAGER)`, `ParseUUIDPipe`, `@CurrentUser()`), 빈 `TicketSeatService.changeSeat(ticketId, dto, changedBy)`,
     `src/ticket/ticket.module.ts` 등록. 기대 사유: 이용권이 여전히 `FREE`, 이력 0건
  ③ 단위 작성: `src/ticket/ticket-seat/ticket-seat.service.spec.ts`(신규)에 `it('자유석 이용권을 고정석으로 바꾸면 새 지정을 만들고 이력 1행을 남긴다')`.
     목: `TicketSeatRepository`, `PrismaService.executeTransaction`, `SeatAssignmentService`, `SessionLifecycleService`, BullMQ 큐
  ④ 단위 실패 확인: 단위 단건. 기대 사유: `assign`·이력 생성이 호출되지 않음
  - 실제 실패(2026-10-23): E2E(QS-13a) 1차 404(라우트 없음) → 빈 컨트롤러·서비스를 두고 2차 이용권 `seatType` `Expected "FIXED", Received "FREE"` / 단위 `assign` 호출 0회. 기대 사유와 같음. 준비 함수 `changeTicketSeat` 추가, 테스트 이름은 "배정" 용어 사용
- [x] T148 [US4] 구현 + 통과 확인:
  ① 구현: `src/ticket/ticket-seat/ticket-seat.repository.ts`(신규)에 이용권 `FOR UPDATE` 조회, 이용권 `seatType` 변경, `TicketSeatChange` 생성을 둔다.
     `changeSeat`는 트랜잭션에서 이용권 잠금 → `SeatAssignmentService.assign(seatId, ticketId, now, tx)` → 이용권 `seatType = FIXED`
     → 이력(`changeType = TYPE_CHANGE`, 전후 타입·좌석, 사유, 변경자) 순서. `TicketModule`에서 `SeatAssignmentModule` import
  ② 단위 통과 확인: 단위 단건 통과, `src/ticket/` 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-13a) 통과
  - 결과(2026-10-23): `TicketSeatRepository`(이용권 `FOR UPDATE` 조회·타입 변경·이력 생성·활성 세션 조회) 추가. 이용권 매장은 주문의 매장으로 조회한다. 단위 통과, `src/ticket/` 6개 통과, `tsc` 오류 없음, E2E(QS-13a) 통과

#### 동작 6. 이용 중인 이용권의 타입을 바꾸면 즉시 퇴실시킨다 (QS-13)

- [x] T149 [US4] 작성 + 실패 확인:
  ① E2E 작성: `it('이용 중인 시간권을 자유석에서 고정석으로 바꾸면 세션이 종료되고 자동 입실되지 않는다 (QS-13)')`(잔여시간 차감, 이력 1건 확인)
  ② E2E 실패 확인: E2E 단건(QS-13). 기대 사유: 세션이 `ACTIVE`로 남음
  ③ 단위 작성: `ticket-seat.service.spec.ts`에 `it('이용 중에 타입을 바꾸면 세션을 종료하고 이력에 종료 세션 ID를 남긴다')`(커밋 후 BullMQ Job 제거 포함)
  ④ 단위 실패 확인: 단위 단건. 기대 사유: `endSession`이 호출되지 않음
  - 실제 실패(2026-10-23): E2E(QS-13) 세션 `Expected "ENDED", Received "ACTIVE"` / 단위 `endSession` 호출 0회. 기대 사유와 같음
- [x] T150 [US4] 구현 + 통과 확인:
  ① 구현: 활성 세션 조회(`ticket-seat.repository.ts`)가 있으면 트랜잭션 안에서 `SessionLifecycleService.endSession` 호출, 이력에 `endedSessionId`,
     커밋 후 Job 제거(`TicketPauseService.pauseTicket`과 같은 패턴, research R6). `TicketModule`에서 `SessionLifecycleModule`, BullMQ `usage-session` 큐 import (FR-019)
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-13) 통과
  - 결과(2026-10-23): 트랜잭션 안에서 활성 세션을 `endSession`으로 종료하고 이력에 `endedSessionId`, 커밋 후 BullMQ Job 제거. 단위 7개 통과, `tsc` 오류 없음, E2E QS-13·13a 통과

#### 동작 7. 이용 중이 아닌 고정석 이용권을 자유석으로 바꾼다 (QS-14a)

- [x] T151 [US4] 작성 + 실패 확인:
  ① E2E 작성: `it('이용 중이 아닌 고정석 이용권을 자유석으로 바꾸면 지정이 SEAT_TYPE_CHANGED로 해제된다 (QS-14a)')`
  ② E2E 실패 확인: E2E 단건(QS-14a). 기대 사유: 지정이 `ACTIVE`로 남음
  ③ 단위 작성: `ticket-seat.service.spec.ts`에 `it('고정석 이용권을 자유석으로 바꾸면 지정을 SEAT_TYPE_CHANGED로 해제한다')`
  ④ 단위 실패 확인: 단위 단건. 기대 사유: `releaseByTicket`이 호출되지 않음
  - 실제 실패(2026-10-23): E2E(QS-14a) 배정이 `ACTIVE`로 남음(기대 사유와 같음).
    단위는 처음에 테스트 파일의 `SeatReleaseReason` import가 빠져 **노리는 사유가 아닌 이유로** 실패했다 → import를 고치고, 이미 넣은 구현을 잠시 빼고
    다시 실행해 `releaseByTicket` 호출 0회(노리는 사유)를 확인한 뒤 구현을 되돌렸다
- [x] T152 [US4] 구현 + 통과 확인:
  ① 구현: `FIXED → FREE`면 `releaseByTicket(ticketId, SEAT_TYPE_CHANGED, now, tx)`, 이용권 `seatType = FREE`, 이력 1행 (FR-015)
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-14a) 통과
  - 결과(2026-10-23): 단위 8개 통과, `tsc` 오류 없음, E2E(QS-14a) 통과

#### 동작 8. 이용 중인 기간권을 자유석으로 바꾸면 퇴실하고 만료일은 그대로다 (QS-14) — 동작 6·7 구현으로 함께 통과

- [x] T153 [US4] 작성 + 조건 깨뜨리기:
  ① E2E 작성: `it('이용 중인 기간권을 고정석에서 자유석으로 바꾸면 세션이 종료되고 만료일은 바뀌지 않는다 (QS-14)')`
  ② 조건 깨뜨리기: E2E 단건(QS-14) 통과를 확인한 뒤 동작 6의 세션 종료 조건을 잠시 "자유석 → 고정석일 때만"으로 좁혀 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 E2E 단건(QS-14)과 `ticket-seat` 단위 전체 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-23): ① QS-14 통과 → ② 세션 종료 조건을 "자유석 → 고정석일 때만"으로 좁히자 세션 `Expected "ENDED", Received "ACTIVE"`로 실패 → ③ 원복 후 QS-14, `ticket-seat` 단위 7개 통과

#### 동작 9. 이용 중이 아닌 고정석 이용권을 다른 고정석으로 옮긴다 (QS-15a)

- [x] T154 [US4] 작성 + 실패 확인:
  ① E2E 작성: `it('이용 중이 아닌 고정석 이용권을 다른 빈 고정석으로 옮기면 기존 좌석이 SEAT_MOVED로 해제된다 (QS-15a)')`
  ② E2E 실패 확인: E2E 단건(QS-15a). 기대 사유: 지정 좌석이 그대로이거나 409(새 지정이 이용권당 ACTIVE 1개 인덱스에 걸림)
  ③ 단위 작성: `ticket-seat.service.spec.ts`에 `it('고정석을 다른 고정석으로 옮기면 기존 지정을 SEAT_MOVED로 해제하고 새 지정을 만든다')`(이력 `changeType = SEAT_MOVE`)
  ④ 단위 실패 확인: 단위 단건. 기대 사유: `SEAT_MOVED` 해제가 호출되지 않음
  - 실제 실패(2026-10-23): E2E(QS-15a) `expected 200, got 409`(이용권당 ACTIVE 1개 인덱스) / 단위 `SEAT_MOVED` 해제 호출 0회. 기대 사유와 같음. 단위는 해제가 배정보다 먼저인지도 검증한다
- [x] T155 [US4] 구현 + 통과 확인:
  ① 구현: `FIXED → FIXED`(다른 좌석)면 `releaseByTicket(SEAT_MOVED)` 후 `assign`, 이력 `SEAT_MOVE` (FR-015a, FR-015b)
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-15a) 통과
  - 결과(2026-10-23): 단위 9개 통과, `tsc` 오류 없음, E2E(QS-15a) 통과

#### 동작 10. 이용 중인 고정석 이동은 세션을 유지한 채 좌석만 바꾼다 (QS-15)

- [x] T156 [US4] 작성 + 실패 확인:
  ① E2E 작성: `it('이용 중인 고정석 이용권을 옮기면 같은 세션에서 좌석만 바뀌고 기존 좌석은 선택 가능해진다 (QS-15)')`
  ② E2E 실패 확인: E2E 단건(QS-15). 기대 사유: 세션이 종료됨(동작 6의 퇴실이 이동에도 적용됨)
  ③ 단위 작성: `ticket-seat.service.spec.ts`에 `it('이용 중에 고정석을 옮기면 세션을 종료하지 않고 세션 좌석만 바꾼다')`
  ④ 단위 실패 확인: 단위 단건. 기대 사유: `endSession`이 호출되고 세션 좌석 변경은 호출되지 않음
  - 실제 실패(2026-10-23): E2E(QS-15) 세션이 `ENDED`, 좌석이 기존 좌석(기대 사유와 같음) / 단위는 처음에 `endSession` 목이 값을 돌려주지 않아 `TypeError`로 실패 →
    테스트 준비 코드에 `endSession` 기본 반환값을 넣고 다시 실행해 `endSession` 호출 1회(기대 0회, 노리는 사유)를 확인
- [x] T157 [US4] 구현 + 통과 확인:
  ① 구현: 이동이면 `endSession` 대신 `ticket-seat.repository.ts`의 세션 `seatId` 변경을 같은 `tx`에서 호출한다 (research R5)
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-15) 통과
  - 결과(2026-10-23): `TicketSeatRepository.updateSessionSeat` 추가, 이동이면 세션 종료 대신 세션 좌석만 바꾼다. 단위 10개 통과, `tsc` 오류 없음, E2E QS-13·13a·14·14a·15·15a 통과

#### 동작 11. 이동할 좌석에 다른 이용자의 활성 세션이 있으면 409

- [x] T158 [US4] 작성 + 실패 확인:
  ① 작성: `ticket-seat.service.spec.ts`에 `it('옮길 좌석에 다른 활성 세션이 있으면 SeatAlreadyOccupiedError다')`
  ② 실패 확인: 단위 단건. 기대 사유: 예외 없이 이동함
  - 실제 실패(2026-10-23): `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T159 [US4] 구현 + 통과 확인:
  ① 구현: 이동 대상 좌석의 활성 세션을 조회해 있으면 `SeatAlreadyOccupiedError`(`src/usage-session/errors/seat-already-occupied.error.ts` 재사용)
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): `TicketSeatRepository.hasOtherActiveSessionOnSeat`(변경 대상 이용권 제외) 추가, 이동일 때만 확인. 단위 11개 통과, `tsc` 오류 없음

#### 동작 12. 이미 지정된 고정석으로 옮기면 409 (QS-15b) — `assign`의 유효 지정 검사로 이미 통과

- [x] T160 [US4] 작성 + 조건 깨뜨리기:
  ① E2E 작성: `it('이미 다른 이용권에 지정된 고정석으로 옮기면 409 (QS-15b)')`. 상태 코드와 `error.code = SeatNotAssignableError`를 검증한다
  ② 조건 깨뜨리기: E2E 단건(QS-15b) 통과를 확인한 뒤 `changeSeat`의 이동 분기에서 `assign` 호출을 잠시 지워 409가 아니게 되는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 E2E 단건(QS-15b) 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-23): ① QS-15b 통과(`error.code = SeatNotAssignableError`) → ② 이동일 때 `assign` 호출을 빼자 `expected 409, got 200`으로 실패 → ③ 원복 후 QS-15·15b 통과

#### 동작 13. 대상 좌석이 자유석이면 400

- [x] T161 [US4] 작성 + 실패 확인:
  ① 작성: `ticket-seat.service.spec.ts`에 `it('고정석으로 바꿀 좌석이 자유석이면 SeatTypeMismatchError다')`
  ② 실패 확인: 단위 단건. 기대 사유: `assign`이 던지는 오류가 다르거나(목은 성공) 예외 없음
  - 실제 실패(2026-10-23): `Received promise resolved instead of rejected`(목 `assign`은 성공). 기대 사유와 같음
- [x] T162 [US4] 구현 + 통과 확인:
  ① 구현: 대상 좌석을 조회해 자유석이면 `SeatTypeMismatchError`
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): `TicketSeatRepository.findSeat`(타입·매장) 추가, 고정석 대상 좌석을 상태 변경 전에 검증한다. `assign` 내부 검사는 공용 에러를 던지므로 헌법 VI 코드를 위해 서비스에서 먼저 확인한다. 단위 12개 통과, `tsc` 오류 없음

#### 동작 14. 대상 좌석이 다른 매장 좌석이면 400

- [x] T163 [US4] 작성 + 실패 확인:
  ① 작성: `ticket-seat.service.spec.ts`에 `it('고정석으로 바꿀 좌석이 다른 매장 좌석이면 SeatShopMismatchError다')`
  ② 실패 확인: 단위 단건. 기대 사유: 예외 없음
  - 실제 실패(2026-10-23): `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T164 [US4] 구현 + 통과 확인:
  ① 구현: 좌석 `shopId`와 이용권 매장(주문의 `shopId`)이 다르면 `SeatShopMismatchError`(US2 동작 16에서 만든 `src/seat-assignment/errors/seat-shop-mismatch.error.ts`)
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): 이용권 매장(주문의 매장)과 좌석 매장이 다르면 `SeatShopMismatchError`(US2에서 만든 에러). 단위 13개 통과, `tsc` 오류 없음

#### 동작 15. 자유석 이용권을 자유석으로 바꾸면 400 (QS-16a 시작)

QS-16a는 동작 15·16을 거쳐야 통과한다. 동작 15에서 E2E를 작성해 실패를 확인하고, 동작 16에서 통과를 확인한다.

- [x] T165 [US4] 작성 + 실패 확인:
  ① E2E 작성: `it('자유석 이용권을 자유석으로, 고정석 이용권을 같은 좌석으로 바꾸면 400 (QS-16a)')`. 두 요청 모두 상태 코드와 `error.code = TicketSeatUnchangedError`를 검증한다
  ② E2E 실패 확인: E2E 단건(QS-16a). 기대 사유: 400이 아니라 200(자유석 → 자유석) 또는 409(같은 좌석 재지정)
  ③ 단위 작성: `ticket-seat.service.spec.ts`에 `it('자유석 이용권을 자유석으로 바꾸면 TicketSeatUnchangedError다')`
  ④ 단위 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/ticket/errors/ticket-seat-unchanged.error.ts`에 빈 클래스(`DomainBadRequestError` 상속, `name = 'TicketSeatUnchangedError'`)를 두고 다시 확인한다. 기대 사유: 예외 없이 이력이 생성됨
  - 실제 실패(2026-10-23): 에러 클래스를 먼저 두고 실행. E2E(QS-16a) 자유석 → 자유석이 `expected 400, got 200` / 단위 `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T166 [US4] 구현 + 통과 확인:
  ① 구현: 현재 `FREE`이고 요청 `FREE`면 `TicketSeatUnchangedError`(안내 문구 '바뀌는 내용이 없습니다')
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음(E2E QS-16a는 동작 16에서 확인)
  - 결과(2026-10-23): 단위 14개 통과, `tsc` 오류 없음(E2E QS-16a는 동작 16에서 확인)

#### 동작 16. 고정석 이용권을 같은 좌석으로 바꾸면 400 (QS-16a 완료)

- [x] T167 [US4] 작성 + 실패 확인:
  ① 작성: `ticket-seat.service.spec.ts`에 `it('고정석 이용권을 같은 좌석으로 바꾸면 TicketSeatUnchangedError다')`
  ② 실패 확인: 단위 단건. 기대 사유: 예외 없이 해제·재지정이 호출됨
  - 실제 실패(2026-10-23): `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T168 [US4] 구현 + 통과 확인:
  ① 구현: 현재 `FIXED`이고 요청 좌석이 현재 지정 좌석과 같으면 `TicketSeatUnchangedError`
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-16a) 통과
  - 결과(2026-10-23): 변경 전 배정 좌석과 요청 좌석이 같으면 `TicketSeatUnchangedError`. 단위 15개 통과, `tsc` 오류 없음, E2E(QS-16a) 통과

#### 동작 17. 종료된 이용권은 좌석을 바꿀 수 없다

- [x] T169 [US4] 작성 + 실패 확인:
  ① 작성: `ticket-seat.service.spec.ts`에 `it('종료 상태(EXPIRED·EXHAUSTED·REVOKED) 이용권이면 TicketClosedError다')`(`it.each`로 세 상태)
  ② 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/ticket/errors/ticket-closed.error.ts`에 빈 클래스(`DomainBadRequestError` 상속, `name = 'TicketClosedError'`)를 두고 다시 확인한다. 기대 사유: 예외 없음
  - 실제 실패(2026-10-23): 에러 클래스를 먼저 두고 실행, 세 상태 모두 `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T170 [US4] 구현 + 통과 확인:
  ① 구현: 이용권 상태가 종료 상태면 `TicketClosedError`
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): 단위 18개 통과(`it.each` 3건 포함), `tsc` 오류 없음

#### 동작 18. 일시정지 중인 이용권은 좌석을 바꿀 수 없다

- [x] T171 [US4] 작성 + 실패 확인:
  ① 작성: `ticket-seat.service.spec.ts`에 `it('일시정지 중인 이용권이면 TicketPausedError다')`
  ② 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/ticket/errors/ticket-paused.error.ts`에 빈 클래스(`DomainBadRequestError` 상속, `name = 'TicketPausedError'`)를 두고 다시 확인한다. 기대 사유: 예외 없음
  - 실제 실패(2026-10-23): 에러 클래스를 먼저 두고 실행, `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T172 [US4] 구현 + 통과 확인:
  ① 구현: 활성 `TicketPause`가 있으면(`ticket-seat.repository.ts` 조회 추가) `TicketPausedError`
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): `TicketSeatRepository.hasActivePause` 추가. 단위 19개 통과, `tsc` 오류 없음

#### 동작 19. 없는 이용권이면 404

- [x] T173 [US4] 작성 + 실패 확인:
  ① 작성: `ticket-seat.service.spec.ts`에 `it('이용권이 없으면 TicketNotFoundError다')`
  ② 실패 확인: 단위 단건. 에러 파일이 없어 `Cannot find module`이면 `src/ticket/errors/ticket-not-found.error.ts`에 빈 클래스(`DomainNotFoundError` 상속, `name = 'TicketNotFoundError'`)를 두고 다시 확인한다. 기대 사유: `TypeError`(null 접근)
  - 실제 실패(2026-10-23): 에러 클래스를 먼저 두고 실행, `Received constructor: TypeError`(null 접근). 기대 사유와 같음
- [x] T174 [US4] 구현 + 통과 확인:
  ① 구현: 이용권 조회 결과가 `null`이면 `TicketNotFoundError`
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): 임시 non-null 단언 제거. 단위 20개 통과, `tsc` 오류 없음

#### 동작 19a. 고정석으로 바꿀 좌석이 없으면 404

- [x] T174a [US4] 작성 + 실패 확인:
  ① 작성: `ticket-seat.service.spec.ts`에 `it('고정석으로 바꿀 좌석이 없으면 SeatNotFoundError다')`(대상 좌석 조회가 `null` 반환)
  ② 실패 확인: 단위 단건. 기대 사유: `SeatNotFoundError`가 아닌 `TypeError`(동작 13의 좌석 `type` 접근) 또는 다른 오류
  - 실제 실패(2026-10-23): `Received promise resolved instead of rejected`. 기대 문구(`TypeError`)와 다른데, 동작 13·14 구현이 `target?.`로 null을 안전하게 다뤄 예외 없이 진행됐기 때문이다. "`SeatNotFoundError`를 던지지 않음"이라는 노리는 사유와는 같다
- [x] T174b [US4] 구현 + 통과 확인:
  ① 구현: 동작 13의 대상 좌석 조회 결과가 `null`이면 `SeatNotFoundError`(US1 동작 4에서 만든 `src/seat/errors/seat-not-found.error.ts`).
     자유석·다른 매장 검사(동작 13·14)보다 먼저 확인한다
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): 대상 좌석이 없으면 매장·타입 검사보다 먼저 `SeatNotFoundError`(US1의 에러). 단위 21개 통과, `tsc` 오류 없음

#### 동작 20. 사유 없이 바꾸면 400 (QS-16) — 동작 3으로 이미 통과

- [x] T175 [US4] 작성 + 조건 깨뜨리기:
  ① E2E 작성: `it('사유 없이 이용권 좌석을 바꾸면 400 (QS-16)')`
  ② 조건 깨뜨리기: E2E 단건(QS-16) 통과를 확인한 뒤 `reason`의 `@IsNotEmpty()`를 잠시 지워 400이 아니게 되는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 E2E 단건(QS-16)과 DTO 단위 전체 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-23): `reason`에는 `@IsString()`도 있어 필드를 빼면 `@IsNotEmpty()`를 지워도 400이 나므로, 사유 검증만 겨냥하도록 빈 문자열(`reason: ''`)로 작성했다.
    ① QS-16 통과 → ② `@IsNotEmpty()`를 지우자 `expected 400, got 200`으로 실패 → ③ 원복 후 QS-16, DTO 단위 4개 통과

#### 동작 21. 변경 이력을 최신순으로 조회한다 (QS-17)

- [x] T176 [US4] 작성 + 실패 확인:
  ① E2E 작성: `it('이용권 좌석 변경 이력을 조회하면 변경자·시각·전후 값·사유가 최신순으로 나온다 (QS-17)')`
  ② E2E 실패 확인: E2E 단건(QS-17). 라우트가 없어 404이면 `ticket-seat.controller.ts`에 `@Get(':ticketId/seat-changes')`
     (`@Roles(Role.OWNER, Role.MANAGER)`, `ParseUUIDPipe`)와 빈 `getSeatChanges`를 둔다. 기대 사유: 빈 목록
  ③ 단위 작성: `ticket-seat.service.spec.ts`에 `it('이용권의 좌석 변경 이력을 최신순으로 반환한다')`
  ④ 단위 실패 확인: 단위 단건. 기대 사유: 이력 조회 쿼리가 호출되지 않음
  - 실제 실패(2026-10-23): E2E(QS-17) 1차 404 → 빈 라우트·서비스를 두고 2차 `Expected length: 2, Received length: 0` / 단위 이력 조회 호출 0회. 기대 사유와 같음
- [x] T177 [US4] 구현 + 통과 확인:
  ① 구현: `ticket-seat.repository.ts`에 이용권별 이력 조회(`changedAt desc`), `getSeatChanges(ticketId)`에서 반환 (SC-005)
  ② 단위 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-17) 통과
  - 결과(2026-10-23): `TicketSeatRepository.findSeatChanges`(`changedAt desc`) 추가. 단위 22개 통과, `tsc` 오류 없음, E2E(QS-17) 통과

### 일시정지·재개 (FR-018)

#### 동작 22. 고정석 이용권을 일시정지하면 지정을 해제한다 (QS-18)

- [x] T178 [US4] 작성 + 실패 확인:
  ① E2E 작성: `it('고정석 기간권을 일시정지하면 그 좌석이 선택 가능해진다 (QS-18)')`
  ② E2E 실패 확인: E2E 단건(QS-18). 기대 사유: 정지 후에도 `isAssignable = false`
  ③ 단위 작성: `src/ticket/ticket-pause/ticket-pause.service.spec.ts`(신규)에 `it('고정석 이용권을 일시정지하면 같은 트랜잭션에서 TICKET_PAUSED로 지정을 해제한다')`.
     목: `TicketPauseRepository`, `SessionLifecycleService`, BullMQ 큐, `SeatAssignmentService` 등 생성자 의존성
  ④ 단위 실패 확인: 단위 단건. 기대 사유: `releaseByTicket`이 호출되지 않음
  - 실제 실패(2026-10-23): E2E(QS-18) 정지 후 `isAssignable` `Expected true, Received false`(정지는 이용권 상태를 바꾸지 않아 배정이 유효하게 남음) / 단위 `releaseByTicket` 호출 0회. 기대 사유와 같음. 활성 기간권은 첫 입실로 준비한다
- [x] T179 [US4] 구현 + 통과 확인:
  ① 구현: `src/ticket/ticket-pause/ticket-pause.service.ts`의 `pauseTicket` 트랜잭션에 고정석이면 `releaseByTicket(TICKET_PAUSED)`
  ② 단위 통과 확인: 단위 단건 통과, `src/ticket/` 전체 회귀 없음
  ③ E2E 통과 확인: E2E 단건(QS-18) 통과
  - 결과(2026-10-23): `TicketPauseRepository.getTicketForUpdate`가 `seatType`·`shopId`(주문의 매장)도 조회하도록 SQL에 조인을 추가하고, 고정석이면 정지 트랜잭션에서 `releaseByTicket(TICKET_PAUSED)`. 단위 23개 통과, `tsc` 오류 없음, E2E QS-18과 기존 `ticket-pause` 10개 통과

#### 동작 23. 고정석 이용권을 재개할 때 좌석을 다시 지정한다

- [x] T180 [US4] 작성 + 실패 확인:
  ① 작성: `ticket-pause.service.spec.ts`에 `it('고정석 이용권을 재개하면 요청한 좌석으로 다시 지정한다')`
  ② 실패 확인: 단위 단건. `seatId`가 DTO에 없어 타입·whitelist 오류면 `src/ticket/ticket-pause/dto/resume-ticket.dto.ts`에
     `seatId?`(`@IsOptional() @IsUUID('4')`)만 두고 다시 확인한다. 기대 사유: `assign`이 호출되지 않음
  - 실제 실패(2026-10-23): `assign` 호출 0회. 기대 사유와 같음(서비스 인자를 직접 넘기는 단위 테스트라 DTO 오류는 생기지 않았다)
- [x] T181 [US4] 구현 + 통과 확인:
  ① 구현: `resumeTicket` 트랜잭션에서 고정석이면 `assign(dto.seatId, ticketId, now, tx)`. `ticket-pause.controller.ts`에서 `dto.seatId` 전달
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): `resumeTicket(ticketId, resumedBy, reason, seatId)`, 재개 트랜잭션 끝에서 고정석이면 `assign`. `ResumeTicketDto.seatId`(`@IsOptional() @IsUUID('4')`) 추가, 컨트롤러에서 전달. 단위 24개 통과, `tsc` 오류 없음

#### 동작 24. 고정석 이용권을 좌석 없이 재개하면 400

- [x] T182 [US4] 작성 + 실패 확인:
  ① 작성: `ticket-pause.service.spec.ts`에 `it('고정석 이용권을 좌석 없이 재개하면 SeatSelectionRequiredError다')`
  ② 실패 확인: 단위 단건. 기대 사유: `assign`이 `undefined` 좌석으로 호출되거나 예외 없음
  - 실제 실패(2026-10-23): `Received promise resolved instead of rejected`. 기대 사유와 같음
- [x] T183 [US4] 구현 + 통과 확인:
  ① 구현: 고정석이고 `seatId`가 없으면 `SeatSelectionRequiredError`
  ② 통과 확인: 단위 단건 통과, 파일 전체 회귀 없음
  - 결과(2026-10-23): 재개 상태 확인 직후(정지 해제·기한 연장 전) 고정석이고 `seatId`가 없으면 `SeatSelectionRequiredError`. 단위 25개 통과, `tsc` 오류 없음

#### 동작 25. 지정할 수 없는 좌석이면 재개를 거부하고 정지를 유지한다 (QS-19) — 동작 23으로 이미 통과

- [x] T184 [US4] 작성 + 조건 깨뜨리기:
  ① E2E 작성: `it('정지 중 그 좌석을 다른 이용자가 차지하면 재개가 409이고 정지가 유지된다 (QS-19)')`(상태 코드와 `error.code = SeatNotAssignableError` 검증)
  ② 조건 깨뜨리기: `assign`이 재개 트랜잭션 안에서 실패하면 롤백되므로 이미 통과한다. E2E 단건(QS-19) 통과를 확인한 뒤
     `assign` 호출을 재개 트랜잭션 커밋 뒤로 잠시 옮겨 정지가 풀린 채 남아 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 E2E 단건(QS-19) 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-23): ① QS-19 통과 → ② 재개의 `assign`을 커밋 뒤 별도 트랜잭션으로 옮기자 409는 그대로지만 정지 기록이 해제돼 `Received: null`로 실패 → ③ 원복 후 통과. 다른 이용자는 `otherUser`로 주문·결제한다

#### 동작 26. 자유석 이용권의 정지·재개는 기존과 같다 — 구현 전부터 통과

- [x] T185 [US4] 작성 + 조건 깨뜨리기:
  ① 작성: `ticket-pause.service.spec.ts`에 `it('자유석 이용권은 좌석 없이 재개하고 지정을 만들지 않는다')`
  ② 조건 깨뜨리기: 기존 재개 동작으로 통과하는 테스트다. 단건 통과를 확인한 뒤 동작 24의 "고정석이고" 조건을 잠시 지워(모든 이용권에 좌석 요구) 실패하는지 확인한다
  ③ 원복 후 통과 확인: 원복하고 파일 전체 통과. ②에서 실패하지 않으면 멈추고 사용자에게 알린다
  - 결과(2026-10-23): ① 통과 → ② 좌석 요구 조건에서 "고정석이고"를 지우자 `SeatSelectionRequiredError`로 실패 → ③ 원복 후 `ticket-pause.service` 4개 통과

#### US4 마무리

- [x] T186 [US4] `npm run test -- --testPathPatterns="ticket|seat"`, `npm run test:e2e -- --testPathPatterns=seat-type`, `npx eslint src`, `npm run build`를 실행해 모두 통과하는지 확인한다
  - 결과(2026-10-23): 단위 8개 파일 81개 통과, E2E 전체(병렬) 51개 중 50개 통과(기존 `app.e2e` 1건만 실패, `seat-type` 40개 모두 통과), `npm run build` 성공,
    `npx eslint src` 새로 생긴 오류 0건(US3 커밋 `249a171` 기준 66건 그대로)

**체크포인트**: 모든 사용자 스토리가 독립적으로 동작.

---

## Phase 7: 마무리 및 공통 점검

**목적**: 여러 스토리에 걸친 점검

- [x] T187 [P] `test/ticket-pause.e2e-spec.ts`, `test/app.e2e-spec.ts` 회귀를 실행한다. 좌석 등록 본문 필수화(T019)·상품 `seatType` 필수(US2 동작 1)로 깨지는 기존 테스트 준비 코드가 있으면, **기대값이 아니라 준비 데이터만** 고친다. 기대값 변경이 필요해 보이면 멈추고 사용자에게 확인한다. `test/app.e2e-spec.ts:20`의 기존 타입 오류는 이 기능과 무관하므로 건드리지 않는다
  - 결과(2026-10-23): E2E 전체 실행에서 `ticket-pause` 10개 모두 통과(준비 데이터 수정 불필요). `app.e2e`는 지시대로 건드리지 않았고 기존 `request is not a function`으로만 실패
- [x] T188 [P] 변경·신규 Swagger 데코레이터(`@ApiProperty`, `@ApiOperation`)의 설명을 한글로 채운다(`src/seat/`, `src/product/`, `src/order/`, `src/ticket/ticket-seat/`, `src/ticket/ticket-pause/`)
  - 결과(2026-10-23): Swagger CLI 플러그인이 없어(`nest-cli.json`) 데코레이터가 없는 라우트·필드는 문서에서 빠진다. 바뀐 라우트(주문 생성·취소·조회, 상품 목록, 이용권 정지·재개)에 한글 `@ApiOperation`,
    주문·이용권 정지 컨트롤러에 `@ApiTags`, 바뀐 DTO(`GetProductOutDto` 전 필드, `ResumeTicketDto`)에 한글 `@ApiProperty`를 넣었다. 새로 만든 데코레이터는 모두 한글 설명이다
- [x] T189 [P] 변경한 모든 함수에 한글 JSDoc(`@param`, `@returns`, `@throws`)과 논리 단계별 한글 인라인 주석이 있는지 점검한다
  - 결과(2026-10-23): 이번 기능에서 바꾼 함수 중 JSDoc이 없던 20개에 한글 JSDoc(`@param`·`@returns`·`@throws`)을 넣었다. 바로 위 한 줄 `//` 설명은 JSDoc 설명 줄로 옮기고,
    `RefundService.callback()` 위의 설계 설명 문단은 원래 `//` 형식 그대로 두고 JSDoc을 그 아래에 두었다. 바로 옆에 코드를 추가해 후보로 잡힌, 실제로 바꾸지 않은 함수는 제외했다
- [x] T190 `npx eslint .`, `npm run build`, `npm run test`, `npm run test:e2e`를 실행해 모두 통과를 확인한다
  - 결과(2026-10-23): `npm run build` 성공. `npx eslint .`는 133건 → 이번 기능의 E2E 파일 12건(타입 표기)을 고쳐 기능 작업 전 커밋 `22376e7`(145건)보다 적은 121건(오류 106·경고 15)으로 줄었으나,
    남은 오류는 모두 이 기능 이전부터 있던 것이다(`.remember/tmp/last-ndc.ts` 1건은 세션 기록 도구가 만든 파일). `npm run test`는 `src/user` 2건(기존 `ConfigService` 주입 누락),
    `npm run test:e2e`는 `app.e2e` 1건(기존 `request is not a function`)이 실패한다.
    사용자 결정(2026-10-23, A안): 이 기능 이전부터 있던 문제는 범위 밖(헌법 V)이므로 제외하고, 이 기능에서 생긴 문제가 없음을 기준으로 완료 처리한다
- [x] T191 [quickstart.md](./quickstart.md)의 QS-1~QS-31(27a·11a 등 알파벳 붙은 번호 포함)이 모두 E2E 테스트에 있는지, 그리고 "경우의 수 표" 1~3의 모든 칸에 QS 번호나 단위 테스트가 있는지 대조표로 확인한다. E2E 테스트 이름 끝에는 `(QS-n)`을 붙이고, 단위 테스트 이름에는 번호를 붙이지 않는다
  - 결과(2026-10-23): quickstart QS 40개(알파벳 번호 포함)가 E2E에 이름 끝 `(QS-n)`으로 정확히 하나씩 있고, 번호 없는 E2E·중복은 없다. 경우의 수 표 1·2의 모든 칸은 해당 QS로 검증된다.
    표 3의 "없음 → 일시정지 재개 → ACTIVE" 칸은 QS "18·19"로 적혀 있지만 QS-18은 일시정지, QS-19는 재개 실패라서, 재개 성공 후 재배정은
    단위 테스트(`ticket-pause.service.spec.ts` 「고정석 이용권을 재개하면 요청한 좌석으로 다시 배정한다」)로만 검증된다(표 규칙은 충족, 표 표기는 부정확)

---

## 의존 관계와 실행 순서

### 단계 의존

- **Phase 1 준비**: 의존 없음
- **Phase 2 기반**: Phase 1 완료 후. **모든 사용자 스토리를 막는다**
- **Phase 3~6 사용자 스토리**: Phase 2 완료 후
  - US1(P1): 다른 스토리에 의존하지 않음
  - US2(P2): 단위 테스트는 독립. E2E QS-24·25·31의 `isAssignable` 확인은 US1 동작 11 이후 가능
  - US3(P3): 고정석 이용권 준비에 US2(주문·결제) 경로를 쓰거나 DB로 직접 준비한다. 단위 테스트는 독립. QS-21은 US2 동작 26~29(환불)와 같은 파일을 고친다
  - US4(P3): 이용 중 시나리오(QS-13·14·15)는 US3의 입실 검증 이후 가능. 단위 테스트는 독립
- **Phase 7 마무리**: 모든 스토리 완료 후

### 스토리 안의 순서 (TDD)

- 동작과 구조 정리는 문서에 적힌 순서대로 진행한다. 뒤 동작의 기대 실패 사유는 앞 동작의 구현을 전제로 적혀 있다
- 한 동작 안에서는 task 1(작성 + 실패 확인)을 체크한 뒤에만 task 2(구현 + 통과 확인)를 시작한다
- 구조 정리 task(US2 주문·결제)는 회귀 확인까지 끝낸 뒤 다음 동작으로 간다
- E2E 하나를 여러 동작에 걸쳐 통과시키는 경우(QS-6: US2 동작 30~32, QS-30: US2 동작 38·39, QS-16a: US4 동작 15·16)는 첫 동작에서 E2E 실패를 확인하고 마지막 동작에서 통과를 확인한다

### 동시 진행 가능

- 한 동작 안의 두 task는 동시에 진행하지 않는다
- Phase 2 완료 후 스토리 단위로는 동시에 진행할 수 있다. 단, 같은 파일(`test/seat-type.e2e-spec.ts`, `src/refund/refund.service.spec.ts`, `src/seat-assignment/seat-assignment.service.spec.ts`)을 함께 고치는 스토리는 충돌에 주의한다
- 같은 스토리 안에서 서로 다른 파일만 다루는 동작 묶음은 나눠 진행할 수 있다. 예: US2의 상품(동작 1~10)과 환불 자동 취소(동작 26~29)
- Phase 7의 [P] task(회귀·Swagger·JSDoc)는 동시에 가능

---

## 병렬 예시: 사용자 스토리 2

```text
# 서로 다른 파일만 다루는 동작 묶음을 나눠 진행:
작업자 A: US2 동작 1~10   src/product/**, test/seat-type.e2e-spec.ts(QS-3·28·29)
작업자 B: US2 동작 26~29  src/refund/refund.service.ts, src/refund/refund.service.spec.ts
# 그 다음 한 줄로: 구조 정리(주문) → 동작 11~25(주문) → 구조 정리(결제) → 동작 30~40(결제, 환불 자동 취소 사용)
```

---

## 구현 전략

### MVP 먼저 (US1만)

1. Phase 1 준비 → Phase 2 기반
2. Phase 3 US1 (동작 1~11)
3. **멈추고 검증**: US1 마무리 task 통과, 기존 데이터가 모두 자유석인지 확인
4. 커밋 후 다음 스토리로

### 점진적 진행

US1 → US2 → US3 → US4 순서로, 동작마다 [작성 + 실패 확인] → [구현 + 통과 확인]을 돌고, 스토리 마무리 task 통과 후 커밋한다.

---

## 참고

- task 1은 실제 실패 사유(실패한 테스트 이름, 실제 사유, 기대 사유와 같은지)를 task 아래에 기록한 뒤 체크한다
- 빈 구현을 둔 경우 무엇을 비워 뒀는지 함께 기록한다
- 통과 확인에서 실패하면 구현을 고친다. 테스트 기대값을 바꿔야 한다고 판단되면 멈추고 사용자에게 확인한다(헌법 III)
- 조건 깨뜨리기에서 실패하지 않으면 테스트를 고치지 말고 멈춘 뒤 사용자에게 알린다
- 커밋 메시지는 한글로 작성한다(헌법 개발 흐름)
