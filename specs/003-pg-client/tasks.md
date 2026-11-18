# Task 목록: 환불 PG 호출 구조 정리와 구현 분리

**작성일**: 2026-11-15
**입력**: `specs/003-pg-client/`의 spec.md·plan.md·research.md·data-model.md·contracts/pg-client.md·quickstart.md
**상태**: Phase 1~5 구현·검증·문서 검수 완료. 커밋·푸시·PR은 수행하지 않았다. 결과와 미확인 범위는 verification.md를 따른다.

## 범위와 실행 규칙

- 취소 요청·결과 조회, 운영용 골격, 개발용 모의 구현, 환경 선택·시작 검증만 구현한다.
- 결제 승인 연동·모의 승인·자동 콜백·승인 저장 메서드 변경은 `payment-handoff.md`의 별도 작업이다. 승인 콜백에서 시작하는 시스템 환불은 회귀 검증한다.
- 이번 작업은 `speckit-tdd-plan`을 실행하지 않으며 별도 `tdd/test-list.md`나 동작 ID를 선행 조건으로 요구하지 않는다. 이 문서의 태스크와 QS 대응표를 기준으로 진행한다.
- 테스트는 필수다. 한 태스크에 여러 사례가 있으면 실행 담당자가 다음에 검증할 동작 하나를 정하고 테스트 하나 → 의도한 실패 확인 → 최소 구현 → 전체 회귀 → 필요 시 리팩터링 순서로 반복한다. 테스트들을 한꺼번에 작성해 일괄 실패를 확인하지 않는다.
- 새 동작마다 실행 명령·의도한 실패 출력·구현 후 결과를 `specs/003-pg-client/tdd/cycle-log.md`에 덧붙인다. 별도 테스트 계획을 생략해도 헌법의 실패 증거 기록과 기존 검증 보존 요구는 유지한다.
- 구조 변경은 기존 동작을 보존한 green 상태에서 진행한다. 새 동작은 먼저 실패를 확인한다. 타입·메서드 누락만으로 실패 확인을 끝내지 않는다.
- `[P]`는 서로 다른 파일에서 의존 없이 수행할 수 있다는 뜻이다. 사용자 단계 승인·TDD 단위 제한을 대신하지 않으며 병렬 에이전트 실행 승인이 아니다.
- 커밋·푸시·PR은 별도 요청 전 수행하지 않는다. 스킬이 자동 커밋을 제안해도 이 지시가 우선한다.
- DB·서버·테스트 실행은 사용자가 승인한 범위에서 수행한다. 기존 `.serena/`·`src/idempotency-challenge/`와 관계없는 변경을 보존한다.
- 사용자 승인은 Phase 단위로 받는다. 승인된 Phase 내부에서는 태스크마다 재승인을 요청하지 않으며, 동작별 테스트·실패 확인은 유지한다.

## QS 대응 (T003에서 quickstart에 반영 완료)

| QS | spec 인수 시나리오 | 확인 |
| --- | --- | --- |
| QS-1~QS-5 | US1의 1~5항 순서 | 전송 전 실패·복구·중복·승인액 불일치 시스템 환불·좌석 실패 시스템 환불 |
| QS-6~QS-9 | US2의 1~4항 순서 | 즉시 성공·저장 결과 조회·재시작 유실·기록 부재 |
| QS-10~QS-14 | US3의 1~5항 순서 | 허용 시작·운영 모의 거부·모드 오류·운영 골격 거부·필수 설정 누락 |

HTTP E2E 이름에는 해당 `(QS-n)`을 붙인다. 시작 거부 테스트도 QS로 추적하되 HTTP 응답을 요구하지 않는다. 기존 E2E가 있으면 기대값을 보존하고 대응표로 연결한다. 한 QS에 필요한 여러 분기는 해당 태스크 실행 시 각각 독립 테스트로 나누고 하나씩 진행한다.

## Phase 1: 준비와 공통 계약

**범위**: 현재 호출처·검증 환경·시나리오 대응과 PgClient 공통 타입을 준비한다. 기존 앱 연결은 유지한다.

**완료 조건**: T001~T004 완료. 현재 완료 상태다.

- [x] T001 `specs/003-pg-client/plan.md`와 `contracts/pg-client.md`를 기준으로 취소·조회만 구현할 파일과 기존 승인 코드를 보존할 파일을 대조하고, `src/refund/refund-acceptance-execution.service.ts`를 포함한 PG 토큰·메서드·대역 호출처 목록을 `specs/003-pg-client/verification.md`에 기록한다.
- [x] T002 현재 `package.json`·`vitest.config.mts`·`vitest.config.e2e.mts`와 오래된 Jest 기준 `.specify/memory/tdd-profile.md`를 대조한다. 별도 승인된 `speckit-tdd-setup`으로 단일 테스트·0건 선택 실패·전체 실행 명령을 확인하고 프로필을 갱신하기 전에는 TDD 루프를 시작하지 않는다.
- [x] T003 `specs/003-pg-client/quickstart.md`에 아래 QS-1~QS-14 대응표를 추가하고 `specs/003-pg-client/verification.md`에 시나리오별 검증 파일·기존 사례 재사용 여부를 기록한다. 새 공개 API와 승인 구현은 추가하지 않는다.
- [x] T004 `src/pg/pg.client.ts`에 `PgClient`, `PG_CLIENT`, 취소 요청·조회 입력과 `validateConfiguration()`의 ready/code/fields 결과 타입을 정의한다. `src/pg/pg.types.ts`의 기존 취소 결과 union은 보존하고 승인 메서드·빈 운영 통신을 추가하지 않는다.

## Phase 2: 모의 클라이언트와 운영용 골격

**범위**: 기존 앱과 분리하여 두 클라이언트를 테스트·구현한다. 모의 구현은 메모리만 사용하고 운영용 골격은 실제 연동 미구현을 명시한다.

**완료 조건**: T021~T027·T030~T031의 단위 검증과 타입 검사 통과. 현재 두 클라이언트의 단위 구현·검증을 완료했다.

- [x] T021 [US2] `src/pg/simulated-pg.client.spec.ts`에 최초 취소 요청이 요청액 전액·비어 있지 않은 모의 거래 ID의 성공을 반환하고 이후 조회에 같은 결과가 나오는 테스트를 작성한다.
- [x] T022 [US2] `src/pg/simulated-pg.client.ts`에 모의 취소 즉시 성공과 PaymentCancel.id별 결과 Map을 구현한다. 업무 DB·외부 네트워크·승인 Map·자동 콜백·타이머·Redis를 사용하지 않는다.
- [x] T023 [US2] `src/pg/simulated-pg.client.spec.ts`에 “같은 ID·금액 재요청은 같은 결과를 반환한다. 다른 금액의 재요청은 최초 기록을 유지하고 UNKNOWN으로 반환한다”와 조회의 최초액 보존을 각각 검증한다.
- [x] T024 [US2] `src/pg/simulated-pg.client.ts`에 같은 ID·같은 금액의 결과 재사용과 다른 금액의 UNKNOWN 반환을 구현한다. 추가 취소 ID를 생성하거나 최초 실제액을 덮어쓰지 않는다.
- [x] T025 [US2] `src/pg/simulated-pg.client.spec.ts`에 기록 없는 조회·새 인스턴스·다른 인스턴스의 QUERY_ERROR와 NOT_FOUND 미반환을 각각 검증한다.
- [x] T026 [US2] `src/pg/simulated-pg.client.ts`에 인스턴스 메모리 수명과 기록 없는 QUERY_ERROR를 구현한다. 프로세스 재시작 복구나 다중 서버 공유를 추가하지 않는다.
- [x] T027 [US2] `src/pg/simulated-pg.client.spec.ts`에 “요청 금액은 0 이상 안전 정수여야 한다”의 경계값을 검증하고 `src/pg/simulated-pg.client.ts`에 필요한 검증을 구현한다. 한 동작의 테스트·실패 확인 후 해당 동작만 구현한다.
- [x] T030 [P] [US3] `src/pg/production-pg.client.spec.ts`에 validateConfiguration의 ready:false·PG_IMPLEMENTATION_INCOMPLETE, 취소 요청·조회의 명시적 미구현 오류, 성공·접수·NOT_FOUND 미반환을 각각 검증한다.
- [x] T031 [US3] `src/pg/production-pg.client.ts`에 운영용 골격을 구현한다. 요청 매핑·인증·통신·중단·응답 변환·전송 전후 실패 판단의 작성 위치를 설명하되 URL·키·응답 코드를 지어내거나 승인 메서드를 추가하지 않는다.

## Phase 3: PG 호출 구조·환경 선택·서버 시작 검증

**범위**: PgService·환불 호출처·provider·설정·테스트 대역을 함께 전환한다. 설정·실제 시작·로그 검증은 대응 구현 전에 한 동작씩 실패를 확인한다.

**완료 조건**: 이 Phase의 모든 태스크, 기존 테스트 참조 전환, 타입 검사와 기존 회귀 통과. 실제 앱 시작·거부·로그 검증도 이 Phase에서 완료한다.

T017~T020의 기존 provider·메서드 참조 수정도 이 Phase에서 함께 수행한다. 해당 태스크의 체크는 Phase 4에서 업무 검증까지 마친 뒤 변경한다. T034~T035·T038의 새 시작 검증은 이 Phase에서 구현 전에 한 사례씩 실행하고 완료한다. 테스트 준비만 별도 Phase로 분리하지 않는다.

- [x] T005 `src/pg/pg.service.spec.ts`의 클라이언트 대역을 새 의미 기반 결과 계약에 맞게 준비한다. `src/pg/pg-cancel.client.ts`의 가상 HTTP 형식을 검증하던 사례별 보존 의미를 `specs/003-pg-client/verification.md`에 대응시킨다. 실제 대역 전환은 아래 구조 전환 작업에서 수행하며 기존 테스트를 삭제·완화하지 않는다.
- [x] T006 [US1] `src/pg/pg.service.spec.ts`에 `requestPaymentCancel`의 NOT_SENT·ACCEPTED·UNKNOWN·SUCCEEDED·REJECTED 전달을 각각 독립 테스트로 전환하고, `SUCCEEDED` 즉시 결과의 거래 ID·실제액 보존을 검증한다. TDD에서는 한 사례씩 진행한다.
- [x] T007 [US1] `src/pg/pg.service.ts`에 `PG_CLIENT` 주입과 `requestPaymentCancel`을 구현한다. PgClient의 결과만 사용하고 가상 HTTP 응답 해석을 옮기지 않으며 기존 승인 임시 메서드는 유지한다.
- [x] T008 [US1] `src/pg/pg.service.spec.ts`에 취소 요청 타임아웃·일반 예외가 UNKNOWN이고 중단 신호가 전달되는 사례를 각각 작성한다. 일반 오류를 NOT_SENT로 추정하지 않는지 검증한다.
- [x] T009 [US1] `src/pg/pg.service.ts`의 취소 요청에 기존 `REFUND_PG_TIMEOUT_SECONDS` 제한·AbortSignal·타이머 정리를 적용하고 타임아웃·예외를 UNKNOWN으로 분류한다.
- [x] T010 [US1] `src/pg/pg.service.spec.ts`에 `inquirePaymentCancel`의 성공·확정 실패·처리 중·확정 미접수·조회 오류 전달과 타임아웃·일반 예외의 QUERY_ERROR를 각각 검증한다.
- [x] T011 [US1] `src/pg/pg.service.ts`에 `inquirePaymentCancel`과 조회 timeout·예외 처리를 구현하고 기존 NOT_FOUND의 authoritative 의미를 유지한다.
- [x] T012 [US1] `src/pg/pg.service.spec.ts`에 데이터 모델의 “성공 결과의 거래 ID는 비어 있지 않아야 하며 실제액은 0 이상 안전 정수여야 한다” 조건의 누락·빈 문자열·음수·소수·비유한값·안전 정수 초과 경계와 요청액과 다른 실제액의 보존을 검증한다.
- [x] T013 [US1] `src/pg/pg.service.ts`에 필수 성공 정보 검증을 구현한다. 잘못된 성공 정보는 취소 요청 UNKNOWN·조회 QUERY_ERROR로 처리하고, 유효하지만 요청액과 다른 실제액은 그대로 업무 서비스에 전달한다.
- [x] T014 [US1] `test/helpers/refund-pg.stub.ts`의 메서드를 requestPaymentCancel·inquirePaymentCancel로 전환한다. 기존 응답 계획·지연·중단·호출 기록 기능을 보존하고 전체 PgService를 상속하는 불필요한 대역을 만들지 않는다.
- [x] T015 [US1] `src/refund/refund-acceptance.service.spec.ts`·`refund-idempotency.service.spec.ts`, `src/refund/refund-acceptance.integration.spec.ts`·`refund-store.integration.spec.ts`·`refund-result.integration.spec.ts`의 대역을 PgService 경계에 맞춘다. 기존 확정 커밋 후 전송·최초 응답 복구·중복 호출 금지 기대값을 보존한다.
- [x] T016 [US1] `src/refund/refund-acceptance-execution.service.ts`·`refund-dispatch.service.ts`·`refund-recovery.service.ts`·`refund-retry.service.ts`를 PgService 직접 주입과 새 메서드명으로 전환한다. 락·담당 토큰·리스·카운터·트랜잭션·결과 반영 순서를 변경하지 않는다.
- [x] T032 [US3] `src/config/validation.schema.spec.ts`·`configuration.spec.ts`에 필수 PG_MODE, 미지원 값, production의 simulated 금지, development/test 허용과 기존 환불 timeout·리스 관계 보존을 각각 검증한다.
- [x] T033 [US3] `src/config/validation.schema.ts`·`configuration.ts`에 PG_MODE=simulated/production 필수 검증·환경 조합·구조화 설정을 추가한다. 기본값·자동 fallback·PG_APPROVAL_TIMEOUT_SECONDS를 추가하지 않는다.
- [x] T034 [US3] `test/pg-client-startup.e2e-spec.ts`에 앱 시작 성공·모드 누락·미지원 모드·운영 모의 선택·운영 골격 선택의 실제 시작 검증을 각각 작성한다. 코드·사유·시작 실패를 검증하고 환경·모듈 캐시를 격리한다 (QS-10~QS-13).
- [x] T035 [US3] `test/pg-client-startup.e2e-spec.ts`에 선택 구현의 ready:false·PG_CONFIGURATION_MISSING·fields 반환을 앱 provider factory에 연결하여 실제 시작 거부를 검증한다. 가상 운영 API 키를 필수로 추가하지 않고 목적에 맞는 클라이언트 대역을 사용한다 (QS-14).
- [x] T036 [US3] `src/pg/pg.module.ts`에서 PG_MODE로 구현을 선택하고 validateConfiguration의 미구현·필수 설정 누락을 사유 안내와 함께 거부한다. PgService·PG_CLIENT를 등록하고 PgService를 export하며 PaymentModule·RefundModule import와 전역 등록을 추가하지 않는다.
- [x] T037 [US3] `test/setup-env.ts`·`test/helpers/refund-test-context.ts` 및 T001에서 찾은 앱 생성 테스트에 simulated를 명시하고, `test/refund-bootstrap.e2e-spec.ts`를 새 기본 구현·PgService 대역 교체 검증으로 전환한다. 구형 Gateway=PgService 동일 인스턴스 기대를 새 계약에 맞추되 업무 기대값은 유지한다.
- [x] T038 [US3] `test/pg-client-startup.e2e-spec.ts`에 성공 로그의 모드·구현명과 실패 로그의 코드·사유·항목명을 검증한다. 기존 필수 설정 누락 실패도 전체 env·비밀값이 로그에 노출되지 않는지 확인한다.
- [x] T039 [US3] `src/pg/pg.module.ts`·필요한 `src/config/validation.schema.ts`의 시작 오류 안내를 보완하여 전체 env·원문 비밀값·개인정보를 출력하지 않는다. 준비 상태를 환경변수로 우회하거나 시작 실패를 정상 상태로 삼지 않는다.

## Phase 4: 환불 업무와 모의 클라이언트 앱 통합 검증

**범위**: Phase 3에서 연결한 앱으로 기존 환불·시스템 환불·동시성·복구와 실제 모의 취소·조회를 검증한다.

**완료 조건**: T017~T020·T028~T029의 업무 기대값과 E2E 통과. 테스트 참조만 바꾼 상태는 완료로 판단하지 않는다.

- [x] T017 [US1] `test/refund-customer.e2e-spec.ts`·`refund-store.e2e-spec.ts`·`refund-ledger.e2e-spec.ts`에서 전송 전 실패의 SEND_FAILED·ACTION_REQUIRED·REVOKED·지급액 0, 즉시 성공과 중복 결과의 원장 1회 반영을 새 서비스 대역으로 검증한다 (QS-1, QS-3).
- [x] T018 [US1] `test/refund-recovery.e2e-spec.ts`·`refund-crash-recovery.e2e-spec.ts`·`refund-concurrency.e2e-spec.ts`·`refund-operations.e2e-spec.ts`에서 UNKNOWN 조회·authoritative NOT_FOUND의 같은 ID/금액 재전송·한도·담당·별도 예약 상호 배제 검증을 새 서비스 대역으로 보존한다 (QS-2).
- [x] T019 [US1] `test/refund-payment-mismatch.e2e-spec.ts`·`test/seat-type.e2e-spec.ts`의 기존 승인액 불일치·좌석 배정 실패 시스템 환불을 새 취소 경로로 검증한다. 실제 해당 사례 위치를 T001 목록으로 확인하고 결제 코드 변경 없이 금액·미발급/종료·커밋 후 취소 기대값을 유지한다 (QS-4, QS-5).
- [x] T020 [US1] `test/refund-entry.e2e-spec.ts`·`refund-history.e2e-spec.ts`·`refund-notifications.e2e-spec.ts`·`refund-callback-auth.e2e-spec.ts`와 T001에서 찾은 나머지 대역 사용 테스트를 새 provider로 전환한다. 기존 서명·권한·중복·금액 검토 기대값을 유지한다.
- [x] T028 [US2] US3의 앱 연결 후 `test/pg-client.e2e-spec.ts`에서 실제 SimulatedPgClient와 환불 HTTP 요청으로 즉시 성공·PAID·실제액·원장 1건·외부 통신 비사용을 검증한다. 기존 준비 helper로 승인 완료 데이터를 만들며 승인 API를 구현하지 않는다 (QS-6).
- [x] T029 [US2] US3의 앱 연결 후 `test/pg-client.e2e-spec.ts`에서 환불 HTTP 요청으로 생성한 ID를 실제 클라이언트로 조회하여 같은 결과를 확인하고, 앱 재생성 후 기존 환불 HTTP 조회와 모의 조회 QUERY_ERROR를 확인한다. 기록 없는 ID도 같은 오류이며 재전송하지 않는지 검증한다 (QS-7, QS-8, QS-9).

## Phase 5: 구형 의존 제거와 최종 검증

**범위**: 사용하지 않는 기존 PG 인터페이스를 제거하고 관련 문서·수동 시나리오·전체 회귀·빌드·검수 결과를 정리한다.

**완료 조건**: T040~T047 완료. 실제 운영 PG 연동 완료로 표현하지 않는다.

- [x] T040 [US3] US1·US2 전환과 앱 연결이 완료되면 `src/pg/pg-cancel.client.ts`·`src/pg/refund-pg.gateway.ts`를 제거하고 `src/pg/pg.types.ts`의 PgRawResponse 관련 의존을 정리한다. 전체 src/test의 구형 토큰·타입·메서드 잔존을 검색하고 승인 requestVan·requestedPayment·미사용 승인 메서드는 유지한다.
- [x] T041 [P] `specs/002-refund-completion/research.md`·`plan.md`·`contracts/rest-api.md`의 PG 관련 설명에 003 경계·개발용 모의 허용·시작 검증을 반영한다. 상태·업무·API 계약과 과거 `tasks.md`·TDD 기록은 변경하지 않는다.
- [x] T042 [P] `AGENTS.md`와 `.env.example`에 새 PG 경계·필수 PG_MODE·미완성 운영 골격·모의 실제액의 의미를 반영한다. 기존 비밀값을 문서에 복사하지 않는다.
- [x] T043 `specs/003-pg-client/quickstart.md`에 따라 승인 완료 시드·Scalar 환불·실제액·원장을 확인하고 `verification.md`에 실행 결과와 미확인 범위를 남긴다. 시드·서버·DB 실행은 해당 승인 범위에서만 수행한다.
- [x] T044 `.specify/memory/tdd-profile.md`의 갱신된 명령으로 전체 단위·통합·E2E를 검증하고, `npx tsc --noEmit`, `npm run build`, 변경 파일 대상 비자동수정 ESLint 결과를 `specs/003-pg-client/verification.md`에 기록한다. 기존 실패와 신규 실패를 구분한다.
- [x] T045 `src/pg/pg.service.ts`·`simulated-pg.client.ts`·`pg.module.ts`의 핵심 분류·중복·시작 거부를 의도적으로 깨뜨린 경우 테스트가 실패하는지 확인하고 `specs/003-pg-client/verification.md`에 근거를 남긴다. 실행 전에 사용할 도구·명령과 깨뜨릴 동작을 `specs/003-pg-client/verification.md`에 기록하고 변형은 반드시 복원한다.
- [x] T046 `specs/003-pg-client/verification.md`에 SR·FR·SC 및 QS별 테스트/정적 검토 대응표를 완성한다. PgService→PgClient 방향·업무 DB 비접근·구형 의존 제거·승인 코드 보존·문서 갱신을 검토한다.
- [x] T047 `specs/003-pg-client/`의 활성 문서와 `payment-handoff.md`를 technical-writing-review 스킬로 별도 읽기 전용 검수하고 승인 범위의 지적만 수정한다. 결과와 미해결 항목을 `verification.md`에 남긴다.

## 의존 관계와 승인 순서

Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 순서로 진행하고 각 Phase 종료 후 다음 Phase 승인을 받는다. US1·US2·US3 표시는 요구사항 추적용이며 실행 순서가 아니다. 태스크 ID도 기존 추적을 위해 유지했으므로 번호순으로 실행하지 않는다.

- 두 클라이언트는 Phase 1의 공통 계약에 의존한다.
- 앱 provider의 구현 선택은 Phase 2의 두 클래스에 의존한다.
- PgService의 토큰·메서드 전환은 환불 호출처·provider·기존 테스트 참조와 함께 수행해야 한다.
- 실제 모의 환불 E2E는 Phase 3의 앱 연결·환경 선택에 의존한다.
- 구형 인터페이스 제거는 모든 호출처 전환과 앱 통합 검증 이후 수행한다.

이번 재구성 전 Phase는 스토리별 분류였다. 이전 verification.md·cycle-log.md에 기록된 Phase 번호는 당시 분류를 뜻하며 과거 실행 기록은 수정하지 않는다. 현재 승인·실행 순서는 이 문서의 새 Phase를 따른다.

### Phase 3 구조 전환 작업

함께 전환할 태스크는 **T005~T016, T020의 provider 참조 변경, T033, T036~T037, T039**다. T017~T019에 있는 기존 테스트의 메서드·provider 참조도 이때 함께 맞추고, 기존 회귀 통과는 Phase 3의 완료 조건이며, 시나리오별 추가·보완 검증은 Phase 4에서 완료한다.

- `src/pg/pg.service.ts`의 주입 토큰·메서드와 환불 서비스 네 곳의 주입·호출을 함께 변경한다.
- `src/pg/pg.module.ts`의 새 provider 등록, 필수 PG_MODE 검증, `test/setup-env.ts`의 명시적 모드 설정을 함께 반영한다.
- 기존 단위·통합·E2E의 대역·메서드·provider 참조를 같은 작업에서 전환한다. 일부 호출처만 새 메서드로 바꾼 상태를 완료로 보고하지 않는다.
- T038의 로그 검증도 T039의 해당 로그 처리 구현 전에 한 사례씩 실패를 확인한다.
- 기존 동작을 옮기는 수정과 새 동작 추가를 구분한다. 필수 결과 검증·시작 거부·로그 보호 등 새 동작은 다음 동작 하나의 테스트를 먼저 실패시키고 최소 구현한다. 여러 새 테스트를 일괄 작성·실패시키지 않는다.
- 구조 변경 중 생긴 타입·주입·기존 메서드 누락은 새 동작의 실패 증거가 아니다. 새 동작의 실패 확인은 이 문제들을 해결한 뒤 수행한다.
- 타입 검사와 기존 회귀 테스트가 통과해야 구조 전환 태스크를 완료 처리한다. 이를 위해 필요한 참조 수정은 위 태스크 묶음에서 함께 수행한다. 임시 운영 성공·미연동 fallback으로 앱을 시작시키지 않는다.

US1·US2의 추가·보완 앱 E2E는 Phase 4에서 검증한다. 기존 E2E 회귀는 Phase 3에서도 실행하여 구조 전환으로 업무 동작이 바뀌지 않았는지 확인한다.

## 병렬 진행 예시

- US1: 한 파일의 서비스 테스트·구현은 순차 수행한다. 서비스 계약이 안정된 뒤 서로 다른 환불 E2E 파일의 대역 참조 조사·회귀 대응표 정리는 분리 가능하다. 테스트 실행은 공유 DB 때문에 병렬로 수행하지 않는다.
- US2: 모의 구현·단위 테스트·같은 E2E 파일은 순차 수행한다. 독립된 병렬 구현 작업은 두지 않는다.
- US3: 운영 골격 단위 테스트 작성은 US1·US2의 런타임 구현과 파일이 겹치지 않아 병렬 가능하다. 단, 한 동작의 실패→구현 순서는 유지한다.
- 마무리: 002 설계 문서 갱신과 AGENTS.md·.env.example 안내는 파일이 달라 병렬 가능하다.

## 구현 전략과 완료 판정

- Phase 1~5의 태스크를 완료했다. 실제 운영 PG 연동과 결제 승인 구현은 별도 작업이며 커밋·푸시·PR도 별도 요청 사항이다.
- 실제 앱에서 사용할 수 있는 최소 범위는 환불 호출 구조·모의 구현·환경 선택·시작 거부 정책의 연결과 통합 검증까지다. 클라이언트 단위 구현만으로 배포 가능한 상태라고 판단하지 않는다.
- Phase 내부에서도 새 동작은 한 테스트씩 실패 확인 후 구현한다. 구조 변경은 기존 업무 기대값을 보존한다.
- 사용자 요청으로 `.specify/extensions.yml`에서 `before_implement`의 `speckit-tdd-run` 자동 실행 훅을 제거했다. 훅 제거는 헌법의 테스트 선행·실패 확인 규칙을 변경하지 않는다.
