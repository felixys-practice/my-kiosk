# 구현 계획: 좌석 타입(고정석·자유석) 추가

**브랜치**: `feature/ticket-seat-kind` | **작성일**: 2026-10-21 | **명세**: [spec.md](./spec.md)

**입력**: `specs/001-seat-type/spec.md` 기능 명세

## 요약

좌석·상품·이용권에 좌석 타입(고정석 `FIXED` / 자유석 `FREE`)을 추가한다.
고정석 이용권은 특정 좌석 하나를 지정받고, 그 지정은 새 테이블 `SeatAssignment`(좌석 지정)로 관리한다.
좌석 지정은 주문 생성 시 임시 선점(HELD)되고, 결제 성공 시 이용권에 확정(ACTIVE)되며,
이용권 종료·일시정지·좌석 변경 시 해제(RELEASED)된다.
좌석당 유효한 지정 1개는 부분 유일 인덱스(partial unique index)로 DB 수준에서 보장한다.
점주의 이용권 좌석 변경(타입 변경·고정석 간 이동)은 새 API와 변경 이력 테이블 `TicketSeatChange`로 처리한다.
결제 요청 시 선점 유효성을 먼저 검사하고, 승인 후 좌석 충돌이 나면 기존 환불 경로로 자동 결제 취소한다(research R12).

## 기술 맥락

**언어/버전**: TypeScript 5.x (`strictNullChecks: true`, `module: nodenext`, target ES2023), Node.js

**주요 의존성**: NestJS, Prisma, class-validator·class-transformer, BullMQ(이용 세션 자동 종료 Job), date-fns

**저장소**: PostgreSQL 16 (Prisma 마이그레이션 + 부분 유일 인덱스는 raw SQL 마이그레이션), Redis 7(BullMQ 큐)

**테스트**: Jest 단위 테스트(`*.spec.ts`), Jest E2E 테스트(`test/*.e2e-spec.ts`, `test/jest-e2e.json`)

**대상 플랫폼**: Linux 서버(키오스크·점주 클라이언트가 호출하는 REST API)

**프로젝트 유형**: 웹 서비스(단일 NestJS 백엔드)

**성능 목표**: 기존 API 수준 유지. 좌석 지정 검증은 좌석·이용권 단건 조회와 인덱스 조회로 처리한다.

**제약**: 좌석 1개당 유효 지정 1개를 동시 요청에서도 보장해야 한다(spec 경계 상황 "동시 구매"). 기존 데이터는 모두 자유석(FR-016).

**규모/범위**: 매장당 좌석 수십~수백 개 수준. 모듈 영향 범위는 seat, product, order, payment, ticket(+ticket-pause), usage-session, session-lifecycle, refund.

## 헌법 점검 (Constitution Check)

*게이트: Phase 0 전에 통과해야 하며, Phase 1 설계 후 다시 점검한다.*

| 원칙 | 점검 내용 | 설계 전 | 설계 후 |
|---|---|---|---|
| I. 계층 구조 | 새 로직(좌석 지정, 이용권 좌석 변경)은 Controller → Service → Repository를 따른다. Prisma 쿼리는 Repository에만 둔다. | 통과 | 통과: `seat-assignment` 모듈과 `ticket-seat` 하위 모듈을 3계층으로 설계 |
| II. 입력 검증 | 새·변경 DTO는 class-validator로 검증한다(`IsEnum`, `IsUUID`, `ValidateIf`, `IsNotEmpty`). | 통과 | 통과: [contracts/rest-api.md](./contracts/rest-api.md)에 DTO별 검증 규칙 명시 |
| III. 테스트 (v1.1.0) | 단위·E2E 테스트를 함께 작성하고, 구현보다 먼저 작성해 실패를 확인하며, 구현 후 기대값을 임의로 바꾸지 않는다. | 통과 | 통과: [quickstart.md](./quickstart.md)의 시나리오를 E2E로, 서비스 규칙을 단위 테스트로 작성한다. 작성 순서(테스트 → 실패 확인 → 구현)는 `/speckit-tasks`에서 사용자 스토리마다 테스트 작업을 구현 작업 앞에 두어 보장한다 |
| IV. 운영 수준 코드 | 축약·생략이 있으면 사용자 확인을 받는다. | **확인 필요** | 통과: [research.md](./research.md)의 R2·R3·R4·R8·R9 모두 2026-10-21 사용자 확인 완료 |
| V. 단순성 | 요청 범위만 구현한다. | 통과 | 통과: 상품 수정 API·좌석 상태 변경 API는 사용자 요청으로 포함(R8). 이용권 만료 배치는 만들지 않는다(R3) |
| 기술 제약 | NestJS, Prisma, PostgreSQL, Redis 외 도입 없음 | 통과 | 통과 |
| 개발 흐름 | 기능 브랜치, 한글 커밋 | 통과 | 통과 |

설계 전 원칙 IV는 사용자 확인 대기 상태였고, 설계 후 확인이 모두 끝나 게이트를 통과했다.

## 프로젝트 구조

### 문서 (이 기능)

```text
specs/001-seat-type/
├── plan.md              # 이 파일
├── research.md          # Phase 0 결과
├── data-model.md        # Phase 1 결과
├── quickstart.md        # Phase 1 결과
├── contracts/
│   └── rest-api.md      # Phase 1 결과
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 결과 (/speckit-tasks에서 생성)
```

### 소스 코드 (저장소 루트)

```text
prisma/
├── schema.prisma                         # SeatType enum, Seat/Product/OrderItem/Ticket 필드, SeatAssignment, TicketSeatChange
└── migrations/<timestamp>_add_seat_type/ # 컬럼 추가(기본값 FREE) + 부분 유일 인덱스 raw SQL

src/
├── seat/                                 # 좌석 등록·수정 DTO에 type·status, 이용 중·지정 가드, 조회 결과에 type
├── seat-assignment/                      # 신규: 좌석 지정(선점·확정·해제·유효성 판정) Service/Repository
├── product/                              # 상품 등록 DTO에 seatType, 상품 수정 API(신규) + ProductHistory 기록
├── order/                                # 주문 DTO에 seatId, 고정석 검증 + HELD 선점, 주문 취소 API(신규)
├── payment/                              # 결제 요청 시 선점 검사, 성공 시 HELD → ACTIVE, 실패 시 해제, 충돌 시 자동 환불 호출(R12)
├── ticket/
│   ├── ticket-seat/                      # 신규: 이용권 좌석 변경 API + 변경 이력 조회
│   └── ticket-pause/                     # 일시정지 시 해제, 재개 시 고정석 재지정
├── usage-session/                        # 입실 시 좌석 타입·지정 좌석 검증
├── session-lifecycle/                    # 시간권 소진(EXHAUSTED) 시 지정 해제
└── refund/                               # 환불 확정(REVOKED) 시 지정 해제, `refundBySystem` 추가·`RefundService` export(R12)

test/
└── seat-type.e2e-spec.ts                 # 신규 E2E (quickstart 시나리오)
```

**구조 결정**: 기존 단일 NestJS 프로젝트의 도메인 모듈 구조를 따른다.
좌석 지정은 order·payment·ticket·usage-session·refund가 함께 쓰므로 별도 모듈 `seat-assignment`로 분리해 각 모듈이 명시적으로 import한다(CLAUDE.md: `@Global()`은 Prisma·Redis만).

## 복잡도 추적

헌법 위반이 없으므로 작성하지 않는다.
