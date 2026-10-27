# 작업 목록: 환불 기능 완료

**작성일**: 2026-10-27  
**입력**: [명세](spec.md), [계획](plan.md), [데이터 모델](data-model.md), [조사](research.md), [API 계약](contracts/rest-api.md), [HTTP 검증 목록](quickstart.md)  
**범위**: 10개 사용자 스토리·92개 인수 시나리오·60개 기능 요구사항·25개 성공 기준. 아래 경로는 저장소 루트 기준이다. 존재하지 않는 파일 경로는 이번 구현에서 생성할 예정이다.

## 실행 규칙

- 모든 작업은 미완료 상태다. 이 문서는 구현·테스트 실행 결과가 아니다.
- 테스트는 필수다. 각 스토리의 테스트 목록은 실행할 동작 목록이며, 모두 작성한 뒤 한꺼번에 구현하라는 뜻이 아니다. **동작 하나의 테스트 작성 → 의도한 실패 확인 → 해당 동작의 최소 구현 → 전체 회귀 → 필요한 리팩터링**을 반복한다. 아래 구현 작업은 담당 범위를 묶은 것이며 연결된 테스트가 모두 통과한 뒤 체크한다.
- 실제 실패 명령·출력은 `specs/002-refund-completion/tdd/cycle-log.md`에 누적한다. 세부 동작 ID와 사이클 순서는 `/speckit-tdd-plan`에서 정한다.
- E2E 이름 끝에 `(QS-스토리번호-시나리오번호)`를 붙인다. 아래 각 시나리오에 최소 한 개의 HTTP 호출 테스트를 둔다. 한 시나리오에 여러 조건이 있으면 각각 검증한다. 단위 테스트에는 QS 번호를 붙이지 않는다.
- 거부 E2E는 HTTP 상태와 `error.code`를 함께 확인한다. DTO 형식 오류는 상태 코드만 확인한다. 단위 테스트는 도메인 에러 클래스를 확인한다. 정확한 대응은 API 계약 §10이다.
- DB를 읽어 저장 결과를 확인할 수 있지만, 서비스 직접 호출만으로 HTTP 인수 테스트를 대체하지 않는다. 자동 작업 시나리오는 HTTP로 환불을 접수하고 테스트 시계·작업자를 진행한 후 HTTP 조회와 DB 기록으로 확인한다.
- 테스트 실행 명령은 `.specify/memory/tdd-profile.md`를 따른다. 공유 PostgreSQL·Redis를 쓰는 E2E는 동시에 실행하지 않는다.
- `[P]`는 아래 병렬 실행 표에 지정한 선행 작업 완료 후 서로 다른 파일을 수정할 수 있다는 뜻이다. 같은 파일 변경, 스키마 변경, 실제 TDD 실행 사이클은 직렬화한다.
- 실제 PG·은행 연결, 송금 실행, 초과액 회수, 매출 원장·정산 배치는 구현 범위 밖이다. PG 외 수단 지급은 운영자의 예약과 외부 지급 결과 등록까지 구현한다.

## Phase 1: 준비

**목적**: 기존 구현과 테스트 환경을 확인하고 재현 가능한 환불 테스트 기반을 마련한다.

- [ ] T001 기존 `src/refund/refund.service.ts`, `src/payment/payment.service.ts`, `src/pg/pg.service.ts`, `prisma/schema.prisma`와 테스트 기준선을 확인하고 `specs/002-refund-completion/tdd/baseline.md`에 실행 결과·기존 실패·새 계약으로 바뀌는 동작을 기록한다.
- [ ] T002 `test/helpers/refund-test-context.ts`에 앱 부트스트랩·USER/OWNER/MANAGER·공동 점주·시간권/정기권·고정석 fixture와 자기 데이터만 정리하는 종료 절차를 만든다. 기존 `test/seat-type.e2e-spec.ts`와 같은 필터·파이프·응답 래핑을 적용한다.
- [ ] T003 `test/helpers/refund-pg.stub.ts`에 송신·조회 결과, 호출된 PG 취소 요청 식별자·금액, 응답 지연과 중단을 제어하는 테스트 전용 PG 대역을 만든다. 실제 운영 코드에 성공 스위치를 추가하지 않는다.
- [ ] T004 `src/config/validation.schema.spec.ts`와 `src/config/configuration.spec.ts`에 API 계약 §8의 14개 설정 기본값과 경계 검증을 추가하고 동작별 실패를 확인한다.
- [ ] T005 `src/config/configuration.ts`, `src/config/validation.schema.ts`, `.env.example`에 API 계약 §8 설정을 반영한다. 시간·횟수는 양의 정수, 재전송 한도는 0 이상, 비밀값은 최소 32자이며 `lease>timeout`, `interval>=sweep+timeout`, `backoffCap>=backoffBase`를 검증한다.

## Phase 2: 기반

**목적**: 환불 확정·PG 요청·외부 지급 예약을 구분하는 저장 모델과 공통 처리 계약을 만든다. 이 단계 완료 후 사용자 스토리를 시작한다.

- [ ] T006 `src/prisma/refund-constraints.integration.spec.ts`에 대상별 확정 환불 1건, 활성 PG 요청 1건, 활성 외부 지급 예약 1건, 실제 거래 식별자·원장 중복 금지와 음수 금지 테스트를 먼저 작성한다. 데이터 모델 §6·8의 제약을 검증용 DB에서 하나씩 확인한다.
- [ ] T007 `prisma/schema.prisma`와 신규 `prisma/migrations/20261027000100_refund_completion_expand/migration.sql`에 Refund를 추가한다. 데이터 모델 §3의 모든 필드를 반영하며 `amount`는 “Int, 0 이상, 확정 뒤 불변”, `paidAmount`는 “Int, 0 이상”, `decisionStatus`는 “ACCEPTED / LEGACY_REJECTED”, `payoutStatus`는 “PENDING / ACTION_REQUIRED / PAID / NOT_APPLICABLE”, `payoutMethod`는 “PG / MANUAL”이다. `NOT_APPLICABLE`은 과거 거절만, PAYMENT 대상 상품 ID는 null, 이용권 있는 신규 환불의 종료 시각은 필수다. 신규 CUSTOMER/STORE의 실행자·종료 동의를 보존한다.
- [ ] T008 `prisma/schema.prisma`와 동일 확장 마이그레이션에 Payment.approvedAmount “Int?”, PaymentCancel.refundId·시도 번호·실제액·실패 사유·조회/전송 횟수·일정·담당 토큰을 데이터 모델 §4대로 추가한다. 상태는 “REQUESTED / QUERY_FAILED / SUCCEEDED / FAILED”, actualAmount는 “확인 전 null”, 신규 refundId는 “필수 FK”, 과거 거절 이력만 이관 기간 null 허용이다. 기존 PK·PG 취소 거래 ID와 실패 이력을 보존한다.
- [ ] T009 `prisma/schema.prisma`와 동일 확장 마이그레이션에 ManualRefundPayout의 모든 필드를 데이터 모델 §5대로 추가한다. 상태는 “RESERVED / SUCCEEDED / FAILED”, amount는 “예약 시 Refund 미지급액과 같고 이후 불변, 양수”, externalTransactionId는 “성공 기록에서 전역 unique”다. TicketPause에 종료 기록 closedAt·closeReason을 추가해 재개 없이 REFUND_TERMINATED로 닫을 수 있게 한다.
- [ ] T010 `prisma/schema.prisma`와 동일 확장 마이그레이션에 Ledger의 refundId·manualRefundPayoutId, RefundNotification·Receipt, RefundRecoveryControl, DB 멱등 요청 기록을 추가한다. 데이터 모델 §6·8의 partial unique·FK·금액 CHECK를 적용하고 Receipt `(notificationId,userId)` PK, 멱등 `(requesterId,operation,key)` unique를 보장한다. PG·외부 지급 원장은 둘 중 한 지급만 연결하고 0원은 둘 다 null·amount=0·refundId별 1건이다.
- [ ] T011 `src/refund/refund-idempotency.service.spec.ts`에 같은 키·같은 본문 재응답, 다른 본문 거절, 처리 중 응답, 현재 권한 재검사, Redis 만료 후에도 중복 환불 방지 테스트를 작성한다.
- [ ] T012 `src/refund/refund-idempotency.service.ts`, `src/refund/refund-idempotency.repository.ts`에 DB 기반 요청 기록과 최초 응답 재반환을 구현한다. 키는 “1~128자 ASCII 비공백”, 해시는 대상·금액·trim 사유·동의를 포함하고 거절된 동의 확인 요청은 이후 유효한 요청을 막지 않는다. 기존 `src/common/interceptors/idempotency.interceptor.ts`의 다른 도메인 동작은 유지한다.
- [ ] T013 `src/common/filters/http-exception.filter.spec.ts`, `src/refund/refund-access.service.spec.ts`에 명시적 오류 코드 보존, 역할 부족 403, 소유 범위 밖 404와 재요청 오류 우선순위 테스트를 작성한다.
- [ ] T014 `src/common/filters/http-exception.filter.ts`, `src/refund/errors/refund.error.ts`, `src/refund/refund-access.service.ts`, `src/refund/refund.repository.ts`에 계약 §10 오류와 현재 ShopOwner·본인·MANAGER 조회 범위를 구현한다. 필터는 `error.code ?? error.name`을 사용하고 기존 도메인 오류를 보존한다.
- [ ] T015 `src/pg/pg.service.spec.ts`에 일반 HTTP 404·조회 지연·인증 오류를 확실한 미접수로 오인하지 않는 동작과 실제 취소 금액 누락 거절을 테스트한다.
- [ ] T016 `src/pg/pg.types.ts`, `src/pg/pg.service.ts`에 송신 NOT_SENT/ACCEPTED/UNKNOWN/SUCCEEDED/REJECTED와 조회 SUCCEEDED/FAILED/IN_PROGRESS/NOT_FOUND/QUERY_ERROR 계약을 구현한다. NOT_FOUND는 authoritative=true가 필수이며 미연동은 명시적 전송 전 실패·조회 오류다.
- [ ] T017 `src/refund/refund-locking.repository.ts`, `src/session-lifecycle/session-lifecycle.repository.ts`에 Payment → Ticket → TicketPause → UsageSession → SeatAssignment → Refund → PaymentCancel → ManualRefundPayout 잠금과 같은 종류 ID 순 잠금을 제공한다. Service에 직접 DB 잠금 쿼리를 두지 않고 외부 PG 호출 중에는 트랜잭션을 유지하지 않는다. `src/refund/refund-locking.repository.spec.ts`로 잠금 순서 계약을 확인한다.
- [ ] T018 `src/refund/refund.module.ts`, `src/session-lifecycle/session-lifecycle.module.ts`, `src/pg/pg.module.ts`에 공통 Repository와 PG 대역 교체 지점을 연결한다. 새 서비스는 도입되는 스토리에서 등록하고 다른 도메인과 순환 의존이 생기지 않는지 `test/refund-bootstrap.e2e-spec.ts`에서 검증한다.

**체크포인트**: 검증용 DB에서 신규 모델을 쓸 수 있고 공통 권한·멱등·PG 계약이 검증됐다. 실제 데이터 이관과 기존 RefundLock 제거는 마지막 전환 단계에서 수행한다.

## Phase 3: 사용자 스토리 1 — 고객 환불 판정과 이용 종료 확정 (P1)

**목표·독립 테스트 기준**: 미사용·기한 안의 본인 이용권만 전액 환불을 확정하고, 거절은 업무 데이터를 변경하지 않는다.

**테스트 입력**: quickstart의 이 스토리 데이터와 spec의 Given/When 조건을 함께 사용한다. 아래 기대 결과는 조건을 대체하지 않는다. 뒤 스토리 서비스가 필요한 경우 하단 의존 관계에 따라 통합 검증한다.

### HTTP 인수 테스트

- [ ] T019 [US1] E2E: `test/refund-customer.e2e-spec.ts`에 명세 1-1의 Given/When으로 요청하고 다음 결과를 검증한다: 실결제액 전액 환불과 이용 종료가 확정되고 고정석 배정이 해제되며, 응답은 "이용 종료 완료·환불금 지급 처리 중"이다. 테스트 이름 끝에 `(QS-1-1)`를 붙인다.
- [ ] T020 [US1] E2E: `test/refund-customer.e2e-spec.ts`에 명세 1-1a의 Given/When으로 요청하고 다음 결과를 검증한다: 동의가 필요하다는 오류로 거절되고 이용권·좌석·환불 기록에는 변화가 없다. 테스트 이름 끝에 `(QS-1-1a)`를 붙인다.
- [ ] T021 [US1] E2E: `test/refund-customer.e2e-spec.ts`에 명세 1-2의 Given/When으로 요청하고 다음 결과를 검증한다: 찾을 수 없는 이용권으로 거절되고, 그 이용권이 있다는 사실은 드러나지 않는다. 테스트 이름 끝에 `(QS-1-2)`를 붙인다.
- [ ] T022 [US1] E2E: `test/refund-customer.e2e-spec.ts`에 명세 1-3의 Given/When으로 요청하고 다음 결과를 검증한다: `PAYMENT_NOT_COMPLETED`로 거절된다. 테스트 이름 끝에 `(QS-1-3)`를 붙인다.
- [ ] T023 [US1] E2E: `test/refund-customer.e2e-spec.ts`에 명세 1-4의 Given/When으로 요청하고 다음 결과를 검증한다: `ALREADY_REFUNDED`로 거절된다. 테스트 이름 끝에 `(QS-1-4)`를 붙인다.
- [ ] T024 [US1] E2E: `test/refund-customer.e2e-spec.ts`에 명세 1-5의 Given/When으로 요청하고 다음 결과를 검증한다: `REFUND_IN_PROGRESS`로 거절된다. 테스트 이름 끝에 `(QS-1-5)`를 붙인다.
- [ ] T025 [US1] E2E: `test/refund-customer.e2e-spec.ts`에 명세 1-6의 Given/When으로 요청하고 다음 결과를 검증한다: `USED_TICKET`으로 거절되고 매장에 환불을 요청하라고 안내되며, 환불 기록은 남지 않는다. 테스트 이름 끝에 `(QS-1-6)`를 붙인다.
- [ ] T026 [US1] E2E: `test/refund-customer.e2e-spec.ts`에 명세 1-7의 Given/When으로 요청하고 다음 결과를 검증한다: `USED_TICKET`으로 거절된다. 테스트 이름 끝에 `(QS-1-7)`를 붙인다.
- [ ] T027 [US1] E2E: `test/refund-customer.e2e-spec.ts`에 명세 1-8의 Given/When으로 요청하고 다음 결과를 검증한다: `EXPIRED_TICKET`으로 거절되고 매장에 환불을 요청하라고 안내된다. 테스트 이름 끝에 `(QS-1-8)`를 붙인다.
- [ ] T028 [US1] E2E: `test/refund-customer.e2e-spec.ts`에 명세 1-9의 Given/When으로 요청하고 다음 결과를 검증한다: 대상 여부 규칙이 먼저 적용되어 `USED_TICKET`이 아니라 `REFUND_IN_PROGRESS`로 거절된다. 테스트 이름 끝에 `(QS-1-9)`를 붙인다.

### 단위 테스트와 구현

- [ ] T029 [US1] `src/refund/refund-policy.spec.ts`에 대상 검증 순서·미사용 판정·신청 시각=기한 시각 경계·USED_TICKET 우선·위반 사유 목록을 동작별 테스트로 추가한다.
- [ ] T030 [US1] `src/refund/refund-policy.ts`에 본인 범위→결제 SUCCESS→PAID 환불→미지급 ACCEPTED→사용/기한 조건 순 판정을 구현한다. PERIOD.activationDeadline과 TIME.minuteExpireDeadline을 사용하고 기한과 같은 시각은 허용한다. 가능 조건 거절에는 CONTACT_SHOP과 violations를 반환한다.
- [ ] T031 [US1] `src/refund/dto/refund.dto.ts`와 `src/refund/dto/refund.dto.spec.ts`에 ticketId UUID와 boolean 종료 동의를 반영한다. amount·userId·shopId 주입을 거부하고 동의 false/누락은 REFUND_TERMINATION_CONSENT_REQUIRED로 처리한다.
- [ ] T032 [US1] `src/refund/refund-acceptance.service.ts`, `src/refund/refund.repository.ts`에 검증·금액/동의 저장·Ticket REVOKED·기존 정지 종료·좌석 해제·Refund ACCEPTED·최초 PaymentCancel 저장을 같은 트랜잭션으로 구현한다. 거절/저장 실패는 업무 기록과 PG 호출을 남기지 않는다. RefundLock을 신규 생성하지 않는다.
- [ ] T033 [US1] `src/refund/refund.service.ts`, `src/refund/refund.controller.ts`에 고객 POST /refund를 연결하고 기존 승인 대기 분기를 제거한다. PG 최초 호출은 커밋 후 수행하며 양수 접수는 202·환불 식별자·이용 종료·지급 상태를 반환한다. 최초 응답 재반환은 공통 DB 멱등 처리를 사용한다.
- [ ] T034 [US1] `src/refund/refund-acceptance.service.spec.ts`에 커밋 직전 실패의 전체 롤백, 커밋 이후 호출, 같은 이용권 동시 신청의 확정 환불 1건, PG 실패 후에도 종료 유지 테스트를 추가한다.

## Phase 4: 사용자 스토리 2 — 점주의 매장 환불 (P2)

**목표·독립 테스트 기준**: 사용·만료·소진·정지 이용권의 입력 금액과 사유를 검증하고 퇴실 동의 뒤 이용 종료를 한 번만 반영한다.

**테스트 입력**: quickstart의 이 스토리 데이터와 spec의 Given/When 조건을 함께 사용한다. 아래 기대 결과는 조건을 대체하지 않는다. 뒤 스토리 서비스가 필요한 경우 하단 의존 관계에 따라 통합 검증한다.

### HTTP 인수 테스트

- [ ] T035 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-1의 Given/When으로 요청하고 다음 결과를 검증한다: 이용 종료·고정석 해제·그 금액의 환불이 함께 확정되고 점주·시각·사유·금액이 기록되며, PG 결제 취소를 시작하고 "이용 종료 완료·환불금 지급 처리 중"으로 응답한다. 테스트 이름 끝에 `(QS-2-1)`를 붙인다.
- [ ] T036 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-2의 Given/When으로 요청하고 다음 결과를 검증한다: 환불금 지급 완료로 바뀌며 이용 종료·좌석 해제는 반복하지 않는다. 테스트 이름 끝에 `(QS-2-2)`를 붙인다.
- [ ] T037 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-3의 Given/When으로 요청하고 다음 결과를 검증한다: 기한이 지난 미사용권은 전액을 강제하지 않고 입력액으로 환불 확정·이용 종료·좌석 해제한다. 양수는 PG 취소 결과를 기다리는 중, 0원은 PG 없이 환불금 지급 완료·원장 0원 기록이다. 실결제액 10,000원에 환불액 0원·7,000원·10,000원을 각각 검증한다. 테스트 이름 끝에 `(QS-2-3)`를 붙인다.
- [ ] T038 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-3a의 Given/When으로 요청하고 다음 결과를 검증한다: 양수 금액은 1번, 0원은 4번과 같이 처리된다. 테스트 이름 끝에 `(QS-2-3a)`를 붙인다.
- [ ] T039 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-4의 Given/When으로 요청하고 다음 결과를 검증한다: PG에 요청하지 않고 환불 확정·이용 종료·좌석 해제·환불금 지급 완료·원장 0원 기록을 함께 처리한다. 테스트 이름 끝에 `(QS-2-4)`를 붙인다.
- [ ] T040 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-5의 Given/When으로 요청하고 다음 결과를 검증한다: 환불이 거부되고 이용권과 결제에는 변화가 없다. 테스트 이름 끝에 `(QS-2-5)`를 붙인다.
- [ ] T041 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-6의 Given/When으로 요청하고 다음 결과를 검증한다: 환불이 거부된다. 테스트 이름 끝에 `(QS-2-6)`를 붙인다.
- [ ] T042 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-7의 Given/When으로 요청하고 다음 결과를 검증한다: 자기 매장에서 찾을 수 없는 이용권으로 거부되고, 그 이용권이 다른 매장에 있다는 사실은 드러나지 않는다. 테스트 이름 끝에 `(QS-2-7)`를 붙인다.
- [ ] T043 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-7a의 Given/When으로 요청하고 다음 결과를 검증한다: 권한이 없어 거부된다. 테스트 이름 끝에 `(QS-2-7a)`를 붙인다.
- [ ] T044 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-8의 Given/When으로 요청하고 다음 결과를 검증한다: 사유가 없어도 전액 환불·이용 종료·좌석 해제가 확정되고 점주·시각이 기록된다. PG 결제 취소를 시작하며 "이용 종료 완료·환불금 지급 처리 중"으로 응답한다. 테스트 이름 끝에 `(QS-2-8)`를 붙인다.
- [ ] T045 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-8a의 Given/When으로 요청하고 다음 결과를 검증한다: 사용하지 않은 이용권은 전액만 환불할 수 있다는 사유로 거부되고 이용권과 결제에는 변화가 없다. 테스트 이름 끝에 `(QS-2-8a)`를 붙인다.
- [ ] T046 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-9의 Given/When으로 요청하고 다음 결과를 검증한다: 고객 환불과 같은 대상 여부 규칙의 오류 코드(`ALREADY_REFUNDED`, `REFUND_IN_PROGRESS`)로 거부된다. 테스트 이름 끝에 `(QS-2-9)`를 붙인다.
- [ ] T047 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-10의 Given/When으로 요청하고 다음 결과를 검증한다: "이용 중" 오류로 거부되고 이용과 이용권에는 변화가 없다. 테스트 이름 끝에 `(QS-2-10)`를 붙인다.
- [ ] T048 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-11의 Given/When으로 요청하고 다음 결과를 검증한다: 퇴실·시간권 사용 시간 차감·이용권 소멸·고정석 해제·환불 확정을 함께 처리한 뒤 PG 결제 취소를 시작한다. 응답은 "이용 종료 완료·환불금 지급 처리 중"이다. 테스트 이름 끝에 `(QS-2-11)`를 붙인다.
- [ ] T049 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-12의 Given/When으로 요청하고 다음 결과를 검증한다: 환불이 거부되고 퇴실도 되지 않는다. 테스트 이름 끝에 `(QS-2-12)`를 붙인다.
- [ ] T050 [US2] E2E: `test/refund-store.e2e-spec.ts`에 명세 2-13의 Given/When으로 요청하고 다음 결과를 검증한다: PG 취소 요청 실패와 미지급 조치 필요를 기록하고 알린다. 이용 종료·퇴실·사용 시간 차감·고정석 해제는 유지한다. 이용권을 복구하거나 새 환불을 받지 않고 같은 환불 건의 지급을 재처리한다. 테스트 이름 끝에 `(QS-2-13)`를 붙인다.

### 단위 테스트와 구현

- [ ] T051 [US2] `src/refund/refund-store.service.spec.ts`, `src/session-lifecycle/session-lifecycle.service.spec.ts`에 금액 0/상한/상한 초과·사유 누락·미사용 기한 경계·동의 사이 퇴실·기존 정지 종료 테스트를 작성한다.
- [ ] T052 [US2] `src/refund/dto/store-refund.dto.ts`, `src/refund/refund-policy.ts`에 금액은 원 단위 정수이고 “0 <= amount <= 실결제액”, 사유 제공 시 “trim 후 1~500자”를 적용한다. 사용 또는 기한 초과는 사유 필수, 미사용 기한 안은 전액만·사유 선택이다.
- [ ] T053 [US2] `src/session-lifecycle/session-lifecycle.service.ts`, `src/session-lifecycle/session-lifecycle.repository.ts`에 모든 환불 검증 후 퇴실·기존 규칙의 시간 차감·정지 기록 종료·고정석 배정 해제를 실행한다. 이미 퇴실한 세션을 다시 차감하지 않고 정기권 기한을 늘리지 않는다.
- [ ] T054 [US2] `src/refund/refund-store.service.ts`, `src/refund/refund.controller.ts`에 OWNER 현재 매장 POST /refund/shop/:shopId를 구현한다. 이용 중 퇴실 동의 누락은 TICKET_IN_USE, 잘못된 금액/사유는 퇴실 전에 거절한다. 점주·금액·사유·동의 시각을 저장하고 MANAGER의 새 매장 환불은 거부한다.
- [ ] T055 [US2] `src/refund/refund-acceptance.service.ts`, `src/ledger/refund-ledger.repository.ts`에 0원 매장 환불의 이용 종료·PAID·원장 0원 1건을 함께 저장한다. PG 요청을 생성하거나 호출하지 않고 200을 반환한다.
- [ ] T056 [US2] `src/refund/refund-store.service.ts`, `src/usage-session/usage-session-processor.ts`에 커밋 뒤 종료 작업 제거와 남은 작업의 안전한 종료를 연결한다. PG 실패와 작업 제거 실패로 이용권·배정·시간을 복구하지 않는다. 정상 PG 결과 반영 검증은 US4와 결합한다.

## Phase 5: 사용자 스토리 3 — 종료된 이용권의 입실 차단 (P3)

**목표·독립 테스트 기준**: 지급 완료·처리 중·조회 실패·확정 실패 모두 종료 이용권의 입실을 같은 오류로 거부한다.

**테스트 입력**: quickstart의 이 스토리 데이터와 spec의 Given/When 조건을 함께 사용한다. 아래 기대 결과는 조건을 대체하지 않는다. 뒤 스토리 서비스가 필요한 경우 하단 의존 관계에 따라 통합 검증한다.

### HTTP 인수 테스트

- [ ] T057 [US3] E2E: `test/refund-entry.e2e-spec.ts`에 명세 3-1의 Given/When으로 요청하고 다음 결과를 검증한다: 이용 종료 오류로 거부된다. 테스트 이름 끝에 `(QS-3-1)`를 붙인다.
- [ ] T058 [US3] E2E: `test/refund-entry.e2e-spec.ts`에 명세 3-2의 Given/When으로 요청하고 다음 결과를 검증한다: 환불금 지급 완료 여부와 관계없이 이용 종료 오류로 거부된다. 테스트 이름 끝에 `(QS-3-2)`를 붙인다.
- [ ] T059 [US3] E2E: `test/refund-entry.e2e-spec.ts`에 명세 3-3의 Given/When으로 요청하고 다음 결과를 검증한다: 이용 종료 오류로 거부된다. 환불금 지급 실패를 이유로 이용권·고정석을 복구하지 않는다. 테스트 이름 끝에 `(QS-3-3)`를 붙인다.

### 단위 테스트와 구현

- [ ] T060 [US3] `src/usage-session/usage-session.service.spec.ts`, `src/ticket/ticket-pause/ticket-pause.service.spec.ts`, `src/ticket/ticket-seat/ticket-seat.service.spec.ts`에 환불 후 입실·정지 재개·좌석 변경 및 자동 종료 경쟁 테스트를 먼저 추가한다.
- [ ] T061 [US3] `src/usage-session/usage-session.service.ts`, `src/usage-session/usage-session.repository.ts`에 세션 생성과 첫 활성화 전에 Ticket 잠금 후 REVOKED 재검증을 구현한다. 환불금 지급 상태와 무관하게 TICKET_TERMINATED로 거절하고 기존 좌석 타입 검증을 유지한다.
- [ ] T062 [US3] `src/ticket/ticket-pause/ticket-pause.repository.ts`, `src/ticket/ticket-pause/ticket-pause.service.ts`, `src/ticket/ticket-seat/ticket-seat.repository.ts`, `src/ticket/ticket-seat/ticket-seat.service.ts`, `src/seat-assignment/seat-assignment.repository.ts`의 잠금 순서와 종료 재검사를 맞춘다. 종료된 이용권을 재활성화하거나 좌석을 재배정하지 않는다.
- [ ] T063 [US3] `src/session-lifecycle/session-lifecycle.service.ts`, `src/usage-session/usage-session-processor.ts`에서 환불 이후 도착한 자동 종료 작업의 상태 덮어쓰기와 중복 시간 차감을 막고 `test/refund-entry.e2e-spec.ts`에서 입실 먼저/환불 먼저의 두 순서를 검증한다.

## Phase 6: 사용자 스토리 4 — 실제 지급별 원장 기록 (P3)

**목표·독립 테스트 기준**: 실제 지급과 음수 원장을 원자적으로 한 번 반영하고 실패·미확정에는 원장을 만들지 않는다.

**테스트 입력**: quickstart의 이 스토리 데이터와 spec의 Given/When 조건을 함께 사용한다. 아래 기대 결과는 조건을 대체하지 않는다. 뒤 스토리 서비스가 필요한 경우 하단 의존 관계에 따라 통합 검증한다.

### HTTP 인수 테스트

- [ ] T064 [US4] E2E: `test/refund-ledger.e2e-spec.ts`에 명세 4-1의 Given/When으로 요청하고 다음 결과를 검증한다: 원장에 그 매장·주문의 실제 PG 취소 금액만큼 음수 기록 1건이 생긴다. 테스트 이름 끝에 `(QS-4-1)`를 붙인다.
- [ ] T065 [US4] E2E: `test/refund-ledger.e2e-spec.ts`에 명세 4-2의 Given/When으로 요청하고 다음 결과를 검증한다: 원장 기록은 1건 그대로다. 테스트 이름 끝에 `(QS-4-2)`를 붙인다.
- [ ] T066 [US4] E2E: `test/refund-ledger.e2e-spec.ts`에 명세 4-3의 Given/When으로 요청하고 다음 결과를 검증한다: 원장에는 아무 기록도 생기지 않는다. 테스트 이름 끝에 `(QS-4-3)`를 붙인다.
- [ ] T067 [US4] E2E: `test/refund-ledger.e2e-spec.ts`에 명세 4-4의 Given/When으로 요청하고 다음 결과를 검증한다: 원장에는 아무 기록도 없다. 테스트 이름 끝에 `(QS-4-4)`를 붙인다.

### 단위 테스트와 구현

- [ ] T068 [US4] `src/refund/refund-result.service.spec.ts`, `src/ledger/refund-ledger.repository.spec.ts`에 PG 성공·실패·금액 부족/초과·중복/모순 결과·저장 중단을 테스트한다.
- [ ] T069 [US4] `src/ledger/refund-ledger.repository.ts`에 실제 지급액의 음수·원래 shopId/orderId·RELEASABLE 원장을 현재 트랜잭션으로 저장한다. paymentCancelId, manualRefundPayoutId, 0원 refundId 고유성으로 지급별 중복을 막는다.
- [ ] T070 [US4] `src/refund/refund-result.service.ts`, `src/refund/refund.repository.ts`에 Refund→PaymentCancel 잠금 후 최종 상태·실제액·paidAmount·원장·필요 알림을 원자적으로 반영한다. 정상액은 PAID, 부족/초과액은 ACTION_REQUIRED·reviewRequired로 기록하고 확정된 환불 금액을 바꾸지 않는다. 실패·미확정에는 원장을 생성하지 않는다.
- [ ] T071 [US4] `src/refund/refund-result.service.ts`, `src/refund/refund-event.repository.ts`에 같은 최종 결과 재반영 방지와 모순되는 늦은 통보의 검토 필요·알림 기록을 구현한다. 담당 토큰이 바뀐 작업은 저장 결과를 반환하고 합산하지 않는다.
- [ ] T072 [US4] `src/refund/refund.controller.ts`, `src/refund/dto/pg-refund-callback.dto.ts`에서 콜백 대상을 PaymentCancel→Refund로 대조하고 공통 결과 처리로 연결한다. PAYMENT 대상 orderItemId는 null, PG 취소 거래 ID는 원승인과 구별한다. US7 완료 전에는 콜백을 공개 배포하지 않는다.

## Phase 7: 사용자 스토리 5 — PG 결과 조회·재전송·장애 복구 (P4)

**목표·독립 테스트 기준**: 자동·개별 조회의 범위와 재전송 횟수를 구분하고 결과 불명에서 중복 지급하지 않는다.

**테스트 입력**: quickstart의 이 스토리 데이터와 spec의 Given/When 조건을 함께 사용한다. 아래 기대 결과는 조건을 대체하지 않는다. 뒤 스토리 서비스가 필요한 경우 하단 의존 관계에 따라 통합 검증한다.

### HTTP 인수 테스트

- [ ] T073 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-1의 Given/When으로 요청하고 다음 결과를 검증한다: PG 취소 요청 실패·환불금 지급 조치 필요를 기록하고 운영자에게 알린다. 접수된 환불과 이용 종료는 유지하며 응답에서도 이용 종료 완료와 미지급 상태를 구분한다. 테스트 이름 끝에 `(QS-5-1)`를 붙인다.
- [ ] T074 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-2의 Given/When으로 요청하고 다음 결과를 검증한다: 환불금 지급 완료와 실제 금액의 원장 기록을 함께 반영한다. 이용 종료·좌석 해제는 반복하지 않는다. 테스트 이름 끝에 `(QS-5-2)`를 붙인다.
- [ ] T075 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-3의 Given/When으로 요청하고 다음 결과를 검증한다: PG 취소 요청 실패와 환불금 지급 조치 필요를 기록하고 알린다. 확정된 환불 금액과 이용 종료는 유지한다. 테스트 이름 끝에 `(QS-5-3)`를 붙인다.
- [ ] T076 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-4의 Given/When으로 요청하고 다음 결과를 검증한다: 같은 환불 건에서 같은 금액으로 다시 보내고 환불금 지급 처리 중으로 둔다. 테스트 이름 끝에 `(QS-5-4)`를 붙인다.
- [ ] T077 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-5의 Given/When으로 요청하고 다음 결과를 검증한다: 4번과 같은 규칙으로 같은 금액을 다시 보낸다. 테스트 이름 끝에 `(QS-5-5)`를 붙인다.
- [ ] T078 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-6의 Given/When으로 요청하고 다음 결과를 검증한다: 한도 소진 뒤 PG 미접수가 확인되면 해당 시도 FAILED/RETRY_EXHAUSTED·환불 ACTION_REQUIRED를 함께 기록하고 자동 조회·재전송에서 제외한다. 운영자 알림·금액·종료는 유지한다. 한도 소진 뒤 PG 처리 중·조회 오류이면 실패로 종료하지 않고 계속 조회한다. 테스트 이름 끝에 `(QS-5-6)`를 붙인다.
- [ ] T079 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-7의 Given/When으로 요청하고 다음 결과를 검증한다: 환불금 지급 성공·실패로 단정하지 않고 정해진 간격으로 다시 조회한다. 다른 PG 취소 요청과 별도 환불금 지급은 허용하지 않는다. 테스트 이름 끝에 `(QS-5-7)`를 붙인다.
- [ ] T080 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-8의 Given/When으로 요청하고 다음 결과를 검증한다: PG 취소 결과 확인 실패로 표시하고 운영자에게 알린다. 환불금은 미지급·결과 확인 중으로 남고 이용 종료는 유지된다. 테스트 이름 끝에 `(QS-5-8)`를 붙인다.
- [ ] T081 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-9의 Given/When으로 요청하고 다음 결과를 검증한다: 가장 오래된 1건만 PG 거래조회한다. 쌓인 건수와 관계없이 해당 시점의 자동 조회는 1번이다. 테스트 이름 끝에 `(QS-5-9)`를 붙인다.
- [ ] T082 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-10의 Given/When으로 요청하고 다음 결과를 검증한다: 그 결과를 반영하고 나머지를 정해진 건수씩 나눠 조회한다. 완료·거절·미접수는 각 규칙을 따르고, PG 처리 중·조회 장애는 지급을 확정하지 않고 재확인한다. 테스트 이름 끝에 `(QS-5-10)`를 붙인다.
- [ ] T083 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-10a의 Given/When으로 요청하고 다음 결과를 검증한다: 자동 재확인 예정 시각을 기다리지 않고 PG 취소 결과 확인 실패 건을 정해진 건수씩 묶어 조회한다. 재조회 실행은 환불 확정이나 환불금 지급 완료를 뜻하지 않는다. 테스트 이름 끝에 `(QS-5-10a)`를 붙인다.
- [ ] T084 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-10b의 Given/When으로 요청하고 다음 결과를 검증한다: 권한 오류로 거부된다. 테스트 이름 끝에 `(QS-5-10b)`를 붙인다.
- [ ] T085 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-11의 Given/When으로 요청하고 다음 결과를 검증한다: 실제 환불금 지급액과 원장을 함께 기록하고 확정된 환불 금액은 바꾸지 않는다. 부족액·초과액을 구분해 환불금 지급 조치 필요로 두고 운영자에게 알린다. 테스트 이름 끝에 `(QS-5-11)`를 붙인다.
- [ ] T086 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-12의 Given/When으로 요청하고 다음 결과를 검증한다: 2~11번의 같은 조회·재전송·미지급 관리 규칙을 적용한다. 승인 금액 불일치 건은 이용권을 만들지 않는다. 테스트 이름 끝에 `(QS-5-12)`를 붙인다.
- [ ] T087 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-13의 Given/When으로 요청하고 다음 결과를 검증한다: 자동 조회 예정 시각 전이라도 해당 시도 한 건만 즉시 조회하고, 환불금 지급 완료·실제액·원장을 한 번 반영해 결과를 보여준다. 테스트 이름 끝에 `(QS-5-13)`를 붙인다.
- [ ] T088 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-14의 Given/When으로 요청하고 다음 결과를 검증한다: 미확정 요청의 조회는 각각 처리 중 또는 결과 확인 불가로 안내하고 지급을 확정하지 않는다. 기존 조회 일정·오류 처리 규칙으로 다시 확인하며 다른 환불금 지급 차단을 유지한다. 테스트 이름 끝에 `(QS-5-14)`를 붙인다.
- [ ] T089 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-15의 Given/When으로 요청하고 다음 결과를 검증한다: 진행 중인 작업과 현재 저장 상태를 안내하고 PG를 중복 호출하지 않는다. 이후 환불 상세에서 반영 결과를 확인할 수 있다. 테스트 이름 끝에 `(QS-5-15)`를 붙인다.
- [ ] T090 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-16의 Given/When으로 요청하고 다음 결과를 검증한다: 지정한 환불만 확인한다. 정상 응답을 받아도 나머지 건의 일괄 조회를 시작하거나 전체 장애 복구 모드·예정 시각을 바꾸지 않는다. 테스트 이름 끝에 `(QS-5-16)`를 붙인다.
- [ ] T091 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-17의 Given/When으로 요청하고 다음 결과를 검증한다: 다른 매장 점주는 찾을 수 없음, 일반 고객은 권한 오류, 미로그인은 인증 오류로 거부한다. 거부한 요청은 PG를 호출하거나 환불 상태를 바꾸지 않는다. 테스트 이름 끝에 `(QS-5-17)`를 붙인다.
- [ ] T092 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-18의 Given/When으로 요청하고 다음 결과를 검증한다: 지급 완료·0원·활성 별도 예약·금액 불일치 검토·MANUAL 방식은 PG 호출 없이 저장 상태를 반환한다. 최근 시도가 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED로 이미 FAILED이고 재전송 허용 조건을 만족하면 5-19·10-1a로 개별 조회한다. 테스트 이름 끝에 `(QS-5-18)`를 붙인다.
- [ ] T093 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-19의 Given/When으로 요청하고 다음 결과를 검증한다: 자동 횟수 0·한도 직전·소진에서도 미확정 시도의 확실한 미접수는 기존 ID로 즉시 재전송한다. 최근 시도가 이미 세 실패 사유로 FAILED이면 10-1a 조건으로 새 ID를 만든다. 미확정 요청의 조회에서 새로 확인한 거절은 실패·조치 필요만 기록하고 같은 실행에서 새 요청을 만들지 않는다. 조회 오류·처리 중·실제 지급액 있음·활성 예약에는 전송하지 않는다. 테스트 이름 끝에 `(QS-5-19)`를 붙인다.
- [ ] T094 [US5] E2E: `test/refund-recovery.e2e-spec.ts`에 명세 5-20의 Given/When으로 요청하고 다음 결과를 검증한다: 최근 조회 시각과 저장된 상태를 보여주고 PG를 추가 호출하지 않는다. 점주·운영자·자동 작업의 조회 시각을 같은 시도 기준으로 공유한다. 테스트 이름 끝에 `(QS-5-20)`를 붙인다.

### 단위 테스트와 구현

- [ ] T095 [US5] `src/refund/refund-recovery.service.spec.ts`, `src/refund/refund-pg-check.service.spec.ts`에 시계·PG 대역으로 조회 일정·백오프·자동/개별 횟수·담당 토큰·최근 조회·전역 복구 독립성을 테스트한다.
- [ ] T096 [US5] `src/refund/refund-dispatch.service.ts`, `src/refund/refund-work.repository.ts`에 전송 직전 sendAttemptCount·lastSendAttemptAt·담당 기한 저장과 커밋 밖 PG 호출을 구현한다. NOT_SENT/REJECTED는 FAILED·ACTION_REQUIRED, UNKNOWN/ACCEPTED는 조회 대기이며 종료 상태를 유지한다.
- [ ] T097 [US5] `src/refund/refund-sweep.service.ts`, `src/refund/refund-recovery.processor.ts`, `src/refund/refund-work.repository.ts`에 DB nextInquiryAt 기반 작업 탐색과 기동 시 일정 복원을 구현한다. 커밋 후 전송 전 중단·큐 유실·중복·담당 기한 만료 후에는 PG 조회부터 한다. 자동 대상은 ACCEPTED/PENDING/PG의 REQUESTED·QUERY_FAILED이며 활성 PG 외 지급 예약·결과 모순 건은 제외한다.
- [ ] T098 [US5] `src/refund/refund-recovery.service.ts`에 authoritative NOT_FOUND일 때만 같은 PaymentCancel.id·금액을 자동 한도 내 재전송한다. 최초/개별 전송을 resendCount에 포함하지 않는다. 한도 소진 후 미접수 확인 때만 FAILED/RETRY_EXHAUSTED·ACTION_REQUIRED·알림을 함께 기록하고 일정·담당을 정리한다. 처리 중·조회 오류이면 계속 조회한다.
- [ ] T099 [US5] `src/refund/refund-recovery.service.ts`, `src/refund/refund-work.repository.ts`에 지수 백오프와 QUERY_FAILED 전환, RefundRecoveryControl의 PROBE/BATCH 전환을 구현한다. 기본 900초마다 가장 오래된 1건, 정상 응답 뒤 최대 20건씩, 오류 재발 시 PROBE로 돌아간다. IN_PROGRESS는 통신 성공일 뿐 PAID가 아니다.
- [ ] T100 [US5] `src/refund/refund-recovery.controller.ts`, `src/refund/refund-recovery.service.ts`에 MANAGER 전용 GET /refund/recovery/status와 POST /refund/recovery/resume을 구현한다. SCHEDULED/ALREADY_RUNNING/NO_WORK를 구분하고 기존 담당 토큰으로 중복 실행을 막는다.
- [ ] T101 [US5] `src/refund/refund-pg-check.service.ts`, `src/refund/refund-work.repository.ts`에 OWNER 자기 매장/MANAGER 개별 조회와 ALREADY_RUNNING·RECENT_RESULT·NO_PENDING_ATTEMPT·CHECKED 응답을 구현한다. Refund→PaymentCancel 잠금으로 담당을 정하고 실제 조회는 커밋 밖에서 수행한다. 다른 환불이나 전역 복구 일정은 변경하지 않는다.
- [ ] T102 [US5] `src/refund/refund-pg-check.service.ts`에 미확정 시도의 확실한 미접수 즉시 재전송을 구현한다. 기존 ID·금액을 사용하고 manualResendCount만 증가시키며 자동 한도를 검사·초기화하지 않는다. 최근 시도가 이미 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED로 FAILED이면 US10의 공통 재요청 서비스를 사용한다. 조회 중 새로 확인한 거절은 실패·조치 필요만 기록하고 같은 실행에서 새 요청을 만들지 않는다. 조회 오류·처리 중에는 보내지 않는다.
- [ ] T103 [US5] `src/refund/refund.controller.ts`, `src/refund/refund.module.ts`에 POST /refund/:refundId/pg-check와 worker를 연결한다. 본문은 없음/{}만, 클라이언트 금액·시도 ID·결과 입력은 거부한다. PG_RESULT_CONFLICT와 오래된 담당 결과는 추가 지급 없이 최신 상태로 안내한다.

## Phase 8: 사용자 스토리 6 — 승인 금액 불일치의 자동 취소 (P4)

**목표·독립 테스트 기준**: 승인액 불일치 결제는 이용권 없이 실제 승인액 전액 취소를 시작하고 정상 승인은 기존대로 발행한다.

**테스트 입력**: quickstart의 이 스토리 데이터와 spec의 Given/When 조건을 함께 사용한다. 아래 기대 결과는 조건을 대체하지 않는다. 뒤 스토리 서비스가 필요한 경우 하단 의존 관계에 따라 통합 검증한다.

### HTTP 인수 테스트

- [ ] T104 [US6] E2E: `test/refund-payment-mismatch.e2e-spec.ts`에 명세 6-1의 Given/When으로 요청하고 다음 결과를 검증한다: 결제는 실패로 처리되고, 이용권은 발행되지 않으며, 좌석 선점은 해제되고, PG가 승인한 금액 전액의 환불과 최초 PG 취소 요청이 함께 저장되고 지급을 시작한다. 테스트 이름 끝에 `(QS-6-1)`를 붙인다.
- [ ] T105 [US6] E2E: `test/refund-payment-mismatch.e2e-spec.ts`에 명세 6-2의 Given/When으로 요청하고 다음 결과를 검증한다: 환불금 지급 완료로 바뀌고 실패 결제는 성공으로 복구하지 않는다. 테스트 이름 끝에 `(QS-6-2)`를 붙인다.
- [ ] T106 [US6] E2E: `test/refund-payment-mismatch.e2e-spec.ts`에 명세 6-3의 Given/When으로 요청하고 다음 결과를 검증한다: 사용자 스토리 5와 같이 처리된다. 테스트 이름 끝에 `(QS-6-3)`를 붙인다.
- [ ] T107 [US6] E2E: `test/refund-payment-mismatch.e2e-spec.ts`에 명세 6-4의 Given/When으로 요청하고 다음 결과를 검증한다: 기존처럼 이용권이 발행된다. 테스트 이름 끝에 `(QS-6-4)`를 붙인다.

### 단위 테스트와 구현

- [ ] T108 [US6] `src/payment/payment.service.spec.ts`에 승인액 불일치·동일 콜백 반복·정상 승인·좌석 배정 실패·취소 저장 중단을 테스트한다.
- [ ] T109 [US6] `src/payment/payment.service.ts`, `src/payment/payment.repository.ts`에 승인액 불일치 시 approvedAmount 보존·결제 FAILED·이용권 미발행·좌석 선점 해제·PAYMENT 대상 SYSTEM Refund와 최초 PaymentCancel을 같은 트랜잭션으로 저장한다. 원래 요청 금액은 보존한다.
- [ ] T110 [US6] `src/payment/payment.service.ts`, `src/refund/refund-acceptance.service.ts`에서 좌석 배정 실패의 ORDER_ITEM 대상 SYSTEM 환불을 공통 흐름에 연결한다. 같은 승인 사건 중복 생성은 Payment 잠금과 대상 unique로 막고 커밋 뒤 US5 전송·복구를 사용한다.
- [ ] T111 [US6] `src/payment/payment.controller.ts`, `src/payment/dto/pg-callback.dto.ts`에 기존 정상 발행 계약과 새 자동 취소 응답을 연결한다. PG 취소 성공 후에도 실패 결제를 SUCCESS로 복원하지 않는지 `test/refund-payment-mismatch.e2e-spec.ts`에서 확인한다.

## Phase 9: 사용자 스토리 10 — 점주·운영자의 미지급 환불금 재처리 (P4)

**목표·독립 테스트 기준**: 동일 환불의 재요청과 PG 외 수단 지급 예약·증빙·예약 실패 종료·초과액 검토를 권한과 중복 방지 조건으로 검증한다.

**테스트 입력**: quickstart의 이 스토리 데이터와 spec의 Given/When 조건을 함께 사용한다. 아래 기대 결과는 조건을 대체하지 않는다. 뒤 스토리 서비스가 필요한 경우 하단 의존 관계에 따라 통합 검증한다.

### HTTP 인수 테스트

- [ ] T112 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-1의 Given/When으로 요청하고 다음 결과를 검증한다: 같은 환불·같은 금액(확정된 환불 금액)으로 취소 요청을 새 PG 취소 요청 식별자로 기록하고 실행자·사유를 기록한다. 이용권·좌석은 복구하지 않는다. 테스트 이름 끝에 `(QS-10-1)`를 붙인다.
- [ ] T113 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-1a의 Given/When으로 요청하고 다음 결과를 검증한다: 최근 시도가 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED로 이미 FAILED인 경우를 각각 준비한다. 개별 조회에서 authoritative NOT_FOUND 또는 거절 확정이면 실제 환불금 지급액 0원·다른 미확정 지급 없음·지급 방식 PG·활성 별도 지급 예약 없음·유효한 자기 담당 토큰을 확인해 별도 버튼·사유 입력 없이 같은 환불 금액의 새 PaymentCancel을 즉시 전송한다. 이전 실패 이력·횟수·이용 종료와 조회 시각 승계를 확인한다. QUERY_ERROR이면 새 요청을 만들지 않고, 처리 중·취소 성공 등 모순이면 PG_RESULT_CONFLICT·운영자 알림과 추가 지급 차단을 검증한다. 테스트 이름 끝에 `(QS-10-1a)`를 붙인다.
- [ ] T114 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-1b의 Given/When으로 요청하고 다음 결과를 검증한다: 10-1a로 PG에 취소 요청을 새 PG 취소 요청 식별자로 보낸 뒤 자동 작업은 정해진 횟수까지만 재전송한다. 이전 실패 시도의 상태·횟수는 바꾸지 않는다. 새 식별자를 발급한 PG 취소 요청도 한도 소진과 미접수로 실패하면 자동 처리를 멈추되, 점주·운영자의 개별 확인은 다시 실행할 수 있다. 테스트 이름 끝에 `(QS-10-1b)`를 붙인다.
- [ ] T115 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-1c의 Given/When으로 요청하고 다음 결과를 검증한다: K1로 만든 환불 R의 취소 요청 A를 미확정으로 유지한다. 첫 요청을 보낸 운영자가 K1을 다시 사용하면 환불 대상과 입력 사유를 첫 요청과 비교한다. 내용이 같으면 A가 담긴 최초 202 응답을 반환하고, 바뀌었으면 409 IDEMPOTENCY_KEY_REUSED로 거절한다. K2·K3 동시 요청은 환불 R 잠금 뒤 409 REFUND_PAYOUT_UNRESOLVED로 거절한다. 취소 요청 행과 PG 취소 호출이 추가되지 않는지 확인한다. 테스트 이름 끝에 `(QS-10-1c)`를 붙인다.
- [ ] T116 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 직접 payout-retries의 고객·OWNER 403 REFUND_FORBIDDEN을 검증한다. MANAGER의 같은 키·같은 내용은 최초 응답을 반환하고 새 요청만 상태를 검사한다. 지급 완료·재처리 불가는 409 REFUND_PAYOUT_NOT_ACTIONABLE, 결과 미확정·활성 예약은 409 REFUND_PAYOUT_UNRESOLVED, 미지급액이 남은 일부 지급은 409 REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL이다. 거절·재응답으로 기록·PG 호출이 추가되지 않는다. 테스트 이름 끝에 `(QS-10-1d)`를 붙인다.
- [ ] T117 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-2의 Given/When으로 요청하고 다음 결과를 검증한다: 환불금 지급 결과 미확정 오류로 거부한다. 테스트 이름 끝에 `(QS-10-2)`를 붙인다.
- [ ] T118 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-3의 Given/When으로 요청하고 다음 결과를 검증한다: 미지급액과 같은 금액을 예약하고 다른 PG 취소 요청·별도 환불금 지급을 차단한다. 예약은 환불금 지급 완료가 아니다. 테스트 이름 끝에 `(QS-10-3)`를 붙인다.
- [ ] T119 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-4의 Given/When으로 요청하고 다음 결과를 검증한다: 별도 환불금 지급과 실제 금액의 원장을 함께 한 번만 기록한다. 합계가 확정된 환불 금액에 이르고 검토 사항이 없으면 환불금 지급 완료가 된다. 테스트 이름 끝에 `(QS-10-4)`를 붙인다.
- [ ] T120 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-5의 Given/When으로 요청하고 다음 결과를 검증한다: 예약을 유지하고 운영자에게 확인을 요구한다. 시간 초과만으로 예약을 풀거나 다른 환불금 지급을 허용하지 않는다. 테스트 이름 끝에 `(QS-10-5)`를 붙인다.
- [ ] T121 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-6의 Given/When으로 요청하고 다음 결과를 검증한다: 기존 결과를 반환하고 환불금 지급액·원장을 더하지 않는다. 다른 환불에서 같은 지급 거래 식별자를 쓰면 거부한다. 테스트 이름 끝에 `(QS-10-6)`를 붙인다.
- [ ] T122 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-7의 Given/When으로 요청하고 다음 결과를 검증한다: 확정된 환불 금액에서 실제 환불금 지급액을 뺀 부족액만 예약·지급할 수 있다. 같은 환불의 PG 결제 취소와 부족액 지급은 각각 실제 금액으로 원장에 기록한다. 부족액의 실제 환불금 지급 증빙을 확정할 때 부족 지급 검토도 함께 마치고 전체 환불금 지급 완료로 바꾼다. 테스트 이름 끝에 `(QS-10-7)`를 붙인다.
- [ ] T123 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-8의 Given/When으로 요청하고 다음 결과를 검증한다: 실제액·초과액·검토 기록을 유지하고 환불금 지급 완료로 표시한다. 추가 환불금 지급이나 확정된 환불 금액 덮어쓰기는 하지 않으며 초과액 회수는 후속 범위다. 테스트 이름 끝에 `(QS-10-8)`를 붙인다.
- [ ] T124 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-9의 Given/When으로 요청하고 다음 결과를 검증한다: 고객이나 점주가 PG 외 수단으로 지급할 환불금의 예약을 요청하면 권한 오류로 거부된다. 테스트 이름 끝에 `(QS-10-9)`를 붙인다.
- [ ] T125 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-9a의 Given/When으로 요청하고 다음 결과를 검증한다: 고객이나 점주가 PG 외 수단으로 실제 지급한 환불금의 증빙 등록이나 미지급 확인을 요청하면 권한 오류로 거부된다. 테스트 이름 끝에 `(QS-10-9a)`를 붙인다.
- [ ] T126 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-9b의 Given/When으로 요청하고 다음 결과를 검증한다: 고객이나 점주가 PG 초과 취소에 대한 운영자 검토 결과 등록을 요청하면 권한 오류로 거부된다. 테스트 이름 끝에 `(QS-10-9b)`를 붙인다.
- [ ] T127 [US10] E2E: `test/refund-operations.e2e-spec.ts`에 명세 10-10의 Given/When으로 요청하고 다음 결과를 검증한다: 해당 예약을 실패로 종료하고 환불금 지급 조치 필요로 남긴다. 환불금 지급 여부가 불명확하면 예약을 종료할 수 없다. 테스트 이름 끝에 `(QS-10-10)`를 붙인다.

### 단위 테스트와 구현

- [ ] T128 [US10] `src/refund/refund-operations.service.spec.ts`에 수동 PG 재요청, 외부 지급 예약/증빙/예약 실패 종료, 초과액 검토와 사용자별 거절 조건을 동작별 테스트로 추가한다.
- [ ] T129 [US10] `src/refund/refund-retry.service.ts`, `src/refund/refund-operations.repository.ts`에 같은 Refund.amount의 새 PaymentCancel 생성 처리를 구현한다. 실제 지급액 0·다른 미확정 PG 요청 없음·활성 외부 지급 예약 없음·유효한 실패 요청 조회 담당 없음·PG_RESULT_CONFLICT 없음이 필수다. 이전 실패 기록과 이용 종료를 유지한다.
- [ ] T130 [US10] `src/refund/refund-retry.service.ts`, `src/refund/refund-pg-check.service.ts`에 최근 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED의 FAILED 시도 개별 조회 뒤 미접수 또는 거절 확정에 따른 새 요청 생성 경로를 연결한다. PG 방식·실제 지급액 0·다른 미확정 지급 없음·활성 예약 없음을 재검사한다. 유효한 자기 조회 토큰을 확인하고 이전 담당 해제·새 담당 지정·lastInquiryAt 승계를 함께 저장한다. 새 요청의 resendCount/manualResendCount는 0부터 시작한다. 조회 오류는 새 요청을 만들지 않고 모순 결과는 PG_RESULT_CONFLICT로 기록한다.
- [ ] T131 [US10] `src/refund/refund-operations.controller.ts`, `src/refund/dto/retry-refund.dto.ts`에 MANAGER 전용 POST payout-retries를 구현한다. 고객·OWNER는 403 REFUND_FORBIDDEN이다. 사유는 trim 후 1~500자·Idempotency-Key 필수다. 권한 확인→같은 키 최초 응답 반환→새 요청 상태 재검사 순서를 지킨다. 지급 완료·재처리 불가는 REFUND_PAYOUT_NOT_ACTIONABLE, 결과 미확정·활성 예약·유효한 조회 담당·PG_RESULT_CONFLICT는 REFUND_PAYOUT_UNRESOLVED, 미지급액이 남은 일부 지급은 REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL의 409 코드로 거절한다.
- [ ] T132 [US10] `src/refund/dto/manual-refund-payout.dto.ts`, `src/refund/refund-operations.service.ts`에 MANAGER의 PG 외 수단 지급 예약을 구현한다. ACTION_REQUIRED이고 지급 결과가 미확정인 PG 요청이 없으며 미지급액이 양수일 때 현재 미지급액과 같은 양수 금액만 RESERVED/MANUAL로 저장한다. 예약 API는 실제 송금을 실행하지 않는다.
- [ ] T133 [US10] `src/refund/dto/confirm-manual-refund-payout.dto.ts`, `src/refund/refund-operations.service.ts`에 외부 지급 결과 등록을 구현한다. 예약과 같은 금액, externalTransactionId “1~200자”, evidenceReference “1~1000자”, paidAt “미래 불가”를 검증한다. SUCCEEDED·paidAmount·원장을 함께 저장하고 부족액 지급이면 검토 완료도 함께 반영한다.
- [ ] T134 [US10] `src/refund/refund-operations.repository.ts`, `src/refund/refund-operations.service.ts`에 지급 증빙 중복 등록은 최초 결과 반환, 다른 환불의 외부 거래 ID 재사용은 거절하도록 구현한다. 예약 생성·PG 재요청·실패 요청 개별 조회 간 경쟁은 같은 Refund 잠금으로 제어한다.
- [ ] T135 [US10] `src/refund/dto/cancel-manual-refund-payout.dto.ts`, `src/refund/refund-operations.service.ts`에 POST not-paid를 연결한다. 실제 지급하지 않았다는 증빙·사유가 있을 때만 PG 외 수단 지급 예약을 실패로 종료하고 ManualRefundPayout을 FAILED로 기록한다. 환불은 ACTION_REQUIRED, 실제액·원장은 그대로이며 지급 여부 불명·시간 경과·담당자 변경만으로 종료하지 않는다.
- [ ] T136 [US10] `src/refund/dto/review-refund-amount.dto.ts`, `src/refund/refund-operations.service.ts`에 PG 초과 취소 검토 결과 등록을 구현한다. MANAGER·reviewRequired·미지급액 0·미확정 지급 없음 조건에서 검토자/시각/사유/증빙을 저장하고 PAID로 전환한다. 확정된 환불 금액·실제액·원장을 수정하거나 초과액을 회수하지 않는다.
- [ ] T137 [US10] `src/refund/refund-sweep.service.ts`, `src/refund/refund-event.repository.ts`에 예약 후 기본 3600초 미확인 알림을 예약 ID 기반으로 한 번 생성한다. 예약은 유지하고 새 PG 요청·새 외부 지급 예약을 막는다.
- [ ] T138 [US10] `src/refund/refund-operations.controller.ts`, `src/refund/refund.module.ts`에 예약·confirm·not-paid·amount-review를 등록하고 각 운영 변경의 필수 멱등 키·MANAGER 권한·증빙 노출 제한을 검증한다. US5의 5-19와 이 스토리의 10-1a/1b를 함께 통과시킨다.

## Phase 10: 사용자 스토리 7 — PG 콜백 서명 인증 (P5)

**목표·독립 테스트 기준**: 정상 서명만 로그인 없이 허용하고 사용자 JWT만 있는 콜백은 거부한다.

**테스트 입력**: quickstart의 이 스토리 데이터와 spec의 Given/When 조건을 함께 사용한다. 아래 기대 결과는 조건을 대체하지 않는다. 뒤 스토리 서비스가 필요한 경우 하단 의존 관계에 따라 통합 검증한다.

### HTTP 인수 테스트

- [ ] T139 [US7] E2E: `test/refund-callback-auth.e2e-spec.ts`에 명세 7-1의 Given/When으로 요청하고 다음 결과를 검증한다: 결과가 반영된다. 테스트 이름 끝에 `(QS-7-1)`를 붙인다.
- [ ] T140 [US7] E2E: `test/refund-callback-auth.e2e-spec.ts`에 명세 7-2의 Given/When으로 요청하고 다음 결과를 검증한다: 거부되고 환불금 지급 상태는 바뀌지 않는다. 테스트 이름 끝에 `(QS-7-2)`를 붙인다.
- [ ] T141 [US7] E2E: `test/refund-callback-auth.e2e-spec.ts`에 명세 7-3의 Given/When으로 요청하고 다음 결과를 검증한다: 거부된다. 테스트 이름 끝에 `(QS-7-3)`를 붙인다.
- [ ] T142 [US7] E2E: `test/refund-callback-auth.e2e-spec.ts`에 명세 7-4의 Given/When으로 요청하고 다음 결과를 검증한다: 1~3번과 같이 처리된다. 테스트 이름 끝에 `(QS-7-4)`를 붙인다.

### 단위 테스트와 구현

- [ ] T143 [US7] `src/pg/guards/pg-signature.guard.spec.ts`에 원문 바이트·키 순서/공백 변경·중복 헤더·잘못된 hex·시각 ±300초 경계·압축/query string 거절을 테스트한다.
- [ ] T144 [US7] `src/pg/guards/pg-signature.guard.ts`, `src/pg/pg.module.ts`에 API 계약 §7의 canonical UTF-8/LF 규격과 HMAC-SHA256·상수 시간 비교를 구현한다. X-PG-Timestamp와 v1=소문자 hex 64자리 서명을 검사하며 PG_CALLBACK_UNAUTHORIZED/EXPIRED/FORMAT_INVALID를 구분한다.
- [ ] T145 [US7] `src/main.ts`, `src/payment/payment.controller.ts`, `src/refund/refund.controller.ts`에 rawBody:true와 두 콜백의 Public+PG 서명 가드를 적용한다. 사용자 JWT만으로 서명을 우회하지 못하게 하고 다른 경로의 JWT 보호를 유지한다.
- [ ] T146 [US7] `test/refund-callback-auth.e2e-spec.ts`에 만료 서명의 재통보 거절·새 시각 재서명 허용·DB 커밋 실패 503·유효 시간 내 중복 통보 1회 반영을 추가한다. 비밀값·서명·개인정보가 `src/logger/transaction-logger.service.ts` 로그에 남지 않는지 확인한다.

## Phase 11: 사용자 스토리 8 — 환불 내역 조회 권한 (P5)

**목표·독립 테스트 기준**: 본인·현재 소유 매장·MANAGER 범위로만 조회하고 운영 증빙·오류 원문 노출을 제한한다.

**테스트 입력**: quickstart의 이 스토리 데이터와 spec의 Given/When 조건을 함께 사용한다. 아래 기대 결과는 조건을 대체하지 않는다. 뒤 스토리 서비스가 필요한 경우 하단 의존 관계에 따라 통합 검증한다.

### HTTP 인수 테스트

- [ ] T147 [US8] E2E: `test/refund-history.e2e-spec.ts`에 명세 8-1의 Given/When으로 요청하고 다음 결과를 검증한다: 조회된다. 테스트 이름 끝에 `(QS-8-1)`를 붙인다.
- [ ] T148 [US8] E2E: `test/refund-history.e2e-spec.ts`에 명세 8-2의 Given/When으로 요청하고 다음 결과를 검증한다: 해당 매장을 찾을 수 없다는 응답을 받고 내역은 보이지 않는다. 테스트 이름 끝에 `(QS-8-2)`를 붙인다.
- [ ] T149 [US8] E2E: `test/refund-history.e2e-spec.ts`에 명세 8-3의 Given/When으로 요청하고 다음 결과를 검증한다: 조회된다. 테스트 이름 끝에 `(QS-8-3)`를 붙인다.
- [ ] T150 [US8] E2E: `test/refund-history.e2e-spec.ts`에 명세 8-4의 Given/When으로 요청하고 다음 결과를 검증한다: 자기 환불 내역만 보인다. 다른 고객을 지정해 조회할 방법은 없다. 테스트 이름 끝에 `(QS-8-4)`를 붙인다.
- [ ] T151 [US8] E2E: `test/refund-history.e2e-spec.ts`에 명세 8-5의 Given/When으로 요청하고 다음 결과를 검증한다: 조회된다. 테스트 이름 끝에 `(QS-8-5)`를 붙인다.

### 단위 테스트와 구현

- [ ] T152 [US8] `src/refund/refund-query.service.spec.ts`, `src/refund/dto/get-refund-query.dto.spec.ts`에 본인/소유 매장 범위·운영 정보 필터·정렬·페이지 경계·과거 이력 노출 테스트를 작성한다.
- [ ] T153 [US8] `src/refund/refund-query.repository.ts`, `src/refund/refund-query.service.ts`에 GET me/shop/user/:userId/:refundId를 구현한다. 정렬 requestedAt DESC,id DESC, page=1, limit=20(1~100), payoutStatus/decisionStatus 필터, MANAGER actionRequiredOnly를 적용한다. 범위 안 빈 목록은 200, 범위 밖은 404다.
- [ ] T154 [US8] `src/refund/dto/get-refund-query.dto.ts`, `src/refund/dto/refund-response.dto.ts`에 확정된 환불 금액·실제 지급액·미지급액·초과액·종료 시각·PG 요청/외부 지급 이력을 반영한다. 운영 상세 오류·증빙·검토 사유는 MANAGER에만 노출하고 LEGACY 이력을 신규 이용 종료와 구분한다.
- [ ] T155 [US8] `src/refund/refund.controller.ts`, `src/refund/refund-query.service.ts`에 고정 경로를 동적 refundId보다 먼저 연결한다. 고객이 다른 userId를 지정하지 못하게 하고 조회 때 현재 ShopOwner를 재검사한다.

## Phase 12: 사용자 스토리 9 — 환불 상태와 수신자별 알림 (P5)

**목표·독립 테스트 기준**: 이용 종료와 지급 상태를 구분하고 경로별 알림·공동 점주별 읽음을 검증한다.

**테스트 입력**: quickstart의 이 스토리 데이터와 spec의 Given/When 조건을 함께 사용한다. 아래 기대 결과는 조건을 대체하지 않는다. 뒤 스토리 서비스가 필요한 경우 하단 의존 관계에 따라 통합 검증한다.

### HTTP 인수 테스트

- [ ] T156 [US9] E2E: `test/refund-notifications.e2e-spec.ts`에 명세 9-1의 Given/When으로 요청하고 다음 결과를 검증한다: 이용 종료 완료와 환불금 지급 상태가 구분된다. 양수의 최초 접수는 환불금 지급 처리 중, 보내기 전 실패·PG 거절은 이용 종료 완료·환불금 지급 조치 필요, 0원은 환불금 지급 완료로 응답한다. 테스트 이름 끝에 `(QS-9-1)`를 붙인다.
- [ ] T157 [US9] E2E: `test/refund-notifications.e2e-spec.ts`에 명세 9-2의 Given/When으로 요청하고 다음 결과를 검증한다: 이용 종료 시각·확정된 환불 금액·실제 환불금 지급액·미지급액·환불금 지급 상태·조치 사유가 보인다. 테스트 이름 끝에 `(QS-9-2)`를 붙인다.
- [ ] T158 [US9] E2E: `test/refund-notifications.e2e-spec.ts`에 명세 9-3의 Given/When으로 요청하고 다음 결과를 검증한다: 신청한 고객·그 매장 점주·운영자에게 미지급 알림이 남는다. 테스트 이름 끝에 `(QS-9-3)`를 붙인다.
- [ ] T159 [US9] E2E: `test/refund-notifications.e2e-spec.ts`에 명세 9-3a의 Given/When으로 요청하고 다음 결과를 검증한다: 그 매장 점주와 운영자에게 미지급 알림이 남는다. 테스트 이름 끝에 `(QS-9-3a)`를 붙인다.
- [ ] T160 [US9] E2E: `test/refund-notifications.e2e-spec.ts`에 명세 9-4의 Given/When으로 요청하고 다음 결과를 검증한다: 자기 매장의 알림만 보인다. 테스트 이름 끝에 `(QS-9-4)`를 붙인다.
- [ ] T161 [US9] E2E: `test/refund-notifications.e2e-spec.ts`에 명세 9-4a의 Given/When으로 요청하고 다음 결과를 검증한다: 자기 환불의 알림만 보인다. 테스트 이름 끝에 `(QS-9-4a)`를 붙인다.
- [ ] T162 [US9] E2E: `test/refund-notifications.e2e-spec.ts`에 명세 9-4b의 Given/When으로 요청하고 다음 결과를 검증한다: 안 읽은 알림 조회에서 빠지고 전체 조회에는 읽음으로 남는다. 다른 사람의 알림은 읽음 처리할 수 없다. 테스트 이름 끝에 `(QS-9-4b)`를 붙인다.
- [ ] T163 [US9] E2E: `test/refund-notifications.e2e-spec.ts`에 명세 9-5의 Given/When으로 요청하고 다음 결과를 검증한다: 그 알림이 보인다. 테스트 이름 끝에 `(QS-9-5)`를 붙인다.

### 단위 테스트와 구현

- [ ] T164 [US9] `src/refund/refund-notification.service.spec.ts`에 CUSTOMER/STORE/SYSTEM 실패 수신자, QUERY_FAILED·금액 불일치·지급 확인 지연, 중복 사건, 공동 점주별 읽음을 테스트한다.
- [ ] T165 [US9] `src/refund/refund-event.repository.ts`에 상태 전이와 같은 트랜잭션에서 알림을 생성한다. CUSTOMER 실패는 고객·현재 점주·MANAGER, STORE는 현재 점주·MANAGER, SYSTEM과 운영 이상은 MANAGER로 구분한다. 동일 사건 고유성은 null 수신자에도 중복을 막도록 DB 제약을 검증한다.
- [ ] T166 [US9] `src/refund/refund-notification.repository.ts`, `src/refund/refund-notification.service.ts`에 현재 수신 범위 조회와 사용자별 Receipt를 구현한다. 최초 readAt을 보존하고 다른 수신자의 읽음이나 공동 점주의 읽음을 함께 바꾸지 않는다.
- [ ] T167 [US9] `src/refund/refund-notification.controller.ts`, `src/refund/dto/get-refund-notification-query.dto.ts`에 GET notifications와 PATCH :notificationId/read를 연결한다. unreadOnly=false·페이지·audience 필터와 빈 본문/{}를 검증하고 요청자가 수신할 수 없는 알림은 404로 거절한다.
- [ ] T168 [US9] `src/refund/dto/refund-response.dto.ts`, `src/refund/refund.service.ts`, `src/refund/refund-store.service.ts`에서 양수 최초 접수 202·실패 시 ACCEPTED/ACTION_REQUIRED·0원 200 PAID와 최신 GET 상태를 구분한다. PG 실패를 신청 실패 502로 반환하지 않고 응답 유실 재요청은 최초 응답을 반환한다.

## Phase 13: 데이터 전환과 전체 검증

**목적**: 기존 이력을 보존해 새 계약으로 전환할 수 있는지 검증하고 모든 인수 기준을 실제 테스트에 연결한다.

- [ ] T169 `scripts/refund/check-legacy-refunds.ts`와 `scripts/refund/check-legacy-refunds.spec.ts`에 읽기 전용 이관 사전 점검을 만든다. 기존 PG 미확정·증거 없는 금액·중복 확정 대상이 남으면 전환을 차단하고 결과를 추측하지 않는다. 운영 데이터에 자동 쓰기를 수행하지 않는다.
- [ ] T170 `scripts/refund/migrate-legacy-refunds.ts`, `test/refund-migration.e2e-spec.ts`에 성공 증거 기반 ACCEPTED/PAID·LEGACY 이관, 승인 대기/확정 실패 LEGACY_REJECTED/NOT_APPLICABLE 보존, LEGACY_STORE_REFUND_REQUIRED 사유와 누락 원장 중복 없는 보충을 구현한다. 과거 실패 이용권·좌석·동의를 신규 종료로 바꾸지 않는다. 검증용 DB 이관 뒤 HTTP로 과거/신규 내역을 대조한다.
- [ ] T171 `prisma/migrations/20261027000200_refund_completion_finalize/migration.sql`에 이관 검증 후 필수 연결·unique 제약 확정과 기존 RefundLock 정리 절차를 작성한다. 기존 데이터가 있는 환경은 변경 요청/worker 중지→확장→이관 검증→최종 제약→새 서버 재개 순서로 적용하고, 빈 테스트 DB와 기존 데이터 복제본 모두 검증한다.
- [ ] T172 `test/refund-concurrency.e2e-spec.ts`에 고객/점주 동시 접수, 입실/환불, 콜백/조회, 자동/개별 조회, 점주·운영자의 실패 요청 개별 조회/MANAGER 직접 PG 재요청/외부 지급 예약, 증빙 반복 등록 경쟁을 재현한다. 확정 환불·활성 PG 요청·활성 지급 예약·지급별 원장 수와 실제 PG 호출 수를 검증한다.
- [ ] T173 `test/refund-crash-recovery.e2e-spec.ts`에 커밋 전/후·PG 전송 전/후·성공 후 저장 실패·worker 중단·담당 만료·큐 유실/중복을 재현한다. 재시작 후 DB 기록에서 조회를 재개하고 이용 종료·확정된 환불 금액·외부 지급 예약을 보존하는지 검증한다.
- [ ] T174 `src/refund/refund.service.ts`, `src/refund/refund.repository.ts`, `src/refund/refund.module.ts`에서 신규 흐름으로 대체한 RefundLock TTL 해제·승인 대기·PG 실패 후 이용권 복구 코드를 제거하고 기존 `src/refund/refund.service.spec.ts`의 변경된 기대값을 명세와 대조한다. 테스트 기대값 변경이 필요한 항목은 헌법 III에 따라 근거와 사용자 확인을 남긴 뒤 변경한다.
- [ ] T175 `specs/002-refund-completion/quickstart.md`에 실제 E2E 파일/테스트 이름 대응을 기록한다. 92개 QS 모두 HTTP 테스트가 존재하고 60개 FR·25개 SC가 구현/테스트에 연결되는지 대조한다. 자동 최종 결과 정상·무적체 조건에서 기본 75초 목표도 테스트 시계로 검증한다.
- [ ] T176 [P] `specs/002-refund-completion/release-checklist.md`에 API/클라이언트 비호환 전환, 실제 PG의 authoritative NOT_FOUND·최종 실패·멱등 키·서명 보장 확인 항목, 기존 미확정 정리, 작업자 중지/재개, 데이터 보존 수정 배포 절차를 적는다. 이 저장소 밖 클라이언트와 실제 PG 검증은 미확인으로 표시한다.
- [ ] T177 `src/refund/refund.controller.ts`, `src/refund/refund-operations.controller.ts`, `src/refund/refund-recovery.controller.ts`, `src/refund/refund-notification.controller.ts`의 Swagger와 한글 주석을 최종 API 계약에 맞춘다. 예약 대상·외부 실제 지급·결과 등록·예약 실패 종료를 구별하고 spec·다이어그램·API의 의미 차이를 `specs/002-refund-completion/verification.md`에 기록해 해소한다.
- [ ] T178 `.specify/memory/tdd-profile.md`의 전체 단위·E2E 명령, `npm run build`, 변경 파일 ESLint를 실행하고 `specs/002-refund-completion/verification.md`에 실제 결과를 기록한다. 소유권·중복 지급·원장 중복·서명·예약 차단의 의도적 오류를 넣어 테스트가 실패하는지 확인한 뒤 원복하고 재검증한다.

## 의존 관계와 실행 순서

Phase 번호는 명세 우선순위별 문서 구성이다. 실제 실행은 다음 의존 관계를 따른다. 각 스토리의 완료에는 해당 스토리 HTTP 테스트뿐 아니라 아래 선행 구현이 필요하다.

| 작업 단위 | 선행 조건 | 완료 판단 |
|---|---|---|
| 준비·기반 | 순서대로 Phase 1→2 | 테스트 환경·저장 제약·PG 계약·권한·멱등 검증 |
| US1 고객 접수 | 기반 | 판정/종료/접수까지 첫 검증 가능. 최종 지급은 US4·US5 필요 |
| US2 매장 접수 | US1 공통 종료 처리 | 0원·퇴실 동의·금액 검증. PG 완료 시나리오는 US4 필요 |
| US3 입실 제한 | US1 종료 처리 | US1/US2와 경쟁 시 종료 상태 보존 |
| US4 실제 지급 원장 | 기반 모델·US1 접수 | 공통 결과 처리와 내부 알림 저장. HTTP 서명 적용 후 US7과 재검증 |
| US5 자동 복구·개별 조회 | US4 공통 결과 처리 | 일반 복구는 독립 진행. 5-19의 실패 확정 후 새 요청은 US10 공통 재요청 구현 후 완료 |
| US6 시스템 자동 취소 | US1 공통 확정·US4·US5 | 정상 승인 회귀와 SYSTEM 결과 처리 |
| US10 공통 PG 재요청 처리 | 기반·US4·US5 담당/송신 계약 | US5 개별 확인과 같은 서비스 사용. US5의 모든 기능 완료를 선행 조건으로 두지 않음 |
| US10 외부 지급·검토 | US4·US10 공통 재요청 | 교차 지급 차단·외부 지급 증빙·예약 실패 종료 검증 |
| US7 콜백 인증 | 공통 오류·설정·PG 계약 | US4/US6 HTTP 처리와 연결. 서명 전용 단위 테스트는 먼저 작성 가능 |
| US8 내역 | 기반 모델·권한, US1/US10 fixture | 사용자별 범위·이력·증빙 노출 검증 |
| US9 알림·응답 | US4 내부 사건 저장·US8 조회 | US5/US10의 실패/예약 알림까지 연결 |
| 최종 전환·배포 검증 | 모든 스토리 | 이관·동시성·중단 복구·전체 회귀·TDD 증거 확인 |

권장 구현 순서는 기반 → US1 접수 → US4 공통 결과 → US2·US3 → US5 일반 복구 → US10 공통 PG 재요청 → US5 개별 확인 완료 → US6·US10 외부 지급 → US7 → US8·US9 → 최종 검증이다. 신규 콜백을 외부에 공개하는 배포는 US7 완료 후에만 한다.

**계약 해석 시 주의**: 직접 payout-retries는 MANAGER 전용이며 고객·OWNER는 역할 제한으로 403이다. 권한 확인 후 같은 키·같은 내용이면 현재 상태와 관계없이 최초 응답을 반환한다. 새 요청의 지급 완료·재처리 불가는 REFUND_PAYOUT_NOT_ACTIONABLE, 결과 미확정·활성 예약·유효한 조회 담당·PG_RESULT_CONFLICT는 REFUND_PAYOUT_UNRESOLVED, 미지급액이 남은 일부 지급은 REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL의 409로 구분한다. 개별 확인의 세 실패 사유 확대와 미확정 요청의 기존 ID 재전송은 별도로 검증한다.

## 병렬 실행 예시

아래는 선행 계약이 고정된 뒤의 **서로 다른 파일 작성** 예시다. 테스트 실행과 성공 여부 판단은 한 동작씩 직렬로 수행한다. 같은 스토리의 모든 작업을 병렬로 시작하지 않는다.

| 스토리 | 병렬 작성 가능한 예 | 합치기 전 확인 |
|---|---|---|
| US1 | refund-policy 단위 테스트 / 고객 DTO 검증 테스트 | 같은 정책·오류 계약 |
| US2 | store-refund DTO / session-lifecycle 단위 테스트 | 공통 종료 처리 인터페이스 |
| US3 | usage-session 테스트 / ticket-pause 테스트 | Ticket 잠금·종료 오류 계약 |
| US4 | refund-ledger 저장 테스트 / refund-result 단위 테스트 | 동일 트랜잭션 전달 계약 |
| US5 | recovery 단위 테스트 / pg-check 단위 테스트 | 조회 담당·시계·횟수 계약 |
| US6 | payment 서비스 단위 테스트 / SYSTEM 환불 E2E 작성 | 테스트 실행은 공유 DB 때문에 직렬 |
| US10 | 외부 지급 DTO 테스트 / 재요청 서비스 단위 테스트 | 같은 운영 서비스 파일은 동시 수정 금지 |
| US7 | 서명 가드 단위 테스트 / raw-body HTTP 테스트 작성 | canonical 규격 |
| US8 | 목록 DTO 테스트 / 조회 Repository 작성 | 범위·정렬·응답 계약 |
| US9 | 알림 Receipt Repository / 알림 쿼리 DTO | 사용자별 읽음·수신 범위 |

## 구현 전략과 완료 기준

첫 검증 단위(MVP)는 기반과 US1의 고객 판정·동의·원자적 이용 종료·접수다. 테스트 PG로 검증하는 개발 단계이며 실제 배포 가능한 환불 기능 전체를 뜻하지 않는다. 실제 배포는 원장·복구·콜백 인증·권한·미지급 운영 처리·전환 검증을 모두 끝낸 뒤 판단한다.

각 스토리의 완료 시 명세의 대상·조건·동작·실제 결과를 대조한다. “예약”은 PG 외 수단 지급 예약, “취소”는 PG 결제 취소, “예약 실패 종료”는 실제 미지급 증빙에 따라 별도 지급 예약을 FAILED로 끝내는 처리로 구분한다. 내부 FAILED 상태를 환불 자체의 철회로 설명하지 않는다. 원문 명세의 짧은 표현은 테스트 준비 조건과 업무 효과로 풀어 검증하며 임의의 업무 정책을 추가하지 않는다.

형식 검사·92개 시나리오 대응 확인은 문서 검증이다. 구현 완료는 실제 테스트·DB 제약·동시성·중단 복구·빌드·린트와 TDD 실행 증거로 판단한다.

