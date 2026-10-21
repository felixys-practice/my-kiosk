# 데이터 모델: 좌석 타입(고정석·자유석) 추가

기준: `prisma/schema.prisma` 현재 모델. 아래는 추가·변경분만 적는다.

## 새 enum

| enum | 값 | 설명 |
|---|---|---|
| `SeatType` | `FIXED`, `FREE` | 좌석 타입. FIXED: 고정석, FREE: 자유석 |
| `SeatAssignmentStatus` | `HELD`, `ACTIVE`, `RELEASED` | 좌석 지정 상태. HELD: 주문 선점, ACTIVE: 이용권 확정, RELEASED: 해제 |
| `SeatReleaseReason` | `ORDER_CANCELLED`, `PAYMENT_FAILED`, `HOLD_EXPIRED`, `TICKET_EXPIRED`, `TICKET_EXHAUSTED`, `TICKET_REVOKED`, `TICKET_PAUSED`, `SEAT_TYPE_CHANGED`, `SEAT_MOVED` | 해제 사유 |
| `TicketSeatChangeType` | `TYPE_CHANGE`, `SEAT_MOVE` | 이용권 좌석 변경 종류. TYPE_CHANGE: 고정석 ↔ 자유석, SEAT_MOVE: 고정석 → 다른 고정석 |

## 기존 모델 변경

| 모델 | 추가 필드 | 타입 | 제약 | 관련 요구사항 |
|---|---|---|---|---|
| `Seat` | `type` (`@map("type")`) | `SeatType` | NOT NULL, DB 기본값 `FREE` | FR-001, FR-016 |
| `Seat` | `seatAssignments` | `SeatAssignment[]` | 관계 | |
| `Product` | `seatType` (`@map("seat_type")`) | `SeatType` | NOT NULL, DB 기본값 `FREE` | FR-005, FR-016 |
| `OrderItem` | `seatType` (`@map("seat_type")`) | `SeatType` | NOT NULL, DB 기본값 `FREE`. 구매 시점 상품 좌석 타입 스냅샷 | FR-006 |
| `Ticket` | `seatType` (`@map("seat_type")`) | `SeatType` | NOT NULL, DB 기본값 `FREE`. 현재 좌석 타입(점주 변경 시 갱신) | FR-010, FR-013 |
| `Ticket` | `seatAssignments`, `seatChanges` | 관계 | | |

DB 기본값 `FREE`는 기존 행 이전용이다(R11). 새 좌석·상품은 API DTO에서 타입을 필수로 받는다.

## 새 모델: `SeatAssignment` (좌석 지정)

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | String (uuid) | PK |
| `seatId` | String | 지정 좌석(FK → seats) |
| `orderItemId` | String? | 선점한 주문 항목(FK → order_items). 구매로 생긴 지정이면 값이 있다 |
| `ticketId` | String? | 확정된 이용권(FK → tickets). HELD 동안은 null |
| `status` | `SeatAssignmentStatus` | 기본 HELD |
| `heldUntil` | DateTime? | HELD 유효시간. 지나면 지연 해제 대상(R2) |
| `assignedAt` | DateTime? | ACTIVE 확정 시각 |
| `releasedAt` | DateTime? | 해제 시각 |
| `releaseReason` | `SeatReleaseReason?` | 해제 사유 |
| `createdAt`, `updatedAt` | DateTime | 공통 |

**제약·인덱스**
- 부분 유일 인덱스(raw SQL): `UNIQUE (seat_id) WHERE status IN ('HELD','ACTIVE')` — 좌석당 유효 지정 1개(FR-009, 동시 구매).
- 부분 유일 인덱스(raw SQL): `UNIQUE (ticket_id) WHERE status = 'ACTIVE'` — 이용권당 확정 지정 1개.
- 일반 인덱스: `(ticket_id, status)`, `(order_item_id)`.

**상태 전이**

```text
(주문 생성, 고정석) ──▶ HELD ──(결제 성공)──▶ ACTIVE ──(종료·정지·변경)──▶ RELEASED
                        ├──(뒤로 가기·취소)───────────────▶ RELEASED (ORDER_CANCELLED)
                        ├──(결제 실패)────────────────────▶ RELEASED (PAYMENT_FAILED)
                        └──(heldUntil 경과, 지연 판정)────▶ RELEASED (HOLD_EXPIRED)

(점주 변경: 자유석→고정석, 고정석 이동, 정지 재개) ──▶ ACTIVE (orderItemId 없이 ticketId로 바로 생성)
```

**ACTIVE → RELEASED 사유별 발생 지점**

| 사유 | 발생 지점 | 요구사항 |
|---|---|---|
| `TICKET_EXHAUSTED` | `SessionLifecycleService.endSession` 시간권 소진 전이와 같은 트랜잭션 | FR-017 |
| `TICKET_REVOKED` | `RefundService` 환불 확정(`callback`·`clearStaleLock`의 `confirmRefundSuccess`)과 같은 트랜잭션 | FR-017 |
| `TICKET_EXPIRED` | 좌석 선점·재지정·이동 시 지연 판정(R3) | FR-017 |
| `TICKET_PAUSED` | `TicketPauseService.pauseTicket` 트랜잭션 | FR-018 |
| `SEAT_TYPE_CHANGED` | 이용권 좌석 변경: 고정석 → 자유석 | FR-015 |
| `SEAT_MOVED` | 이용권 좌석 변경: 고정석 → 다른 고정석(기존 지정) | FR-015a |

**"유효한 지정" 판정** (좌석 선택 가능 여부 계산에 공통 사용)
- `HELD`이고 `heldUntil > now`, 또는
- `ACTIVE`이고 연결 이용권이 만료되지 않음: 상태가 `UNUSED`/`ACTIVE`이고, 기간권은 `expiresAt`(활성화 전이면 `activationDeadline`)이,
  시간권은 `minuteExpireDeadline`이 `now` 이후.
- 위에 해당하지 않는 `HELD`/`ACTIVE` 행은 같은 트랜잭션에서 `RELEASED`로 바꾼 뒤 새 지정을 만든다.

## 새 모델: `TicketSeatChange` (이용권 좌석 변경 이력)

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | String (uuid) | PK |
| `ticketId` | String | 대상 이용권(FK → tickets) |
| `changeType` | `TicketSeatChangeType` | 변경 종류 |
| `fromSeatType` / `toSeatType` | `SeatType` | 변경 전후 좌석 타입 |
| `fromSeatId` / `toSeatId` | String? | 변경 전후 지정 좌석(FK → seats). 자유석 쪽은 null |
| `reason` | String | 변경 사유(필수, 최대 500자) |
| `changedBy` | String | 변경자(FK → users) |
| `endedSessionId` | String? | 이 변경으로 종료된 이용 세션(FR-019). 없으면 null |
| `changedAt` | DateTime | 변경 시각 |

인덱스: `(ticket_id, changed_at)` — 이용권별 이력 조회(SC-005).

## 검증 규칙 (요구사항 → 규칙)

| 규칙 | 검증 위치 | 요구사항 |
|---|---|---|
| 좌석 등록 시 `type` 필수, `FIXED`/`FREE`만 허용 | `CreateSeatDto` | FR-002, FR-004 |
| 이용 중(활성 세션 있음)인 좌석은 타입·상태 변경 불가 | `SeatService.updateSeat` | FR-003, R8, R9 |
| 유효 지정이 있는 고정석은 자유석으로 변경 불가 | `SeatService.updateSeat` | 경계 상황 |
| 유효 지정이 있는 고정석은 "이용 불가"로 변경 불가 | `SeatService.updateSeat` | FR-022 |
| 상품 수정 시 이용권 종류(`ticketType`) 변경 불가, 바뀐 필드는 `ProductHistory`에 기록 | `UpdateProductDto` + `ProductService` | FR-005, R8 |
| 주문 취소는 결제 성공 전 주문만 가능, HELD 지정 즉시 해제 | `OrderService.cancelOrder` | R2 |
| 상품 등록 시 `seatType` 필수 | `CreateProductDto` | FR-005 |
| 고정석 상품 주문 줄은 `quantity = 1`, `seatId` 필수, 좌석은 같은 매장의 고정석이고 유효 지정이 없어야 함 | `CreateOrderDto` + `OrderService` | FR-007, FR-009, R4 |
| 자유석 상품 주문 줄은 `seatId`를 받지 않음 | `CreateOrderDto` | FR-008 |
| 입실: 고정석 이용권은 ACTIVE 지정 좌석만, 자유석 이용권은 자유석 좌석만 | `UsageSessionService.createSession` | FR-011 |
| 이용권 좌석 변경: 사유 필수, 고정석 대상이면 `seatId` 필수·유효 지정 없는 고정석 | `ChangeTicketSeatDto` + `TicketSeatService` | FR-013~015b, FR-020 |
| 재개: 고정석 이용권은 `seatId` 필수, 지정 불가 시 재개 거부 | `ResumeTicketDto` + `TicketPauseService.resumeTicket` | FR-018 |
