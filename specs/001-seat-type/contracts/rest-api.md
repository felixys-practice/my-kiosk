# REST API 계약: 좌석 타입(고정석·자유석) 추가

응답은 기존 `TransformInterceptor` 형식(`{ success, statusCode, data, timestamp, path }`)을 따른다.
오류는 기존 도메인 에러 클래스(`DomainBadRequestError` 400, `DomainNotFoundError` 404, `DomainConflictError` 409)를 상속한
사유별 에러로 반환하고, 응답의 `error.code`에는 에러 클래스 이름이 들어간다(헌법 VI).
같은 사유는 엔드포인트가 달라도 같은 코드를 쓴다. DTO 형식 검증(`ValidationPipe`) 실패는 공통 코드를 쓰므로 아래 표에 적지 않는다.

## 1. 좌석

### `POST /shops/:shopId/seats` — 좌석 등록 (변경)

요청 본문 `CreateSeatDto`

| 필드 | 타입 | 필수 | 검증 |
|---|---|---|---|
| `name` | string | 아니오 | 기존과 같음 |
| `number` | number | 아니오 | 기존과 같음 |
| `type` | `FIXED` \| `FREE` | **예** | `IsEnum(SeatType)` (FR-002, FR-004) |

- 기존에는 본문 자체가 선택이었으나, `type`이 필수가 되므로 본문이 필수가 된다.

### `PATCH /seats/:seatId` — 좌석 수정 (변경)

`UpdateSeatDto`에 추가:

| 필드 | 타입 | 필수 | 검증 |
|---|---|---|---|
| `type` | `FIXED` \| `FREE` | 아니오 | `IsOptional`, `IsEnum(SeatType)` |
| `status` | `AVAILABLE` \| `UNAVAILABLE` | 아니오 | `IsOptional`, `IsEnum(SeatStatus)` (신규, R8) |

| 오류 | 조건 | `error.code` |
|---|---|---|
| 404 | 좌석 없음 | `SeatNotFoundError` |
| 409 | 이용 중(활성 세션 있음)인 좌석의 `type`·`status` 변경 (FR-003, R9) | `SeatAlreadyOccupiedError` |
| 409 | 유효 지정(HELD/ACTIVE)이 있는 고정석을 자유석으로 변경 | `SeatHasAssignmentError` |
| 409 | 유효 지정이 있는 고정석을 `UNAVAILABLE`로 변경 (FR-022) | `SeatHasAssignmentError` |

### `GET /shops/:shopId/seats` — 좌석 목록 (변경)

응답 항목 `GetSeatOutDto`에 추가:

| 필드 | 타입 | 설명 |
|---|---|---|
| `type` | `FIXED` \| `FREE` | 좌석 타입 (FR-012) |
| `isAssignable` | boolean | 고정석이면 유효 지정이 없어 선택 가능한지. 자유석은 항상 false |

## 2. 상품

### `POST /shops/:shopId/products` — 상품 등록 (변경)

`CreateProductDto`에 `seatType: FIXED | FREE` 추가(필수, `IsEnum`). (FR-005)

### `GET /shops/:shopId/products` — 상품 목록 (변경)

응답 항목에 `seatType` 추가.

### `PATCH /shops/:shopId/products/:productId` — 상품 수정 (신규, R8)

권한: `@Roles(Role.OWNER, Role.MANAGER)`

요청 본문 `UpdateProductDto`: `CreateProductDto`의 필드 중 `type`(이용권 종류)을 뺀 나머지를 모두 선택 입력으로 받는다
(`name`, `amount`, `usableDays`, `isActive`, `purchasedMinutes`, `purchasedDurationDays`, `seatType`).

- 바뀐 필드마다 `ProductHistory` 1행(같은 `changeGroupId`)을 기록한다.

| 오류 | 조건 | `error.code` |
|---|---|---|
| 400 | 시간권 상품에 `purchasedDurationDays`, 기간권 상품에 `purchasedMinutes`를 보냄 | `ProductFieldMismatchError` |
| 404 | 상품 없음, 삭제된 상품(`deletedAt` 있음), 다른 매장 상품 | `ProductNotFoundError` |

## 3. 주문

### `POST /orders` — 주문 생성 (변경)

`orderedProducts[]` 항목을 DTO 클래스로 만들고 중첩 검증한다(`ValidateNested`, `Type`).

| 필드 | 타입 | 필수 | 검증 |
|---|---|---|---|
| `productId` | uuid | 예 | `IsUUID('4')` |
| `quantity` | number | 예 | `IsInt`, `Min(1)` |
| `seatId` | uuid | 고정석 상품이면 예 | `IsOptional`, `IsUUID('4')`. 필수 여부는 상품 조회 후 서비스에서 검사 |

| 오류 | 조건 | `error.code` |
|---|---|---|
| 400 | 고정석 상품 주문 항목에 `seatId` 없음 | `SeatSelectionRequiredError` |
| 400 | 고정석 상품 주문 항목의 `quantity`가 1이 아님 | `FixedSeatQuantityError` |
| 400 | 자유석 상품 주문 항목에 `seatId` 있음 | `SeatNotAllowedError` |
| 400 | 선택한 좌석이 다른 매장 좌석 | `SeatShopMismatchError` |
| 400 | 선택한 좌석이 자유석 | `SeatTypeMismatchError` |
| 409 | 선택한 좌석에 유효 지정이 있음(이미 지정·선점됨) | `SeatNotAssignableError` |
| 409 | 같은 주문에서 같은 좌석을 중복 선택 | `DuplicateSeatInOrderError` |

- 성공 시 고정석 상품 주문 항목마다 `SeatAssignment(HELD, heldUntil = now + 선점 유효시간)`을 같은 트랜잭션에서 만든다.

### `PATCH /orders/:orderId/cancel` — 주문 취소 (신규, R2)

키오스크에서 이용자가 뒤로 가기·취소할 때 호출한다. 요청 본문 없음.

- 주문의 HELD 지정을 모두 `RELEASED(ORDER_CANCELLED)`로 바꾼다. 이미 해제됐으면 그대로 성공한다(멱등).
- 진행 중인 결제(`REQUESTED`)는 기존 결제 흐름대로 두고, 이후 승인 콜백이 오면 결제 콜백 규칙(아래 4절)을 따른다.

| 오류 | 조건 | `error.code` |
|---|---|---|
| 404 | 주문 없음 | `OrderNotFoundError` |
| 409 | 결제가 이미 성공(SUCCESS)한 주문 (환불은 기존 환불 API 사용) | `OrderAlreadyPaidError` |

## 4. 결제

### `POST /payments/callback` — 결제 결과 콜백 (동작 변경, 계약 변경 없음)

- 승인 성공: 이용권 생성과 같은 트랜잭션에서 주문 항목의 HELD 지정을 `ACTIVE`로 바꾸고 `ticketId`를 연결한다.
  이용권 `seatType`은 주문 항목 스냅샷에서 복사한다.
- 승인 실패: 주문 항목의 HELD 지정을 `RELEASED(PAYMENT_FAILED)`로 바꾼다.
- HELD가 이미 만료·해제된 상태에서 승인 성공이 오면, 같은 좌석에 다른 유효 지정이 없으면 다시 ACTIVE로 만든다.
- 다른 유효 지정이 있으면(좌석을 줄 수 없음) 결제는 SUCCESS로 두고 이용권을 발급한 뒤, 커밋 후 그 이용권을
  `RefundService.refundBySystem`으로 자동 환불한다(PG 승인 취소, 기존 환불 흐름). (research R12-A)

### `POST /payments` — 결제 요청 (동작 변경, 계약 변경 없음)

- VAN 요청 전에 주문의 고정석 HELD가 모두 유효한지 확인한다. 하나라도 만료·해제됐으면 409로 거부하고,
  해당 HELD를 `RELEASED(HOLD_EXPIRED)`로 바꾼다. (research R12-C)

| 오류 | 조건 | `error.code` |
|---|---|---|
| 409 | 주문의 고정석 선점이 만료·해제됨 | `SeatHoldExpiredError` |

- 시스템 자동 취소(`RefundService.refundBySystem`)는 결제 콜백 안에서 내부 호출되며 API 응답으로 나가지 않으므로 헌법 VI의 대상이 아니다.

## 5. 이용 세션

### `POST /usage-sessions` — 입실 (동작 변경, 계약 변경 없음)

| 오류 | 조건 | `error.code` | 요구사항 |
|---|---|---|---|
| 400 | 이용권과 좌석의 타입이 다름(자유석 이용권으로 고정석, 고정석 이용권으로 자유석) | `SeatTypeMismatchError` | FR-011 |
| 400 | 고정석 이용권인데 요청 좌석이 ACTIVE 지정 좌석이 아님 | `NotAssignedSeatError` | FR-011 |
| 400 | 고정석 이용권인데 ACTIVE 지정 좌석이 없음(자동 취소 대기 중, R12) | `TicketSeatUnassignedError` | FR-011 |

## 6. 이용권

### `GET /tickets/:id` — 이용권 조회 (변경)

응답에 추가: `seatType`(`FIXED` \| `FREE`), `assignedSeat`(`{ id, number, name } | null`). (FR-010)

### `PATCH /tickets/:ticketId/seat` — 이용권 좌석 변경 (신규)

권한: `@Roles(Role.OWNER, Role.MANAGER)` (기존 일시정지 API와 같음)

요청 본문 `ChangeTicketSeatDto`

| 필드 | 타입 | 필수 | 검증 |
|---|---|---|---|
| `seatType` | `FIXED` \| `FREE` | 예 | `IsEnum(SeatType)` |
| `seatId` | uuid | `seatType = FIXED`이면 예 | `ValidateIf(seatType === FIXED)`, `IsUUID('4')` |
| `reason` | string | 예 | `IsNotEmpty`, `IsString`, `MaxLength(500)` (FR-020) |

동작

| 현재 → 요청 | 처리 | 이용 중일 때 |
|---|---|---|
| FREE → FIXED | 새 ACTIVE 지정 생성, 이용권 `seatType = FIXED` | 즉시 퇴실 (FR-019) |
| FIXED → FREE | 기존 지정 RELEASED(SEAT_TYPE_CHANGED), `seatType = FREE` | 즉시 퇴실 (FR-019) |
| FIXED → FIXED(다른 좌석) | 기존 지정 RELEASED(SEAT_MOVED), 새 ACTIVE 지정 | 세션 유지, 세션 좌석만 변경 (FR-015b) |

모든 경우 `TicketSeatChange` 1행을 기록한다(FR-021).

사유 없음, FIXED인데 `seatId` 없음은 DTO 형식 검증(400, 공통 코드)으로 거부한다.

| 오류 | 조건 | `error.code` |
|---|---|---|
| 400 | 대상 좌석이 다른 매장 좌석 | `SeatShopMismatchError` |
| 400 | 대상 좌석이 자유석 | `SeatTypeMismatchError` |
| 400 | 바뀌는 것 없음(현재와 같은 타입·같은 좌석) | `TicketSeatUnchangedError` |
| 400 | 이용권이 종료 상태(EXPIRED·EXHAUSTED·REVOKED) | `TicketClosedError` |
| 400 | 이용권이 일시정지 중 | `TicketPausedError` |
| 404 | 이용권 없음 | `TicketNotFoundError` |
| 404 | 좌석 없음 | `SeatNotFoundError` |
| 409 | 대상 좌석에 유효 지정이 있음 | `SeatNotAssignableError` |
| 409 | (이동 시) 대상 좌석에 다른 이용자의 활성 세션이 있음 | `SeatAlreadyOccupiedError` |

### `GET /tickets/:ticketId/seat-changes` — 이용권 좌석 변경 이력 (신규)

권한: `@Roles(Role.OWNER, Role.MANAGER)`. 응답: `TicketSeatChange` 목록(최신순). (SC-005)

### `PATCH /tickets/:ticketId/resume` — 일시정지 재개 (변경)

`ResumeTicketDto`에 `seatId?: uuid` 추가(`IsOptional`, `IsUUID('4')`).

| 오류 | 조건 | `error.code` | 요구사항 |
|---|---|---|---|
| 400 | 고정석 이용권인데 `seatId` 없음 | `SeatSelectionRequiredError` | FR-018 |
| 409 | 지정할 수 있는 고정석이 아님(유효 지정 있음). 재개 거부, 정지 유지 | `SeatNotAssignableError` | FR-018 |

### `PATCH /tickets/:ticketId/pause` — 일시정지 (동작 변경, 계약 변경 없음)

고정석 이용권이면 같은 트랜잭션에서 ACTIVE 지정을 `RELEASED(TICKET_PAUSED)`로 바꾼다. (FR-018)
