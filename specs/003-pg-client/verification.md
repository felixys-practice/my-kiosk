# PG 작업 준비 확인 기록

**확인일**: 2026-11-15
**범위**: T001 Git·호출처 확인, T002 테스트 명령 검증, T003 시나리오별 검증 계획. PG 구현 완료 기록이 아니다.

## T001 Git 상태와 작업 보호

- 실제 브랜치: feature/pg-client. HEAD: 8fde6fc(PR #10 병합 커밋).
- 시작 시 기존 추적 변경: .specify/extensions.yml, .specify/memory/constitution.md.
- 시작 시 기존 미추적: .agents/skills/technical-writing-review/, .serena/, specs/003-pg-client/, src/idempotency-challenge/.
- .serena/·src/idempotency-challenge/는 조사·작업에서 제외했다. 기존 파일을 되돌리거나 staging·커밋하지 않았다.
- 활성 feature.json은 specs/003-pg-client다. 이 경로 설정과 Git 브랜치 이름은 독립적이다.

## T001 현재 호출 관계

- PgModule: PG_CANCEL_CLIENT → UnconfiguredPgCancelClient, REFUND_PG_GATEWAY → 기존 PgService.
- PgService: sendCancel·inquireCancel → PgCancelClient.send·inquire. 결과 타입은 pg.types.ts.
- 환불 직접 호출자: RefundAcceptanceExecutionService·RefundDispatchService는 취소 요청, RefundRecoveryService·RefundRetryService는 취소 조회를 호출한다.
- 기존 승인 요청의 requestVan·requestedPayment와 승인 콜백 업무는 변경하지 않는다. 승인액 불일치·좌석 실패의 시스템 환불은 위 환불 호출자 경로로 보존한다.
- 전환 대상: PgClient·PG_CLIENT, requestPaymentCancel·inquirePaymentCancel, PgService 직접 주입. 구형 Gateway·클라이언트·토큰은 참조 전환 뒤 제거한다.

## T001 참조 파일 목록

아래는 현재 src/test에서 토큰·인터페이스·기존 메서드명을 검색한 결과다. 목록은 변경 완료나 모든 파일의 수정 필요를 뜻하지 않는다. 각 테스트의 기존 기대값을 보존하고 새 경계에 맞춰 참조를 판단한다.

### 운영 코드

- `src/pg/pg-cancel.client.ts`: PG_CANCEL_CLIENT, PgCancelClient
- `src/pg/pg.module.ts`: REFUND_PG_GATEWAY, PG_CANCEL_CLIENT, PgCancelClient
- `src/pg/pg.service.ts`: PG_CANCEL_CLIENT, PgCancelClient, sendCancel, inquireCancel
- `src/pg/refund-pg.gateway.ts`: REFUND_PG_GATEWAY, RefundPgGateway, sendCancel, inquireCancel
- `src/refund/refund-acceptance-execution.service.ts`: REFUND_PG_GATEWAY, RefundPgGateway, sendCancel
- `src/refund/refund-dispatch.service.ts`: REFUND_PG_GATEWAY, RefundPgGateway, sendCancel
- `src/refund/refund-recovery.service.ts`: REFUND_PG_GATEWAY, RefundPgGateway, inquireCancel
- `src/refund/refund-retry.service.ts`: REFUND_PG_GATEWAY, RefundPgGateway, inquireCancel

### 소스 옆 테스트

- `src/pg/pg.service.spec.ts`: PgCancelClient, sendCancel, inquireCancel
- `src/refund/refund-acceptance.integration.spec.ts`: REFUND_PG_GATEWAY, sendCancel, inquireCancel
- `src/refund/refund-acceptance.service.spec.ts`: RefundPgGateway, sendCancel, inquireCancel
- `src/refund/refund-idempotency.service.spec.ts`: RefundPgGateway, sendCancel
- `src/refund/refund-result.integration.spec.ts`: REFUND_PG_GATEWAY, sendCancel, inquireCancel
- `src/refund/refund-store.integration.spec.ts`: REFUND_PG_GATEWAY, sendCancel, inquireCancel

### E2E·헬퍼

- `test/helpers/refund-pg.stub.ts`: RefundPgGateway, sendCancel, inquireCancel
- `test/refund-bootstrap.e2e-spec.ts`: REFUND_PG_GATEWAY
- `test/refund-callback-auth.e2e-spec.ts`: REFUND_PG_GATEWAY
- `test/refund-concurrency.e2e-spec.ts`: REFUND_PG_GATEWAY, inquireCancel
- `test/refund-crash-recovery.e2e-spec.ts`: REFUND_PG_GATEWAY, inquireCancel
- `test/refund-customer.e2e-spec.ts`: REFUND_PG_GATEWAY
- `test/refund-entry.e2e-spec.ts`: REFUND_PG_GATEWAY
- `test/refund-history.e2e-spec.ts`: REFUND_PG_GATEWAY
- `test/refund-ledger.e2e-spec.ts`: REFUND_PG_GATEWAY
- `test/refund-notifications.e2e-spec.ts`: REFUND_PG_GATEWAY
- `test/refund-operations.e2e-spec.ts`: REFUND_PG_GATEWAY
- `test/refund-payment-mismatch.e2e-spec.ts`: REFUND_PG_GATEWAY
- `test/refund-recovery.e2e-spec.ts`: REFUND_PG_GATEWAY
- `test/refund-store.e2e-spec.ts`: REFUND_PG_GATEWAY

## T002 실행 기록

- 기본 제한 환경의 npm run test: 54파일 중 47 통과·7 실패, 테스트 420 통과·1 실패·183 미실행. DB 준비·연결 단계 실패가 있어 green으로 기록하지 않는다.
- 권한 확장 환경의 기존 src/prisma/prisma.integration.spec.ts: SELECT 1 연결 테스트 1개 통과. 마이그레이션·DB 초기화·시드는 실행하지 않았다.
- PG 파일: 23개 통과. 이름 선택 실행은 1개 통과·22개 제외를 확인했다.
- Vitest 원래 -t 명령은 0개 일치에도 종료 0이다. JSON 결과의 실행 개수를 확인하는 wrapper는 1개 선택 시 종료 0, 0개 선택 시 종료 2다.
- PG 파일 범위 커버리지는 /private/tmp/pg-client-coverage에 HTML·JSON 보고서 생성. 전체 프로젝트 커버리지 수치가 아니다.
- PG 파일 watch: 23개 통과 후 파일 변경 대기, q 입력으로 종료 0.
- 최종 전체 단위·통합: 54파일·604개 통과, 실패·미실행 0개. JSON 관측 시간 11.07초.
- 최종 전체 E2E: 16파일·200개 통과, 실패·미실행 0개. JSON 관측 시간 47.51초.
- 기존 고객 환불 첫 시나리오의 단일 E2E 선택은 통과, 0건 선택은 wrapper 종료 2를 확인했다.
- PG 단일 선택·파일·watch·커버리지와 전체 suite·E2E 선택 명령을 Vitest 프로필에 반영했다. 프로필에 실제 실행하지 않은 capability는 null로 기록했다.
- 이전 Jest 프로필의 명령·예시·공용 helper·전체 기준선·실행 제약을 현재 구성으로 교체했다. 전체 변경 행은 /private/tmp/pg-client-tdd-profile-refresh.diff에 보관했다.
- 테스트에서 pg client.query 사용의 deprecation 경고가 있었으며 구현·테스트를 수정하지 않았다.
- 관련 원본 JSON/log는 /private/tmp/pg-client-unit-suite.*, /private/tmp/pg-client-e2e-suite.*에 있다. 임시 파일이므로 영속 증거로 간주하지 않는다.
- T002 완료 시점에는 T001·T002만 완료했으며 PG 구현·커밋은 실행하지 않았다.

외부 PG·은행 호출은 검증하지 않았다. 기존 헌법은 수정하지 않는다. 이번 작업에서는 별도 tdd-plan과 자동 tdd-run을 실행하지 않는다.

## T003 시나리오별 검증 계획

**작성일**: 2026-11-15. 기존 테스트 본문을 읽어 재사용·보완 여부를 확인했다. 아래 신규·보완 테스트는 작성하거나 실행하지 않았다. T002의 전체 기존 테스트 통과를 신규 동작 검증 결과로 간주하지 않는다.

| QS | 명세 | 검증 파일 | 재사용·신규·보완 | 태스크 |
| --- | --- | --- | --- | --- |
| QS-1 | US1-1 | `test/refund-recovery.e2e-spec.ts` | 기존 QS-5-1 재사용. 새 PgService 대역으로 전환 | T017 |
| QS-2 | US1-2 | `test/refund-recovery.e2e-spec.ts`; `test/refund-crash-recovery.e2e-spec.ts` | 기존 QS-5-4·QS-5-6 및 중단 복구 사례 재사용 | T018 |
| QS-3 | US1-3 | `test/refund-ledger.e2e-spec.ts`; `test/refund-recovery.e2e-spec.ts`; `test/refund-crash-recovery.e2e-spec.ts` | 기존 QS-4-2·U416/U418 재사용. 세 결과 경로 조합의 누락은 보완 필요 | T017·T018 |
| QS-4 | US1-4 | `test/refund-payment-mismatch.e2e-spec.ts` | 기존 QS-6-1~QS-6-3 및 저장 실패 롤백 사례 재사용 | T019 |
| QS-5 | US1-5 | `test/seat-type.e2e-spec.ts`; `test/refund-recovery.e2e-spec.ts` | 기존 좌석 QS-31·시스템 환불 복구 재사용. QS-31의 PG 호출 ID·금액/순서 검증은 보완 필요 | T019 |
| QS-6 | US2-1 | `test/pg-client.e2e-spec.ts` | 신규. 기존 refund-test-context의 데이터 준비·정리를 재사용하되 PG 대역 교체하지 않음 | T028 |
| QS-7 | US2-2 | `test/pg-client.e2e-spec.ts` | 신규. 내부 클라이언트 조회이며 새 공개 API를 추가하지 않음 | T029 |
| QS-8 | US2-3 | `test/pg-client.e2e-spec.ts` | 신규. 기존 crash-recovery의 영속 DB 복구 테스트와 목적이 다름 | T029 |
| QS-9 | US2-4 | `test/pg-client.e2e-spec.ts` | 신규. client 단위 검증과 환불 복구의 조회 오류 처리도 연결해 확인 | T029 |
| QS-10 | US3-1 | `test/pg-client-startup.e2e-spec.ts`; `test/pg-client.e2e-spec.ts` | 신규. 기존 refund-bootstrap은 새 provider 연결 회귀로 별도 재사용 | T034·T037·T038 |
| QS-11 | US3-2 | `test/pg-client-startup.e2e-spec.ts` | 신규. 실제 시작 검증이며 HTTP 거부 응답을 요구하지 않음 | T034·T038 |
| QS-12 | US3-3 | `test/pg-client-startup.e2e-spec.ts` | 신규. env·모듈 캐시 격리 필요 | T034·T038 |
| QS-13 | US3-4 | `test/pg-client-startup.e2e-spec.ts` | 신규. 운영 클래스 단위 검사만으로 대체하지 않음 | T034·T038 |
| QS-14 | US3-5 | `test/pg-client-startup.e2e-spec.ts` | 신규. 가상 운영 키를 필수로 추가하지 않음 | T035·T038 |

### 기존 사례 확인 근거

- QS-1: refund-recovery.e2e-spec.ts의 기존 QS-5-1에서 전송 전 실패·이용 종료·미지급 상태를 검사한다.
- QS-2: 같은 파일의 QS-5-4·QS-5-6은 미접수 확인 후 재전송과 한도 소진을 검사한다. crash-recovery 사례는 중단 후 재조회·최종 반영을 보완한다.
- QS-3: refund-ledger.e2e-spec.ts의 QS-4-2는 반복 지급 확정 통보의 원장 중복 방지를, crash-recovery의 U416·U418은 재조회·중복 실행의 최종 반영을 확인한다. 콜백·조회·즉시 응답의 모든 조합을 이미 검증한다고 주장하지 않는다.
- QS-4: refund-payment-mismatch.e2e-spec.ts의 QS-6-1은 승인액 보존·FAILED·이용권 0·선점 해제·환불/취소 요청 금액과 호출을 확인한다. QS-6-2·6-3과 저장 실패 롤백도 유지한다.
- QS-5: seat-type.e2e-spec.ts의 QS-31은 REVOKED·상품 대상 환불·취소 시도 1건을 확인한다. PG 요청의 실제 호출 ID·금액과 커밋 후 호출 여부는 추가 확인이 필요하다.

### 구현 시 지킬 구분

- 기존 001·002의 QS 표기는 과거 증거다. 번호를 일괄 교체하지 말고 003 대응표와 연결한다. 새 테스트는 003의 QS와 동작 하나를 명확히 표시한다.
- 신규 pg-client E2E는 기존 준비·정리 helper를 사용하되 PG 서비스 대역으로 실제 모의 구현을 가리지 않는다.
- 모의 취소 결과의 메모리 유실은 업무 DB의 환불 기록 유실과 다르다. 앱 A 데이터는 앱 B 검증 전 지우지 않고 마지막에 자기 데이터만 정리한다.
- 시작 거부는 Joi 함수만 호출하는 단위 검증으로 대체하지 않는다. 설정 실패 사례별로 기존 필수 환경은 유지하고 대상 PG 설정만 바꾼다.
- T003 문서 작업 완료. 테스트 코드·PG 구현·DB·서버 실행은 하지 않았다.

## T004 공통 PG 클라이언트 계약

**검증일**: 2026-11-15.

- `src/pg/pg.client.ts`에 `PgClient`, `PG_CLIENT`, 취소 요청·조회 입력 타입과 시작 검증 결과 타입을 추가했다.
- 취소 요청·조회 결과는 기존 `PgCancelSendResult`·`PgCancelQueryResult`를 그대로 사용한다.
- 시작 검증 결과는 준비 완료 또는 미구현·필수 설정 누락을 구분한다. `fields`는 설정 이름만 전달한다. 모드 선택 오류는 이 클라이언트 계약에 포함하지 않는다.
- `npx tsc --noEmit --incremental false` 통과(종료 코드 0).
- 인터페이스·타입·주입 토큰만 추가했다. 기존 앱 연결·취소 구현·승인 흐름은 변경하지 않았다. DB 변경과 테스트 실행은 하지 않았다.

## T021·T022 일부: 최초 모의 취소 성공

**검증일**: 2026-11-15.

- 최초 취소 요청에 요청액 전액과 비어 있지 않은 모의 거래 ID의 SUCCEEDED를 반환하도록 구현했다.
- 새 단위 테스트 1개의 동작 실패를 확인한 뒤 구현하여 통과했다. 실행 증거는 `tdd/cycle-log.md`에 기록했다. TypeScript 타입 검사도 통과했다.
- 결과 Map 저장·조회가 아직 없으므로 T021·T022는 미완료로 유지한다. 조회 메서드는 현재 QUERY_ERROR를 반환하는 골격이다.
- 앱 provider 연결·DB·외부 PG 호출은 변경하거나 실행하지 않았다.

## T021·T022 완료: 모의 취소 결과 저장·조회

**검증일**: 2026-11-15.

- 취소 성공 결과를 인스턴스 Map에 PaymentCancel.id별로 저장하고 조회한다. 서로 다른 두 ID의 조회 결과가 각각의 취소 결과와 같은지 검사했다.
- 새 테스트의 조회 결과 불일치 실패를 먼저 확인하고 구현했다. 기존 최초 성공 테스트와 함께 2개 통과, 타입 검사 통과.
- T021·T022를 완료 표시했다. 같은 ID 재요청·기록 없는 조회·인스턴스 수명·금액 검증의 완료를 의미하지 않는다.
- 브랜치는 feature/pg-client를 유지했다. 앱 연결·DB·외부 통신은 변경하지 않았다.

## T023·T024 일부: 같은 ID·금액의 결과 재사용

**검증일**: 2026-11-15.

- 같은 ID·금액의 재요청은 최초 성공 결과를 반환하고 이후 조회도 최초 결과를 유지한다.
- 새 거래 ID 때문에 테스트가 실패하는 것을 확인한 뒤 구현했다. 모의 클라이언트 테스트 3개와 타입 검사 통과.
- 다른 금액 재요청 처리가 남아 T023·T024는 미완료로 유지한다. 앱 연결·DB·외부 통신은 변경하지 않았다.

## Phase 4 모의 클라이언트 단위 구현 완료

**검증일**: 2026-11-15.

- T021~T027 완료. 같은 ID·금액은 최초 결과를 반환한다. 다른 금액은 UNKNOWN을 반환하며 최초 조회 결과를 보존한다.
- 기록 없는 ID와 별도 인스턴스 조회는 QUERY_ERROR다. 기존에 구현된 동작을 추가 테스트로 확인했으며 테스트 우선 구현으로 주장하지 않는다.
- 요청액이 0 이상 안전 정수가 아니면 결과 저장 전에 NOT_SENT를 반환한다. 0과 최대 안전 정수는 허용한다.
- 모의 테스트 14개와 기존 PgService 테스트 23개, 총 37개 통과. 타입 검사 통과. 실패 증거는 tdd/cycle-log.md에 보관했다.
- Phase 4 전체 완료는 아니다. T028~T029의 앱 연결 E2E는 실행 순서표에 따라 환경 선택·구조 전환 후 수행한다. DB·외부 네트워크·앱 provider는 이번에 변경하지 않았다.
- 사용자의 변경 지시에 따라 이후 승인 요청은 Phase 단위로 한다. 동작별 테스트·실패 확인은 Phase 내부에서 계속 수행한다.

## 재구성 후 Phase 2 완료: 운영용 골격

**검증일**: 2026-11-15.

- ProductionPgClient의 validateConfiguration은 항상 ready:false·PG_IMPLEMENTATION_INCOMPLETE를 반환한다. 취소 요청·조회는 각각 명시적 미구현 오류로 Promise를 거부한다. 성공·접수·확정 미접수 결과를 만들지 않는다.
- PG사 선정 후 요청 매핑·인증·AbortSignal 전달·응답 변환·전송 전 실패 판단·필수 설정 검증을 구현할 위치를 코드 주석에 기록했다. URL·API 키·PG 응답 규격은 만들지 않았다.
- 세 동작의 테스트 실패를 각각 확인한 뒤 구현했다. 운영용 3개·모의 14개·기존 PgService 23개, 총 40개 테스트 통과. TypeScript 타입 검사 통과.
- T030·T031 완료 표시. 새 Phase 2의 모든 태스크 완료. 앱의 provider 선택과 실제 서버 시작 거부는 Phase 3의 미완료 작업이다.
- 실제 PG 통신·DB 변경·앱 연결 변경은 수행하지 않았다.

## Phase 3 완료: PG 호출 구조·환경 선택·서버 시작 검증

**검증일**: 2026-11-15.

### 변경과 보존

- 환불 실행·전송·복구·재시도 서비스가 PgService를 직접 주입받고 requestPaymentCancel·inquirePaymentCancel을 호출한다. 해당 서비스의 락·리스·담당 토큰·트랜잭션·업무 결과 반영 순서는 변경하지 않았다.
- PgService는 PG_CLIENT로 의미 기반 결과를 받으며 기존 제한 시간·AbortSignal·타이머 정리·예외 결과를 유지한다. 성공 정보의 비어 있지 않은 거래 ID와 0 이상 안전 정수 실제액을 검사한다. 유효한 실제액은 요청액과 달라도 그대로 전달한다.
- PgModule은 명시적인 PG_MODE로 두 구현 중 하나를 선택한다. 모드 기본값·자동 모의 대체는 없다. 선택 구현의 준비 검사에서 미구현·필수 설정 누락을 이유와 함께 거부한다.
- Joi 스키마는 모드 필수값과 환경 조합을 검사하며 기존 환불 제한 시간·리스 관계를 보존한다. configuration은 pg.mode를 제공한다.
- 시작 실패 로그의 설정값 노출을 막기 위해 AppModule도 동일 validateEnvironment 함수를 사용하도록 변경했다. 이는 시작 안내를 실제 앱에 적용하기 위한 변경이며 업무 모듈은 추가하지 않았다. 오류는 코드·항목명·고정된 이유만 출력한다.
- E2E 대역은 PgService의 취소 요청·조회 메서드만 구현한다. PgService를 상속하지 않는다. setup-env.ts가 simulated를 명시하며 기존 helper는 이 공통 설정을 사용한다.
- PaymentService·PaymentRepository·PaymentModule과 PgService의 기존 requestPaymentApproval 본문은 보존했다. 구형 정의 파일의 삭제는 Phase 5에 남긴다.

### T005 기존 가상 HTTP 검증의 대응

| 이전 검증 의미 | 새 검증 |
| --- | --- |
| 미연동 전송 전 실패·조회 불가 | 클라이언트 NOT_SENT·QUERY_ERROR 전달. 미구현 구현의 앱 시작 거부는 시작 E2E로 별도 확인 |
| 접수·즉시 성공·거절 | 클라이언트 ACCEPTED·SUCCEEDED·REJECTED와 실제액·거래 ID·사유 전달 |
| 조회 성공·실패·처리 중·확정 미접수 | SUCCEEDED·FAILED·IN_PROGRESS·authoritative:true인 NOT_FOUND 전달 |
| 일반 404·인증 오류·상태 없는 오류·비정상 HTTP 본문 | 클라이언트가 해석한 QUERY_ERROR·UNKNOWN의 보존. HTTP 응답 해석은 PgClient 책임으로 이동했으므로 서비스에서 가상 HTTP 형식을 재현하지 않음 |
| 성공 응답의 필수 정보 누락 | 요청 UNKNOWN·조회 QUERY_ERROR와 ID·실제액의 추가 경계 검증 |
| 송신·조회 타임아웃, 동기·비동기 예외, 중단 시 거부 | 새 메서드에서 동일 의미 유지, AbortSignal 전달·타이머 정리도 검사 |

실제 PG사 HTTP 응답 해석은 운영용 골격에 구현되지 않았다. 위 검증을 실제 PG 응답 해석의 완료 증거로 사용하지 않는다.

### 검증 결과

- 전체 단위·통합: `npm run test -- --reporter=json --outputFile=/private/tmp/pg-phase3-unit.json` — 650개 통과, 실패 0, 종료 코드 0.
- 최종 전체 E2E: `npm run test:e2e -- --reporter=json --outputFile=/private/tmp/pg-phase3-e2e-final.json` — 17개 파일·208개 통과, 실패 사례·실패 파일 0, success:true, 종료 코드 0.
- 새 시작 E2E는 8개 사례이며 업무 DB 없이 실제 Nest 앱의 ConfigModule·PgModule 초기화와 시작 거부·모드/구현 로그·설정값 비노출을 검사한다. 같은 검증 함수를 쓰는 전체 AppModule 연결은 기존 bootstrap 및 전체 E2E에서 확인했다. 프로세스 실행 파일을 별도로 실행하거나 외부 PG에 접속한 검증은 아니다.
- TypeScript: `npx tsc --noEmit --incremental false` 통과.
- 첫 전체 E2E는 사례 208개가 통과했지만 seat-type의 afterAll이 실패해 종료 코드 1이었다. 모의 성공으로 생긴 환불 원장을 남겨 두고 PaymentCancel을 먼저 지워 ledger_zero_payout_amount_check에 걸렸다. 이 테스트 사용자들의 원장을 먼저 삭제하도록 정리 순서만 수정한 뒤 전체 E2E를 다시 통과했다.
- 실패한 두 실행의 잔여 데이터는 해당 실행 초기화 시각·테스트 전용 이메일·매장 소유 관계를 확인하고 수정된 테스트 정리 코드로 삭제했다. 실행별 사용자 3명·매장 1개가 일치하지 않으면 삭제하지 않도록 제한했다. 첫 식별 시도는 아무 데이터도 삭제하지 않고 중단했으며, 보완 후 사용자 총 6명과 두 매장의 연관 데이터를 정리했다.
- 기존 pg client.query deprecation 경고는 유지되며 이번에 라이브러리를 변경하지 않았다. 로그·JSON 임시 파일은 영속 증거로 간주하지 않는다. 새 동작 실패 발췌는 tdd/cycle-log.md에 남겼다.

### 태스크 상태

- T005~T016·T032~T039 완료. T017~T020의 provider·메서드 참조도 함께 전환했으나 Phase 4의 시나리오 보완 검증 전이므로 해당 체크는 유지한다.
- Phase 4의 실제 SimulatedPgClient 환불 HTTP E2E(T028~T029), Phase 5의 구형 파일 제거·최종 검증·문서 검수는 완료하지 않았다.

## Phase 4 완료: 환불 업무와 모의 클라이언트 앱 통합 검증

**검증일**: 2026-11-15.

### 실제 모의 클라이언트 연결

- `test/pg-client.e2e-spec.ts`는 PgService·PG_CLIENT를 대역으로 교체하지 않은 앱에서 환불 HTTP 요청을 보낸다. 실제 SimulatedPgClient와 PgService 주입을 확인했다.
- QS-6·QS-7: 즉시 취소 성공 후 Refund.payoutStatus=PAID, PaymentCancel.status=SUCCEEDED, 요청액과 같은 actualAmount, Ticket.status=REVOKED, paidAmount와 음수 원장 1건을 확인했다. 클라이언트·서비스 조회의 거래 ID·실제액이 DB와 같고 동일 성공 콜백·후속 복구 실행에도 원장이 추가되지 않았다.
- PG 통신 비사용 근거: 해당 흐름에서 ProductionPgClient.requestPaymentCancel과 fetch 호출은 0회였다. SimulatedPgClient 구현도 crypto·인스턴스 Map만 사용하고 PG 네트워크 API·DB를 호출하지 않는다. 앱의 업무 DB·Redis·로컬 HTTP 통신까지 없다는 뜻은 아니다.
- QS-8: 앱 A를 데이터 삭제 없이 종료하고 새 앱 B를 생성했다. 기존 고객 토큰으로 B의 환불 조회 API를 호출하면 PAID·기존 지급액·원장 1건이 유지됐다. B의 모의 PG 조회는 QUERY_ERROR였다. OS 프로세스를 강제 종료한 검증은 아니며 Nest 앱과 클라이언트 인스턴스를 재생성한 검증이다.
- QS-9: PG 성공 후 업무 결과 저장 직전에 중단시키고 앱을 재생성했다. 새 모의 클라이언트에 기록이 없는 상태에서 복구 조회는 QUERY_ERROR, inquiryFailureCount는 1 증가했다. sendAttemptCount·resendCount는 유지되고 재전송 호출은 0회였다. 환불 조회는 PENDING·paidAmount=0, 원장 0건이었다. 임의의 미기록 ID 조회도 QUERY_ERROR였다.
- 중단은 테스트의 recordSendResult 1회 실패 주입으로 만들었다. 모의 PG의 정상 취소·조회 구현이나 업무 코드를 바꾸지 않았다.

### 기존 업무 검증과 보완

| 태스크 | 검증 근거 |
| --- | --- |
| T017 / QS-1·QS-3 | 고객·매장·원장 E2E 통과. recovery의 기존 QS-5-1에 미확정 실제액·원장 0건 검증 보완. 실제 모의 즉시 성공 이후 중복 콜백, 별도 원장 테스트의 조회 성공 이후 중복 콜백 모두 지급액·원장 1회 반영 확인 |
| T018 / QS-2 | recovery의 QS-5-4·QS-5-6에서 authoritative NOT_FOUND의 같은 ID·금액 재전송과 한도 보존. crash-recovery U414~U419, concurrency·operations의 담당·예약 상호 배제 회귀 통과 |
| T019 / QS-4·QS-5 | payment-mismatch의 기존 QS-6-1~3 및 저장 실패 롤백 사례 통과. seat-type QS-31에 실제 PgService 호출 관찰을 추가하여 해당 요청 ID·환불액·커밋된 ACCEPTED 환불·REVOKED 이용권 상태 확인 |
| T020 | entry·history·notifications·callback-auth 및 기존 bootstrap의 새 PgService 대역 교체·서명·권한·중복·금액 검토 기대값 통과 |

좌석 시스템 환불의 관찰은 PG 호출 시 별도 Prisma 조회로 저장된 PaymentCancel·Refund·Ticket을 읽고 실제 PgService 호출을 그대로 이어간다. 단순 호출 횟수 검증으로 커밋 순서를 추정하지 않는다.

### 실행 결과와 범위

- `npm run test:e2e -- --reporter=json --outputFile=/private/tmp/pg-phase4-e2e.json` — 18개 파일·212개 테스트 통과, 실패 사례·실패 파일 0, success:true, 종료 코드 0.
- `npx tsc --noEmit --incremental false` 통과. 변경한 테스트 파일의 Prettier 정리와 git diff --check 통과.
- 앱 재생성 테스트의 첫 시도는 데이터 정리 시 중복 앱 종료로 Redis Connection is closed 오류가 났다. helper의 stopApplication으로 앱만 종료하고 최종 close에서 자기 데이터만 정리하도록 보완했다. 재검증과 최종 전체 실행에서 정리 훅까지 통과했다.
- 제품 코드는 이번 Phase에서 변경하지 않았다. 새 E2E는 이미 구현한 계약의 통합 검증이다. helper 오류를 제품 요구사항의 TDD 실패 증거로 간주하지 않는다. 상세 실행 구분은 tdd/cycle-log.md에 기록했다.
- Phase 3의 단위·통합 650개 통과 기록은 유지하며 이번에는 테스트 helper·E2E 변경에 맞춰 전체 E2E와 타입 검사를 실행했다. 전체 단위·통합의 재실행, 빌드·lint·의도적 변형·수동 시나리오는 Phase 5에 남긴다.
- T017~T020·T028~T029 완료. 다음은 Phase 5의 구형 의존 제거와 최종 검증이다. 실제 운영 PG 연동은 구현하지 않았다.

## Phase 5 의도적 변형 검증 계획 (T045)

실행 전에 기록한다. 별도 mutation 도구를 설치하지 않고 아래 구현 한 곳씩 의도적으로 바꾼다. 각 파일 원문을 보관하고 finally에서 복원한다. JSON 보고서의 실패 테스트 수와 종료 코드를 함께 확인하여 테스트 0개·컴파일 실패를 성공 증거로 사용하지 않는다.

| 대상 | 의도적 변경 | 명령 |
| --- | --- | --- |
| PgService | 거래 ID 검사에서 항상 유효하다고 반환 | `npx vitest run src/pg/pg.service.spec.ts` |
| SimulatedPgClient | 같은 ID·금액의 최초 결과 재사용을 건너뜀 | `npx vitest run src/pg/simulated-pg.client.spec.ts` |
| PgModule | 미구현 운영 골격의 준비 상태 거부를 건너뜀 | `npx vitest run --config vitest.config.e2e.mts test/pg-client-startup.e2e-spec.ts` |

각 명령에 JSON reporter와 /private/tmp 보고서 경로를 추가한다. 변형 실행 후 복원한 상태에서 동일 파일들을 다시 검증한다. DB·외부 PG·공유 업무 데이터를 바꾸지 않는 테스트만 사용한다.

## Phase 5 정적 검토·수동 확인·검수

**검증일**: 2026-11-15. 최종 전체 테스트 결과는 실행 완료 후 아래에 추가한다.

### 구형 의존 제거·보존

- pg-cancel.client.ts·refund-pg.gateway.ts를 삭제했다. src/test에서 PgCancelClient·PG_CANCEL_CLIENT·UnconfiguredPgCancelClient·RefundPgGateway·REFUND_PG_GATEWAY·PgRawResponse·sendCancel·inquireCancel 잔존 검색 결과 0건이다. 과거 설계·작업 기록의 식별자는 증거로 보존한다.
- 결제·주문·이용권 소스, Prisma 스키마·마이그레이션, package.json·잠금 파일은 기준 HEAD와 diff가 없다. PgService의 기존 requestPaymentApproval 본문도 기준 HEAD의 동일 구간과 문자열 대조로 보존을 확인했다.
- PG 클래스의 import와 호출을 확인했다. 클라이언트에 업무 DB·환불 서비스 호출은 없다. 공통 제한 시간·성공 정보 검증은 PgService에 있고 업무 상태·원장·재전송은 환불 서비스에 남아 있다.
- 002 research·plan·API §8, AGENTS.md, .env.example에 003 경계·명시적 모의 선택·미구현 운영 골격의 시작 거부를 반영했다. 공개 API·상태·멱등성·동시성·복구 규칙과 과거 002 tasks·TDD 기록은 변경하지 않았다.

### 의도적 변형 결과

| 변형 | 실패 검출 | 원복 후 결과 |
| --- | --- | --- |
| PgService 거래 ID 검사 무효화 | 관련 테스트 6개 실패, 종료 1 | PG 3개 파일 61개 통과 |
| SimulatedPgClient 같은 ID·금액 결과 재사용 차단 | 관련 테스트 1개 실패, 종료 1 | 같은 모의 테스트 포함 PG 61개 통과 |
| PgModule 운영 골격 미구현 거부 생략 | 시작 검증 1개 실패, 종료 1 | 시작 검증 8개 통과 |

변형은 모두 finally에서 원문으로 복원했다. 도구 설치·구형 테스트 삭제·성공 조건 완화는 하지 않았다. 원본 보고서는 /private/tmp/pg-phase5-mutants.json이며 임시 파일이다.

### Scalar 수동 환불

- NODE_ENV=development·PG_MODE=simulated·PORT=3017·REFUND_RECOVERY_WORKER_ENABLED=false로 전용 검증 서버를 시작했다. 기존 서버는 변경하지 않았다.
- 기존 dev:scenario -- refund-unused로 전용 계정·매장·상품을 재사용하고 새 주문·결제·미사용 시간권을 생성했다. 승인 API를 검증한 것은 아니다.
- Playwright 권한 중단과 자동 승인 검토 사용량 한도 때문에 작업이 중단됐다. 사용자가 재개를 요청했고 안내된 재시도 가능 시각 이후 다시 실행했다. 실패한 승인 검토 조작은 실행되지 않았다.
- Scalar 본문 편집기의 fill이 내부 요청 상태에 반영되지 않아 예제 UUID로 404가 반환된 시도가 있었다. 키보드 입력으로 편집기를 갱신한 후 실제 시드 이용권 ID로 전송하여 202 Accepted·ACCEPTED·PAID·10,000원 응답을 확인했다.
- DB를 읽기 전용으로 대조하여 다음 결과를 확인했다.

| 항목 | 값 |
| --- | --- |
| Ticket.id | 6ac27979-6161-491a-9267-c5b50fee5b45 |
| Ticket.status | REVOKED |
| Refund.id | 9f41ac46-9651-4516-9365-cbb7a86b57bb |
| Refund.decisionStatus / payoutStatus | ACCEPTED / PAID |
| PaymentCancel.id | fd71759c-1a3e-4b5d-bd76-ced7c08ca286 |
| PaymentCancel.status / actualAmount | SUCCEEDED / 10000 |
| 모의 취소 거래 ID | simulated-eaa99200-514b-4ee8-a9da-699eb290d269 |
| 환불 원장 | 1건, -10000원 |

이 지급액·원장은 모의 처리 결과다. 실제 PG·은행에 지급 요청하지 않았다. 시나리오가 만든 주문·결제·종료된 이용권·환불 기록은 사용자가 재확인할 수 있도록 보존한다.

### 문서 검수

technical-writing-review 스킬을 읽은 독립 서브 에이전트가 003 활성 설계 문서·작업 목록·결제 인계 문서 및 이번 002·환경 안내 변경을 읽기 전용으로 검수했다. 전환 전 구조를 현재 사실로 읽게 하는 시점 표현과 최초 전송 주체의 누락, 두 지적을 수용했다. spec·research에 변경 전 기준 커밋을 명시하고 plan에서 고객·매장 최초 전송과 시스템 환불·재전송 주체를 구분했다. 수정 부분·인접 문맥 재검수 결과는 통과다. 구현·런타임 검증을 대신하는 판정은 아니다.

### SR·FR·SC 대응표 (T046)

| 요구 | 코드·검증 근거 |
| --- | --- |
| SR-001 | 환불 실행·전송·복구·재시도 4개 서비스의 PgService 직접 주입·새 메서드 호출, 전체 E2E |
| SR-002 | PgService 단위 테스트의 결과 전달·제한 시간·예외·필수 성공 정보, 클라이언트의 의미 기반 결과 반환 |
| SR-003 | PG import·호출 정적 검토, 환불 업무 코드의 주입·호출명 외 변경 없음 |
| SR-004·SR-005 | 구형 2개 파일 삭제와 전체 src/test 식별자 잔존 0건 |
| SR-006 | PgService 단위 테스트의 PgClient 교체, RefundPgStub의 두 서비스 메서드 구현, 실제 모의 연결 E2E |
| SR-007 | 002 PG 설계·계약의 003 참조, 과거 작업·테스트 기록 보존 |
| FR-001·FR-002 | 취소·조회만 추가, 결제·주문·이용권 코드 diff 없음, 기존 전체 환불·권한·서명·동시성 회귀 |
| FR-003 | PG 업무 DB 비접근, 실제 지급액·원장은 RefundResultService 등 기존 업무 서비스가 반영 |
| FR-004 | PgService의 요청 5종·조회 5종 결과 및 timeout·예외 검증 |
| FR-005 | 실행·전송 서비스의 기존 커밋 후 호출 유지, seat-type QS-31의 호출 시 DB 조회, crash-recovery U414 |
| FR-006 | recovery·concurrency·operations·crash-recovery의 요청 ID·금액·리스·담당·한도·예약 상호 배제 |
| FR-007 | payment-mismatch·seat-type·callback-auth·entry의 승인·시스템 환불·서명·중복·저장 실패 회귀 |
| FR-008 | 실제 모의 취소 HTTP·조회 E2E, 운영 모의 시작 거부 |
| FR-010 | 필수 PG_MODE와 환경 조합, 실제 Nest 앱 시작·거부·로그 비밀값 보호 8개 사례 |
| FR-011 | ProductionPgClient 주석의 연동 위치와 미구현 오류·ready:false 단위 검증 |
| FR-012 | 새 대역 경계와 기존·추가 환불 E2E의 상태·금액·원장·호출 검증 |
| FR-014 | SimulatedPgClient Map·미기록 조회 단위 검증, 앱 종료·재생성·기록 유실·재전송 금지 E2E |
| SC-001 | 전체 환불·시스템 환불 회귀, Phase 4의 누락 기대값 보완 |
| SC-002 | Scalar 시드 이용권 환불·DB 결과, 실제 모의 연결 E2E와 PG 외부 통신 비사용 정적 근거 |
| SC-003 | pg-client-startup E2E와 development 서버의 Scalar HTTP 응답 |
| SC-004 | ledger·pg-client·crash-recovery의 중복 결과 원장 1회 반영, 기존 승인 콜백 중복 발급 회귀 |
| SC-005 | recovery QS-5-1·PgService 결과 분류·기록 없는 모의 조회의 QUERY_ERROR·재전송 금지 |
| SC-006 | 전체 취소·조회 호출처 전환, 구형 식별자 잔존 0건, requestVan 보존 |
| SC-007 | PG 계층·업무 계층 책임 정적 검토 및 서비스·업무별 테스트 교체 |
| SC-008 | DI 전환·002 설계·AGENTS·환경 안내 갱신과 과거 기록 보존 |
| SC-009 | 두 클래스의 PgClient 구현·타입 검사·운영 골격 단위 검증, 가상 운영 규격 미추가 |

### QS별 최종 검증 위치

| QS | 확인 위치 |
| --- | --- |
| QS-1 | refund-recovery의 QS-5-1, 실제액 미확정·원장 0건 보완 |
| QS-2 | refund-recovery QS-5-4·QS-5-6, crash-recovery·concurrency |
| QS-3 | refund-ledger의 중복 콜백·조회 성공 후 콜백, pg-client의 즉시 성공 후 조회·콜백 |
| QS-4 | refund-payment-mismatch QS-6-1~3·저장 실패 롤백 |
| QS-5 | seat-type QS-31의 요청 ID·금액·커밋 상태 검증 |
| QS-6·QS-7 | pg-client의 실제 모의 취소·동일 결과 조회·원장 1건 |
| QS-8 | pg-client의 앱 종료·재생성 후 기존 환불 HTTP 조회·모의 QUERY_ERROR |
| QS-9 | pg-client의 성공 저장 전 중단·기록 유실·조회 오류·재전송 0회 |
| QS-10 | pg-client-startup development/test 시작과 로그, pg-client HTTP·Scalar development HTTP |
| QS-11 | pg-client-startup 운영 환경 모의 거부 |
| QS-12 | pg-client-startup 모드 누락·미지원 값 거부 |
| QS-13 | pg-client-startup 운영 골격 미구현 거부 |
| QS-14 | pg-client-startup 설정 누락 대역의 코드·항목명·시작 거부 |

FR-009·FR-013은 명세의 통합·이관 기록을 유지하며 이번 활성 구현 요구로 계산하지 않는다. OS 프로세스 강제 종료·실제 PG API·실제 은행 지급·다중 서버 공유·영속 모의 상태는 검증하지 않았다.

### 최종 검증 결과

| 검증 | 결과 |
| --- | --- |
| 전체 단위·통합 npm run test | 56개 파일·650개 통과, 실패 0, 종료 0 |
| 최종 전체 E2E npm run test:e2e | 18개 파일·212개 통과, 실패 사례·파일 0, success:true, 종료 0 |
| npx tsc --noEmit --incremental false | 종료 0 |
| npm run build | 종료 0 |
| 변경된 기존 TS 파일과 새 PG·E2E 파일 대상 ESLint, 자동 수정 없음 | 오류·경고 0, 종료 0 |
| git diff --check | 통과 |

- lint는 삭제된 파일을 제외하고 실제 존재하는 변경 TS 파일과 새 PG·시작·모의 E2E 파일에 실행했다. 기존 Joi 테스트의 any 값 4곳을 Record<string, unknown>으로 명시하고, 테스트 mock 타입·미사용 입력 설명·포맷을 정리했다. 업무 조건이나 기대값을 완화하지 않았다.
- 린트 정리 중 좌석 테스트의 원본 메서드 보관을 래퍼로 바꾸어 스파이가 재귀 호출하는 오류가 있었다. 첫 최종 E2E는 210개 통과·좌석 2개 타임아웃으로 실패했다. 원본 메서드를 bind로 보관하되 타입을 명시하도록 수정했다. 해당 실패 실행의 잔여 전용 테스트 사용자는 없음을 확인했고, 이후 전체 E2E 212개 및 타입·빌드·린트가 통과했다.
- 단위·통합 JSON은 /private/tmp/pg-phase5-unit-final.json, 최종 E2E JSON은 /private/tmp/pg-phase5-e2e-final.json이다. 실행 로그·JSON은 임시 파일이며 위 결과를 이 문서에 보존한다.
- 현재 브랜치 feature/pg-client와 HEAD 8fde6fc를 유지했다. .specify/feature.json은 specs/003-pg-client를 가리킨다. 커밋·푸시·PR은 수행하지 않았다.
- 기존 .serena/·src/idempotency-challenge/는 수정하거나 작업 범위에 포함하지 않았다. 이번 브라우저 도구가 만든 .playwright-mcp/ 출력만 정리했다. AGENTS.md는 기존 ignore 대상이므로 수정 내용이 일반 git status에 표시되지 않는다.
- 실제 운영 PG 통신은 미구현이며 ProductionPgClient 선택은 시작을 거부한다. 실제 PG·은행 지급·OS 프로세스 강제 종료·다중 서버 환경을 완료했다고 주장하지 않는다.

- 최종 검증 기록·요구사항 대응표·AGENTS 환경 변수 목록도 별도 문서 재검수에서 통과했다. 제출 JSON·로그와 수치가 일치함을 읽기 전용으로 대조했으며, 검수자가 테스트·DB를 실행한 것은 아니다.
- 이번에 시작한 3017 포트 서버는 PID와 실행 명령을 확인하여 종료했고, lsof 재확인에서 해당 포트의 리스너가 없음을 확인했다. 수동 시나리오 DB 기록은 보존했다.
- after_implement에 등록된 speckit-tdd-verify는 optional:true인 선택 후크다. 이번에 자동 실행하지 않았으며 별도 TDD 감사 통과를 주장하지 않는다. 강제 before_implement 후크는 없다.
- Phase 5의 T040~T047 완료. 요청 범위의 구현·검증·문서 검수를 마쳤으며 커밋·푸시·PR은 수행하지 않았다.

- 마지막 작업 트리 확인에서 refund-result.service.ts에 별도로 추가된 NOTE 주석 4줄을 확인했다. 이번 PG 작업에서 작성한 변경이 아니므로 수정하거나 제거하지 않고 작업 범위에서 제외했다. 실행 로직 변경은 없었다.

## 후속 검토: 결과 반영 변수명과 취소 거래 ID 사전 조회 제거

사용자 요청에 따라 applyPgResult의 잠금 후 DB 기록 변수 attempt를 storedPaymentCancel로 변경했다. 후속 요청으로 isCancelTransactionUsedByOther 호출·저장소 메서드와 해당 사전 조회 모킹을 제거했다. 중복 거래 ID는 DB unique가 막고 기존 P2002 변환이 PG_CALLBACK_TARGET_MISMATCH를 유지한다. expectedOrderItemId의 undefined/null 처리는 변경하지 않았다. 제거된 검사 안의 NOTE만 함께 정리했고 나머지 사용자 NOTE는 보존했다.

- refund-result.integration.spec.ts 전체 106개 통과, 실패 0, 종료 코드 0. 사전 조회 모킹 없이 실제 unique 위반을 발생시켜 대상 불일치 오류와 지급액 0·actualAmount 미확정·원장 0건을 확인했다.
- TypeScript 타입 검사와 git diff --check 통과.
- 변경 서비스·통합 테스트의 린트 오류는 없다. refund.repository.ts에서는 기존 불필요한 non-null assertion 2건이 보고된다. 기준 HEAD 내용을 eslint --stdin으로 대조해 같은 규칙의 오류가 이미 존재했음을 확인했으며, 이번 요청과 관계없는 두 코드는 변경하지 않았다. 앞선 Phase 5 린트는 당시 변경 대상 파일 기준이고 당시에는 이 저장소 파일을 수정하지 않았다.
- 이번 후속 변경에서는 전체 단위·E2E·빌드를 다시 실행하지 않았다. 커밋·푸시·PR은 하지 않았다.

## 후속 명명 정리: 저장소의 취소 요청 기록

refund.repository.ts의 취소 요청 조회 변수는 storedPaymentCancel, 생성 변수는 createdPaymentCancel, 배열 요소는 paymentCancel로 변경했다. Attempt를 포함하던 저장소 메서드 8개도 PaymentCancel을 드러내는 이름으로 바꾸고 서비스·테스트 호출처를 함께 전환했다. 재시도 판정 상태 PayoutRetryState.attempts는 paymentCancels로 변경했다.

- 저장소 파일의 단독 attempt·attempts 식별자와 Attempt 메서드명은 남아 있지 않다. 이전 8개 메서드 이름도 src/refund·test에서 검색 결과 0건이다.
- attemptNumber·nextAttemptNumber·sendAttemptCount·lastSendAttemptAt과 공개 환불 응답의 attempts는 유지했다. Prisma·DB·공개 API 필드·업무 조건은 변경하지 않았다.
- 타입 검사 통과. 관련 단위 3개 파일 16개, 결과 반영 통합 1개 파일 106개, 복구·동시성 E2E 2개 파일 42개 모두 통과했다. 각 실행 종료 코드 0이다.
- 이번에 함께 수정한 서비스·정책·테스트 10개 파일의 린트와 git diff --check 통과. 저장소 파일의 기존 non-null assertion 린트 2건은 앞선 후속 검토 기록대로 유지했다.
- 전체 테스트·전체 E2E·빌드는 다시 실행하지 않았으며 커밋·푸시·PR도 수행하지 않았다.

## 후속 명명 정리: 서비스의 취소 요청 변수

결과·전송·복구 서비스의 PaymentCancel 기록 변수·매개변수 attempt를 storedPaymentCancel로 변경했다. 환불·주문 ID만 반환받는 변수는 refundAndOrderIds로, 조회 담당 획득 결과(기록 또는 RECENT/null)를 받는 변수는 inquiryClaimResult로 구분했다. 관련 JSDoc 매개변수명도 맞췄다. 사용자 NOTE 원문은 보존했으며 해당 주석 외에는 세 파일에 단독 attempt 식별자가 남아 있지 않다.

타입 검사·세 파일 린트·git diff --check와 결과 서비스 단위 테스트 1개가 통과했다. 처리 로직·조건·DB·공개 API는 바꾸지 않았고 DB 통합·E2E는 재실행하지 않았다. 테스트의 pgGateway 이름은 질문에 대한 설명만 했으며 이번 변경에는 포함하지 않았다.

## 후속 명명 정리: 테스트 PG 서비스 대역

PgService로 주입 대상이 변경된 뒤에도 남아 있던 pgGateway를 테스트 4개 파일에서 pgServiceMock으로 변경했다. 타입 검사·변경 파일 린트·git diff --check와 환불 접수 서비스 단위 테스트 15개가 통과했다. src/refund·test의 pgGateway 참조는 0건이다. 테스트 조건·처리 로직·DB는 변경하지 않았고 DB 통합·E2E는 재실행하지 않았다.


## 2026-11-18 후속 변경: PG 재확인·재시도를 pg-check로 통합

이 절은 Phase 5 이후에 승인·구현한 후속 변경과 검증 결과다. 앞 절의 650개·212개 결과는 당시 실행 기록으로 보존한다. 아래 결과는 2026-11-18 14:57~14:58에 직접 실행한 것이며, 17시의 주석·문서 정리에서 테스트를 다시 실행한 결과가 아니다.

### 현재 서버 동작

- 점주·운영자는 같은 `POST /refund/:refundId/pg-check`를 사용한다. 재전송·재시도 전에 기존 `PaymentCancel.id`로 PG 상태를 조회한다. 최초 취소 요청에는 사전 조회를 추가하지 않았다.
- `PaymentCancel.status=REQUESTED` 또는 `QUERY_FAILED`에서 확실한 `NOT_FOUND`가 확인되면 기존 ID·금액으로 재전송한다. 최종 `FAILED`가 확인되면 `FAILED/PG_REJECTED`로 기록하고 같은 실행에서는 새 요청을 생성하지 않는다.
- `PaymentCancel.status=FAILED`이고 `PaymentCancel.failureCode`가 `SEND_FAILED`·`RETRY_EXHAUSTED`인 요청을 개별 조회해 성공이 확인되면 기존 요청에 실제 취소액·거래 ID·지급액·원장을 반영한다. `IN_PROGRESS`이면 기존 `PaymentCancel.status=REQUESTED`, `Refund.payoutStatus=PENDING`으로 복귀하고 다음 조회를 예약한다. 이전 내부 실패 경위는 거래 로그로 남기고 실패 필드를 해제하며, 새 요청이나 추가 전송은 만들지 않는다.
- `FAILED/PG_REJECTED`의 성공·처리 중 조회는 기존 거절과의 결과 불일치로 기록한다. `Refund.actionCode=PG_RESULT_CONFLICT`, `Refund.reviewRequired=true`와 운영자 알림을 남기고 추가 지급을 차단한다.
- `FAILED/SEND_FAILED`·`FAILED/RETRY_EXHAUSTED`·`FAILED/PG_REJECTED`에서 확실한 `NOT_FOUND` 또는 최종 `FAILED`가 확인되면 이전 실패 상태·사유·횟수를 보존하고 같은 `Refund` 아래 새 `PaymentCancel`을 생성해 전송한다. 생성 시 `Refund.payoutStatus=PENDING`으로 변경한다. 조회 오류이면 전송하지 않고 기존 실패 상태를 유지한다.
- `PaymentCancel.manualResendCount`는 개별 확인 후 같은 ID로 재전송을 시작할 때만 증가한다. 새 요청의 최초 전송에는 증가시키지 않는다. 자동 재전송 한도는 유지한다.
- 전송 준비·결과 저장 시 작업 토큰·현재 상태·지급액·다른 지급 작업·별도 지급 예약을 재검사한다. 외부 PG 호출은 DB 트랜잭션 밖에서 수행한다.
- 일반 재시도용 `payout-retries` 라우트, `RefundRetryService.retryByManager()`, 전용 명령·응답 타입, `RetryRefundDto`와 전용 테스트, `retrySchema`를 제거했다. 호출 테스트는 `pg-check` 경로로 옮겼고, 폐지 경로의 HTTP 404 및 Swagger 문서 제외를 검증한다. 과거 DB 멱등성 기록·컬럼은 삭제하지 않았다.

### 직접 실행한 검증 결과

| 검증 | 결과 | 실행 기록 |
| --- | --- | --- |
| 전체 단위·통합 `npm run test` | 56개 파일·666개 통과, 실패 0 | `/private/tmp/refund-remove-retry-unit-all.log` |
| 전체 E2E `npm run test:e2e` | 18개 파일·213개 통과, 실패 0 | `/private/tmp/refund-remove-retry-e2e-all.log` |
| `npx tsc --noEmit` | 통과 | `/private/tmp/refund-remove-retry-types.log` |
| 최근 변경 TypeScript 파일의 Prettier 검사·`git diff --check` | 통과 | 이 대화의 실행 결과 |
| 수정 파일 대상 ESLint | 기존 오류 1건·경고 2건 잔존 | `/private/tmp/refund-remove-retry-lint.log` |

- ESLint 오류는 `refund-result.integration.spec.ts`의 기존 SEND_FAILED 성공 테스트에 있는 `paidAt: expect.any(Date)`의 `no-unsafe-assignment`다. 경고는 `refund.swagger.ts`의 `ApiRefundResponse`·`ApiRefundErrors` 명명 규칙이다. 린트 전체 통과로 기록하지 않는다.
- 테스트 선행 실패·수정·재실행 경위는 `tdd/cycle-log.md`의 2026-11-18 기록을 따른다. 전체 검증 중 기존 Swagger 테스트의 17개 엔드포인트 기대가 실제 16개와 달라 실패했고, 폐지 계약에 맞춰 개수 및 경로 부재 검증을 수정한 뒤 위 전체 테스트가 통과했다.
- 위 로그는 임시 파일이다. 이 절은 해당 실행 결과를 문서에 보존하며, 사용자 제공 결과와 혼합하지 않는다.

### 남은 작업·범위 밖

- 최근 재확인·재시도 변경 후 빌드는 아직 실행하지 않았다. 앞 절의 빌드 통과를 이번 후속 변경의 검증으로 대신하지 않는다.
- 별도 지급 예약을 확실한 미지급 근거로 실패 종료해도 `Refund.payoutMethod=MANUAL`은 유지한다. `pg-check`는 이 환불을 처리하지 않는다. `MANUAL → PG` 전환 API·권한·처리 조건은 미결이며 `docs/TODO.md`에 기록했다.
- 실제 운영 PG 통신·은행 지급·배포 환경 검증과 클라이언트 개발은 이번 후속 변경 범위에 포함하지 않는다. 모의 PG 결과·지급액·원장은 외부 금전 지급 증거가 아니다.
- 커밋·푸시·PR은 수행하지 않았다.

### 17시 주석·문서 정합성 정리

폐지 API를 안내하던 서비스 주석과 배포 체크리스트·비즈니스 정책·002 quickstart·데이터 모델 설명을 현행 pg-check 계약에 맞췄다. deferred-changes는 과거 제안 본문을 보존하고 현행 기준과의 관계를 표시했다. docs/TODO.md에는 주석 정리 완료와 전환 기능 미구현을 구분했다.

technical-writing-review 스킬을 적용한 별도 읽기 전용 검수에서 의미 전달·의미 보존을 확인했다. 인접 quickstart 문장의 내부 실패 정정과 PG 거절 충돌 구분 누락 1건을 수정하고 같은 검수자의 재검수를 통과했다. 이 판정은 수정한 문서·주석 범위에 한정하며 런타임 검증을 대신하지 않는다.

수정 전 자료와 대조해 서비스의 주석 외 코드 및 앞 절의 검증 기록이 보존됐음을 확인했고 git diff --check를 통과했다. 이번 정리에서 테스트·빌드·DB 작업·커밋은 실행하지 않았다.


## 2026-11-18 후속 마무리: 린트 정리와 빌드 검증

- 승인 범위: 앞 절에서 남긴 ESLint 오류 1건·경고 2건 정리와 최근 변경의 빌드 검증이다. 업무 동작·HTTP 경로·응답 필드는 변경하지 않았다.
- SEND_FAILED 성공 통합 테스트의 `paidAt: expect.any(Date)`를 객체 단언에서 분리해 `expect(refund.paidAt).toBeInstanceOf(Date)`로 검증한다. 날짜 타입 검증을 유지하면서 any 대입 오류를 제거했다.
- `ApiRefundResponse`·`ApiRefundErrors`를 현재 함수 명명 규칙에 맞춰 `apiRefundResponse`·`apiRefundErrors`로 변경하고 컨트롤러 4개의 import·사용처를 함께 변경했다. ESLint 규칙을 비활성화하지 않았다. 이름 변경 도중 누락된 이전 이름 참조를 타입 검사에서 발견해 보완한 뒤 최종 검증했다.

### 이번 단계에서 직접 실행한 결과

| 검증 | 결과 | 실행 기록 |
| --- | --- | --- |
| 변경·신규 TypeScript 파일 ESLint, 자동 수정 없음 | 62개 파일, 오류·경고 0, 종료 0 | `/private/tmp/refund-lint-build-eslint.log`, 대상 목록 `/private/tmp/refund-lint-build-files.json` |
| `npx tsc --noEmit` | 통과, 종료 0 | `/private/tmp/refund-lint-build-types.log` |
| `npm run build` | 통과, 종료 0 | `/private/tmp/refund-lint-build-build.log` |
| `node node_modules/vitest/vitest.mjs run src/refund/refund.swagger.spec.ts` | 3개 통과, 종료 0 | `/private/tmp/refund-lint-build-swagger.log` |
| `node node_modules/vitest/vitest.mjs run src/refund/refund-result.integration.spec.ts -t 'RC-03 SEND_FAILED'` | 1개 통과·109개 미선택, 종료 0 | `/private/tmp/refund-lint-build-rc03.log` |
| 이번 단계 수정 파일의 `git diff --check` | 통과 | 이 대화의 실행 결과 |

- 린트 대상은 현재 src/test의 추적 변경과 src/pg·src/refund·test의 신규 TypeScript 파일이다. 별도 학습 코드인 src/idempotency-challenge는 포함하지 않았다. 전체 저장소 린트 통과로 확대 해석하지 않는다.
- 전체 작업 트리의 diff 검사에서는 이번 단계 밖 README.md의 줄 끝 공백과 파일 끝 빈 줄 오류가 확인됐다. 기존 변경을 보존했고 이번 단계 수정 파일은 별도로 검사했다.
- 앞 절에서 미실행으로 남긴 빌드는 이번 단계에서 통과했다. 전체 단위·통합 666개 및 E2E 213개는 앞 단계 실행 기록이며 이번 단계에서 전체 테스트를 재실행하지 않았다.
- 테스트 검증 방식과 함수명 정리는 동작 변경이 아니므로 새로운 실패 동작의 TDD 증거로 주장하지 않는다. 실제 외부 PG·은행 지급·배포 환경은 검증하지 않았고 커밋·푸시·PR은 수행하지 않았다.
