# 구현 계획: 이용 종료와 환불금 지급 분리

> 2026-11-17 설계 변경: 아래 개별 확인 규칙은 승인된 수정 목표다. 서버 구현과 기존 테스트는 아직 이 규칙으로 변경·검증하지 않았다. 테스트 요구사항·완료 기록은 다음 단계에서 갱신한다.

**브랜치**: feature/refund-completion · **갱신일**: 2026-10-27 · **기준**: [spec.md](spec.md), 환불 정책 v0.4

## PG 통신 구조 갱신 (003)

환불 서비스는 PgService를 주입받고, PgService는 PG_CLIENT 토큰의 PgClient로 결제 취소 요청·조회를 수행한다. 공통 제한 시간·예외·성공 정보 검증은 PgService, PG사별 통신·응답 해석은 클라이언트, 지급 상태·실제액·원장·재전송·복구는 기존 환불 서비스가 담당한다. RefundPgGateway·PgCancelClient와 해당 토큰은 제거한다.

PG_MODE는 필수다. development/test의 simulated만 모의 구현을 허용하고, production 환경의 simulated는 서버 시작을 거부한다. ProductionPgClient는 실제 PG 미구현 골격이므로 선택 시 사유를 알리고 시작을 거부한다. SimulatedPgClient의 성공·실제액·원장은 외부 지급 증거가 아니다. 기록 없는 모의 조회는 QUERY_ERROR이며 확정 미접수로 판단하지 않는다.

업무·HTTP·멱등성·동시성·복구 계약은 보존한다. 구체적인 의존성과 테스트 교체 지점은 [003 계획](../003-pg-client/plan.md)을 따른다. 기존 tasks·TDD 기록은 당시 작업의 증거로 유지한다.

## 요약

환불 검증·동의가 끝나면 이용 종료와 금액을 먼저 확정하고 고정석을 해제한다. PG 결제 취소는 같은 환불 건 아래의 별도 시도로 처리한다. PG 실패로 이용권·좌석을 복구하지 않으며, 미지급액은 자동 조회·재전송과 운영자 재처리로 추적한다. PaymentCancel에는 PG 취소 요청의 번호·금액·처리 결과를 기록하고 Refund·ManualRefundPayout을 추가한다. 실패 확정 뒤 다시 요청하면 기존 실패를 보존하고 새 PG 취소 요청 식별자로 기록한다. 환불 건과 금액은 유지한다. 구형 RefundLock 모델·테이블은 제거했으며, 상품당 확정 환불 unique·Ticket/Refund 행 잠금으로 중복 처리를 방지한다.

## 기술 환경과 범위

기존 TypeScript·NestJS 11·Prisma 7·PostgreSQL 16·Redis 7·BullMQ 6·Jest 30 구성을 유지한다. 실제 PG·은행 SDK나 새 프레임워크를 도입하지 않는다. 금액·상태·동의·증빙·작업 담당은 PostgreSQL, 실행 예약은 Redis/BullMQ에 둔다. Controller → Service → Repository를 지킨다.

범위는 10개 사용자 스토리, 92개 인수 시나리오, FR 식별자 60개와 SC 25개다. FR-007a의 과거 데이터 이관 요구는 2026-10-30 사용자 결정으로 제외하며 식별자는 보존한다. 새 기능은 종료 동의·확정 환불 기록·개별 PG 결과 확인·지급 재처리·별도 환불금 지급 예약/증빙이며, 실송금·PG 수동 성공 변경·일별 대사·초과액 회수·매출/정산 배치는 제외한다.

PG 최종 결과 정상 응답·무적체 조건의 시도 결과 판명 목표는 기본 75초(대기 60+조회 간격 15)다. PG 처리 중·재전송·장애·운영자 확인 중인 미지급액 전체 해결에 이 시간을 보장하지 않는다. 자세한 설정은 [research R10](research.md#r10-설정개발-db-재구축범위)과 [API 설정](contracts/rest-api.md#8-pg-요청조회복구)을 따른다.

## 헌법 준수 점검

| 원칙 | 설계 반영 |
|---|---|
| I. 3계층 | Controller/worker → Service → Repository. 세션 종료 직접 쿼리는 SessionLifecycleRepository로 분리 |
| II. 입력 검증 | DTO로 UUID·원 단위 정수·동의·사유·환불금 지급 시각·증빙 참조 검증, 상태별 판단은 Service |
| III. 테스트 | 시나리오마다 HTTP E2E를 두고 동작 하나씩 red→green→회귀→필요 리팩터링. cycle-log에 실제 실패 출력 기록 |
| IV. 운영 수준 | 미지급 추적·원장·별도 환불금 지급 중복 방지·증빙·권한을 검증함. 보존할 운영 데이터가 없는 개발 단계이므로 이관은 제외하고 빈 DB 재구축을 검증함. 실연동 제외는 사용자 범위 |
| V. 단순성 | 기존 PG·큐·원장 재사용, 이용 정지/좌석 재배정/가격 교환 기능을 환불에 넣지 않음 |
| VI. 오류 응답 | 신청 거절·미확정 환불금 지급 차단·별도 환불금 지급 증빙 오류를 계약 코드로 구분하고 거부 E2E에서 코드 검증 |

이는 문서상의 준수 계획이며 구현·테스트 통과 판정이 아니다. 헌법 v1.5.0을 적용한다. 기능 브랜치·한글 주석/문서/커밋·동작 변경과 리팩터링 분리를 유지한다.

## 문서와 구현 경계

```text
specs/002-refund-completion/
  spec.md / acceptance-scenario-diagrams.md
  plan.md / research.md / data-model.md / quickstart.md
  contracts/rest-api.md
  checklists/requirements.md
  product/00-info.md / product/10-spec.md / product/checklist.md
```

구현 작업 목록은 [tasks.md](tasks.md)에 정리했다. TDD 세부 테스트 목록과 실행 기록은 후속 단계에서 작성한다. 이 작업은 소스·스키마·실데이터를 변경하지 않는다.

예정 변경은 prisma/schema.prisma·마이그레이션, refund 도메인의 확정/지급/운영/알림, payment 자동 취소 저장, PG 인터페이스·서명, ledger 지급별 원장, usage-session·session-lifecycle·ticket-pause·ticket-seat·ticket 조회·좌석 배정의 잠금 및 종료 검증, config·main(rawBody)과 E2E다. 식별자는 [data-model](data-model.md), 경로·응답은 [contracts](contracts/rest-api.md)를 기준으로 한다.

## 1. 이용 종료와 환불 확정

1. 본인/소유 매장 범위에서 대상·결제·기존 확정 환불·가능 조건·금액·사유·필요 동의를 확인한다.
2. Payment → Ticket → TicketPause → UsageSession → SeatAssignment 순서로 필요한 행을 잠그고 다시 검증한다. 거절이면 아무 업무 상태도 바꾸지 않는다.
3. 필요한 퇴실·시간 차감 후 Ticket REVOKED, 기존 정지 기록 closedAt·closeReason 종료, 고정석 해제, 확정된 환불 금액의 Refund ACCEPTED와 최초 PaymentCancel을 함께 저장한다. 0원은 PG 취소 요청 없이 PAID·원장 0원을 같은 트랜잭션에 저장한다.
4. PG 호출·종료 Job 제거는 커밋 뒤 수행한다. PG 전송 실패·거절도 업무 확정을 되돌리지 않고 미지급 조치 필요로 남긴다. 접수 응답에는 이용 종료와 환불금 지급 상태를 구분한다.

종료 동의와 기존 이용 중 퇴실 동의는 한 화면 확인으로 전달할 수 있다. 미사용·만료·기존 정지 이용권의 환불 가능 조건을 일반 pauseTicket의 ACTIVE 조건에 종속시키지 않는다.

### 환불 멱등 실행 구조

고객·점주 환불 접수는 `RefundAcceptanceExecutionService.executeAcceptance`가 실행한다. 각 호출부의 검증·확정 함수는 트랜잭션 안에서 `{ result, pending }`을 반환한다. 전용 서비스는 같은 트랜잭션에서 멱등 기록에 `refundId`를 저장하고, 커밋 뒤 최초 PG 전송 결과를 반영한 응답을 저장한다. 기한이 지난 요청을 확보한 뒤 최신 기록에 `refundId`가 있으면 환불을 다시 확정하거나 최초 전송을 반복하지 않고 저장된 환불 상태로 응답을 재구성한다. 미전송 PG 요청의 후속 처리는 기존 복구 경로가 맡는다.

별도 지급 예약·증빙 확정·미지급 종료·금액 검토는 `RefundIdempotencyService.executeInTransaction`으로 업무 변경과 최초 응답을 같은 트랜잭션에서 저장한다. 일반 PG 재시도는 pg-check에서 조회·작업 토큰·지급 조건 검사 후 전송을 준비하고 커밋 뒤 호출한다. 별도 운영자 재시도의 멱등 응답 저장 절차를 적용하지 않는다. 두 실행 흐름은 실제로 동일한 키·핑거프린트 검증, 요청 확보, 권한 재확인, 저장된 응답 재생을 공유하며, 접수 전용 PG 전송·환불 복구 분기는 이 공통 절차에 넣지 않는다. 행 락·락 대기 뒤 최신 기록 조회·담당 토큰 조건부 저장·삭제와 기존 트랜잭션 경계를 유지한다. 접수와 별도 지급의 기존 멱등성 계약은 유지하며, 일반 PG 재시도 계약은 pg-check 통합 규칙으로 변경한다.

## 2. PG 결제 취소와 미지급 관리

- Refund는 업무 확정·환불금 지급 합계, PaymentCancel은 시도 상태를 가진다. 성공 실제액·시도 상태·합계·원장·알림은 같은 트랜잭션에서 한 번만 저장한다. 원장은 RELEASABLE이며 고객 은행 명세 반영 시점과는 구분한다.
- PG가 취소한 실제 금액이 확정된 환불 금액과 일치하면 `Refund.payoutStatus`를 `PAID`로 설정한다. 두 금액이 다르면 `Refund.payoutStatus`를 `ACTION_REQUIRED`로 설정하고 부족액 또는 초과액을 표시해 운영 검토 대상으로 둔다. `Refund.amount`는 변경하지 않는다. 부족액은 부족분만 별도로 지급하며, 초과액은 추가 지급을 막고 운영자가 검토한 뒤 `Refund.payoutStatus`를 `PAID`로 정리한다. 이때 실제 지급액과 원장 금액은 덮어쓰지 않는다.
- 일반 PG 재시도는 점주·운영자의 pg-check로 통합한다. 별도 운영자 직접 재시도 경로는 일반 PG 재시도에 사용하지 않는다. 별도 지급을 확실한 미지급으로 실패 종료한 뒤 MANUAL에서 PG 지급으로 전환하는 절차는 별도 검토 사항이다. 이번 변경에서 API·권한·전송 절차를 새로 확정하지 않으며, PG 방식의 일반 재시도와 구분한다.
- 송신 결과 미수신은 재조회부터 한다. 백그라운드 자동 작업은 PG 미접수 확정 때만 모든 경로에서 같은 시도 ID·금액으로 한도 내 재전송한다. 한도를 소진한 전송도 PG 미접수가 확인돼야 시도를 FAILED/RETRY_EXHAUSTED로 종료한다. FAILED는 자동 PG 조회·재전송에서 제외하고 Refund ACTION_REQUIRED는 운영자 처리 목록에 남긴다. 결과 불명·PG 처리 중이면 한도 소진 후에도 조회를 이어간다. 확정 시도 실패가 환불금을 포기하는 상태는 아니다.
- 조회 실패 연속 한도는 QUERY_FAILED로 표시한다. DB 일정과 단일 복구 제어 행으로 긴 간격의 가장 오래된 1건 조회→정상 응답 뒤 배치 조회를 실행한다. MANAGER 즉시 재개도 같은 담당 토큰을 사용한다.

점주·운영자의 개별 확인은 기존 PaymentCancel.id로 PG 상태를 먼저 조회한다. PaymentCancel.status=REQUESTED 또는 QUERY_FAILED인 요청은 성공이면 실제 취소액·거래 ID·원장을 중복 없이 반영하고, 처리 중이면 조회를 이어간다. 확실한 미접수이면 기존 PaymentCancel.id·금액으로 재전송한다. 최종 거절이면 FAILED/PG_REJECTED로 기록하고 같은 실행에서는 전송하지 않는다. 실행 시작 시 PaymentCancel.status=FAILED이고 failureCode가 SEND_FAILED·RETRY_EXHAUSTED·PG_REJECTED인 요청은 미접수·최종 거절이 확인되면 이전 실패 상태·사유·횟수를 보존하고 같은 Refund 아래 새 PaymentCancel을 생성해 전송한다. FAILED/SEND_FAILED·FAILED/RETRY_EXHAUSTED의 성공·처리 중 조회는 새 요청을 만들지 않고 기존 요청에 반영한다. 실행 시작 시 PG_REJECTED였던 기존 요청의 조회 결과가 성공·처리 중이면 Refund.actionCode=PG_RESULT_CONFLICT·Refund.reviewRequired=true와 운영자 알림으로 기록하고 추가 지급을 차단한다. 조회 오류이면 전송하지 않고 확인 불가를 기록한다. REQUESTED·QUERY_FAILED 및 FAILED/SEND_FAILED·FAILED/RETRY_EXHAUSTED·FAILED/PG_REJECTED의 재확인·재시도는 점주·운영자의 pg-check로 통일한다. 별도 일반 PG 재시도 API는 제공하지 않는다. 조회 후 전송 준비·결과 저장 시 Refund → PaymentCancel → ManualRefundPayout 순서로 필요한 행을 잠그고 현재 상태·지급액·다른 지급 작업·활성 별도 지급 예약·자기 작업 토큰을 재검사한다. 실제 지급액 0·다른 미확정 지급 없음·지급 방식 PG·활성 예약 없음이 재전송·새 요청 생성의 조건이다. 외부 호출은 트랜잭션 밖에서 수행한다. 유효한 다른 작업과 최근 조회 간격 안의 반복 실행은 PG를 중복 호출하지 않는다. SEND_FAILED·RETRY_EXHAUSTED는 PG 최종 거절과 구분하는 내부 처리 중단 사유다. FAILED/SEND_FAILED·FAILED/RETRY_EXHAUSTED를 조회해 성공·처리 중을 반영하는 경우에만 이전 상태·사유를 거래 로그에 남기고 기존 PaymentCancel.failureCode·PaymentCancel.failureReason·PaymentCancel.failedAt을 해제한다. 처리 중이면 기존 PaymentCancel.status=REQUESTED, Refund.payoutStatus=PENDING으로 변경한다. 미접수·최종 거절 후 새 요청을 생성하는 경우에는 이전 FAILED 행을 변경하지 않고 새 PaymentCancel.status=REQUESTED, Refund.payoutStatus=PENDING으로 변경한다. 두 경우 모두 이전 내부 실패의 Refund.actionCode·Refund.actionReason을 해제하며 별도의 검토 사유는 유지한다. 성공은 실제액에 따른 기존 지급 완료·금액 불일치 규칙을 따른다. 조회 오류이면 기존 상태를 유지한다. 기존 요청의 resendCount는 초기화·증가하지 않고 개별 재전송 시 manualResendCount·sendAttemptCount와 lastSendAttemptAt을 갱신한다. FAILED/SEND_FAILED·FAILED/RETRY_EXHAUSTED·FAILED/PG_REJECTED 뒤 새 요청의 resendCount·manualResendCount는 0부터 시작한다. 자동 작업의 미접수·한도 규칙은 유지한다.

## 3. 별도 환불금 지급 운영

PG 취소 요청들이 모두 최종 상태이고 미지급액이 양수인 조치 필요 건에서만 MANAGER가 별도 환불금 지급을 예약한다. 예약액은 미지급액과 같으며 Refund를 잠그고 RESERVED·MANUAL 전환을 함께 저장해 PG와 다른 환불금 지급을 막는다.

운영자가 실제 지급을 외부에서 마친 뒤 거래 ID·시각·증빙으로 확정한다. 실제 지급·합계·원장을 함께 기록한다. 환불금 지급 여부를 모르면 예약을 유지하고 운영자 확인 대상으로 둔다. 담당 기한이나 단순 대기 시간 때문에 풀지 않는다. 확실한 미지급 증빙이 있어야 예약을 FAILED로 종료한다. 별도 지급을 확실한 미지급으로 실패 종료한 뒤 MANUAL에서 PG 지급으로 전환하는 절차는 별도 검토 사항이다. 이번 변경에서 API·권한·전송 절차를 새로 확정하지 않으며, PG 방식의 일반 재시도와 구분한다. 점주의 개별 확인은 이 지급 방식 전환을 하지 않는다.

이 기능은 PG 미확정 결과를 수동으로 성공 처리하는 기능이 아니다. 운영자는 새 환불 금액을 정하거나 기존 확정된 환불 금액을 바꿀 수 없다. 실제 은행 송금 실행은 범위 밖이다.

## 4. 동시성·입실·환불금 중복 지급

공유 잠금 순서는 Payment → Ticket → TicketPause → UsageSession → SeatAssignment → Refund → PaymentCancel → ManualRefundPayout이다. 필요한 행만 순서대로 잠그고 동일 종류는 ID 순이다. 기존 정지 기록은 Ticket 다음·UsageSession 이전에 잠그고 처리한다.

입실과 환불 확정은 같은 Ticket 행을 먼저 잠근다. 환불 확정이 먼저라면 해당 이용권은 이미 종료된 상태이므로, 환불금 지급이 완료됐는지와 관계없이 뒤이은 입실 요청을 HTTP 409로 거절하고 `TICKET_TERMINATED` 오류 코드를 반환한다. 입실이 먼저면 고객 환불은 사용 이력 때문에 거절된다. 정지 재개·좌석 타입/배정 변경·자동 종료도 잠금 뒤 이용권이 `REVOKED`인지 다시 확인해 종료 상태를 덮어쓰지 않는다.

PG 결과 저장·재시도·별도 환불금 지급은 Refund를 먼저 잠그고 지급들을 확인한다. 활성 PG partial unique와 활성 별도 환불금 지급 partial unique만으로 두 테이블 사이 충돌이 막힌다고 가정하지 않는다. 모든 생성 경로가 Refund 잠금과 상대 지급 검증을 공유한다.

PG 조회 담당 지정은 PaymentCancel만 짧게 갱신하고 끝내며 결과 반영은 별도 트랜잭션이다. PG 호출 중 DB 잠금을 잡지 않는다. 큐·HTTP 멱등 키 만료는 새 환불·환불금 중복 지급의 허용 근거가 아니다.

## 5. 콜백·권한·조회

원문 바이트 HMAC·발송 시각 검증, JWT 없는 두 PG 경로, 동일 canonical과 300초 편차를 유지한다. 사용자 JWT는 PG 서명을 대신하지 않는다. 실제 취소 거래 ID·원승인·Refund 대상을 대조한다.

고객은 본인, 점주는 현재 ShopOwner 매장, MANAGER는 전체 운영 범위다. 기록에는 업무 확정과 PG 취소 요청을 구분해 반환한다. 미지급 목록을 시도 실패로 숨기지 않고 실제 환불금 지급액·미지급액·사유·예약·시도 이력을 표시한다. 알림 읽음은 사람별로 관리한다.

## 6. 개발 DB 재구축·최초 배포

서비스 전 프로젝트이며 개발 데이터는 폐기할 수 있다(2026-10-30 사용자 결정). 과거 환불·PG 취소 요청 이관과 누락 원장 보충 도구, 구버전 서버 중지·전환·재개 절차는 구현하지 않는다. 빈 검증용 DB에 마이그레이션을 적용해 최종 스키마·제약·테스트 데이터 생성과 전체 회귀를 확인한다. DB 재구축을 검증했다는 기록은 실제 실행 뒤 남긴다.

사용하지 않는 이전 환불 코드는 정리하고 서버·클라이언트는 이 기능의 API 계약으로 최초 배포한다. 실제 PG의 서명·미접수 확정·최종 실패·멱등 보장은 실연동 전에 확인한다. 서비스 시작 후 생성되는 환불·원장·미확정 지급·예약을 보존하는 규칙은 유지한다. 상세 범위는 [data-model 10절](data-model.md#10-개발-db-재구축최초-배포)을 따른다.

## 구현 순서와 검증

1. 빈 DB 스키마·제약 재구축·공통 PG 결과/서명·오류 계약.
2. 종료 동의·고객/매장 판정·원자적 이용 종료·입실/좌석/정지 동시성.
3. 실제 지급·원장·합계·알림·시스템 자동 취소.
4. 조회·재전송·장애 복구·점주/운영자 개별 PG 확인·권한별 PG 취소 재요청.
5. 별도 환불금 지급 예약·증빙·미지급 확인·불일치 검토·권한·읽음.
6. 전체 회귀·중복/경쟁/크래시·빌드·린트·TDD 증거 검증.

각 동작은 헌법의 red/green 순서로 구현한다. [quickstart](quickstart.md)에 모든 인수 시나리오의 HTTP 검증 항목을 둔다. 문서의 링크·식별자·상태·설정·매핑 점검과 실제 구현 정확성·테스트 실행 결과를 구분해 보고한다. 기존 v0.2의 설계 검증 통과 보고를 새 설계의 구현 보증으로 재사용하지 않는다.
