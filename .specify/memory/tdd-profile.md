---
detected_at: 8fde6fc
ecosystems: [typescript]
default: typescript
stacks:
  typescript:
    cwd: .
    runner: vitest
    single: "bash -c 'report=$(mktemp)\ntrap '\\''rm -f \"$report\"'\\'' EXIT\nnode node_modules/vitest/vitest.mjs run \"$0\" -t \"$1\" --reporter=json --outputFile=\"$report\"\nstatus=$?\nnode -e '\\''const fs=require(\"fs\");try { const r=JSON.parse(fs.readFileSync(process.argv[1],\"utf8\")); if ((r.numPassedTests+r.numFailedTests)>0) process.exit(0); } catch {} console.error(\"선택된 테스트 0개 또는 결과 확인 실패\"); process.exit(2);'\\'' \"$report\"\nmatched=$?\nif [ \"$matched\" -ne 0 ]; then exit 2; fi\nexit \"$status\"' \"{file}\" \"{name}\""
    file: "./node_modules/.bin/vitest run {file}"
    suite: "npm run test && npm run test:e2e"
    watch: "./node_modules/.bin/vitest watch {file}"
    coverage: "./node_modules/.bin/vitest run {file} --coverage --coverage.reportsDirectory=/private/tmp/pg-client-coverage"
    mutation: null
    acceptance: "bash -c 'report=$(mktemp)\ntrap '\\''rm -f \"$report\"'\\'' EXIT\nnode node_modules/vitest/vitest.mjs run --config vitest.config.e2e.mts \"$0\" -t \"$1\" --reporter=json --outputFile=\"$report\"\nstatus=$?\nnode -e '\\''const fs=require(\"fs\");try { const r=JSON.parse(fs.readFileSync(process.argv[1],\"utf8\")); if ((r.numPassedTests+r.numFailedTests)>0) process.exit(0); } catch {} console.error(\"선택된 테스트 0개 또는 결과 확인 실패\"); process.exit(2);'\\'' \"$report\"\nmatched=$?\nif [ \"$matched\" -ne 0 ]; then exit 2; fi\nexit \"$status\"' \"{file}\" \"{name}\""
    property: null
    approval: null
    contract: null
    test_glob: "src/**/*.spec.ts, test/**/*.e2e-spec.ts"
    exemplar:
      unit: src/pg/pg.service.spec.ts
      dto: src/refund/dto/refund.dto.spec.ts
      integration: src/refund/refund-idempotency.repository.integration.spec.ts
      acceptance: test/refund-customer.e2e-spec.ts
    helpers:
      - test/setup-env.ts
      - test/helpers/refund-test-context.ts
      - test/helpers/refund-pg.stub.ts
      - test/helpers/pg-callback.ts
      - test/helpers/listen-on-loopback.ts
verified: [single, file, suite, coverage, watch, acceptance]
suite_baseline: green
suite_seconds: 58.58
---

# TDD 테스트 스택 프로필

## 검증 범위와 결과

2026-11-15, HEAD 8fde6fc 기준으로 Jest 프로필을 Vitest 5.1.0 구성으로 갱신했다. 테스트·설정·운영 소스는 수정하지 않았다. 현재 package.json, vitest.config.mts, vitest.config.e2e.mts가 기준이며 CI workflow는 없다.

| 명령·기능 | 직접 확인한 결과 |
| --- | --- |
| npm run test | 최종 권한 확장 실행: 54파일·604개 통과, 실패·미실행 0개 |
| npm run test:e2e | 16파일·200개 통과, 실패·미실행 0개 |
| file | src/pg/pg.service.spec.ts의 23개 통과 |
| single | 기존 authoritative=true 미접수 테스트 1개 선택·통과. 존재하지 않는 이름은 wrapper가 종료 2 |
| acceptance | 기존 고객 환불 첫 시나리오 1개 선택·통과. 존재하지 않는 이름은 종료 2 |
| coverage | PG 파일 23개 통과와 HTML·JSON 보고서 생성. 전체 프로젝트 커버리지 측정 아님 |
| watch | PG 파일 23개 통과 후 변경 대기, q로 종료 0 |

전체 명령은 JSON reporter와 outputFile 옵션을 붙여 각각 실행했다. suite 항목은 검증한 두 npm script를 순서대로 조합한다. 최종 관측 시간은 JSON startTime~최종 파일 endTime 기준 단위·통합 11.07초, E2E 47.51초다. 합계 58.58초는 shell 준비 시간까지 포함한 정밀 벤치마크가 아니다.

단일 선택 검증 중 Vitest의 -t는 0개 일치에도 원래 종료 0을 반환했다. 따라서 JSON 결과의 numPassedTests+numFailedTests가 양수인지 확인하는 wrapper를 쓴다. 읽을 수 있는 결과가 없거나 실행 0개이면 종료 2다. 실제 테스트 실패는 runner 종료 코드를 보존한다. 명령의 {name}은 정규식이므로 이름에 괄호 등 특수문자가 있으면 escape하거나 고유한 부분 문자열을 사용하고 실행 건수를 확인한다.

최초 전체 실행은 제한 환경에서 DB 연결·준비 실패로 7파일 실패·47파일 통과, 테스트 420통과·1실패·183미실행이었다. 권한 확장 환경의 SELECT 1 통과 후 최종 전체 실행에서 모두 통과했다. 최초 실패를 제품 회귀로 단정하거나 무시해서는 안 된다. 해당 실행 환경에서 DB·loopback 접근 권한이 필요하다.

## 작성 관례와 참조 파일

- Vitest globals의 describe·it·expect를 사용하고 대역·가짜 시간은 vi를 사용한다. 기존 프로필의 jest.fn·Jest CLI를 복사하지 않는다.
- 소스 옆 단위·통합 테스트는 src/**/*.spec.ts, API E2E는 test/**/*.e2e-spec.ts다. DB 통합 테스트도 기본 npm run test에 포함된다.
- 단위 예시 src/pg/pg.service.spec.ts는 직접 생성한 서비스·가짜 클라이언트·설정 대역·가짜 timer로 결과를 검증한다. 현재 기존 PG 계약을 사용하므로 향후 003 코드 전환 때 내용은 달라질 수 있다.
- DTO 예시 src/refund/dto/refund.dto.spec.ts는 plainToInstance·validate로 whitelist·허용 필드를 검증한다.
- 통합 예시 src/refund/refund-idempotency.repository.integration.spec.ts는 실제 PostgreSQL에 전용 사용자를 만들고 자기 데이터 범위로 정리한다.
- E2E 예시 test/refund-customer.e2e-spec.ts는 실제 AppModule과 공통 helper·PG 대역을 사용하며 HTTP 응답과 저장 결과를 함께 검증한다.
- test/setup-env.ts는 환불 자동 복구 worker를 비활성화한다. 현재 주석의 Jest 표현과 무관하게 Vitest setupFiles에서 실행된다.
- test/helpers/refund-test-context.ts는 앱·인증 사용자·매장과 상품/주문/결제/서명 콜백 기반 이용권을 준비하고 자기 사용자·매장 범위의 데이터를 FK 역순으로 정리한다.
- test/helpers/refund-pg.stub.ts는 현재 취소 요청·조회 결과 계획·지연·중단·호출 기록 대역이다.
- test/helpers/pg-callback.ts는 직렬화한 동일 원문 바이트로 서명과 HTTP 전송을 수행한다.
- test/helpers/listen-on-loopback.ts는 앱을 127.0.0.1의 임의 포트로 시작한다.
- 테스트 이름은 한글로 쓴다. 기존 002와 새 003의 QS 번호를 혼동하지 말고 해당 기능의 quickstart·태스크 대응표를 기준으로 연결한다.
- 요청 거부 HTTP 테스트는 상태 코드·error.code를 확인한다. 표시 문구는 기대값으로 고정하지 않는다. DTO 형식 실패는 기존 규칙을 따른다.
- 서버 시작 거부는 헌법 v1.6.0에 따라 실제 시작 시도·사유·시작 실패를 확인한다. HTTP API가 뜨지 않는 사례를 HTTP 거부 응답으로 검사하지 않는다.

## 실행 제약

- 사용자 승인 후 전체 테스트를 실행했다. DB 통합·E2E는 DATABASE_URL 대상과 Redis에 테스트 데이터를 생성·정리한다. 다른 IDE·에이전트와 공유 DB 테스트를 동시에 실행하지 않는다.
- 환경변수는 기존 .env/ConfigModule 설정과 테스트별 준비를 사용한다. 필요한 이름은 DATABASE_URL, REDIS_HOST, REDIS_PORT, JWT_SECRET, JWT_REFRESH_SECRET, PG_CALLBACK_SECRET 및 기존 환불 설정이다. 비밀값은 이 파일에 기록하지 않는다.
- 마이그레이션·DB 초기화·시드·앱 구현은 이번 설정 검증에서 수행하지 않았다.
- 전체 검증이 약 1분이므로 기존 헌법의 전체 회귀 요구를 임의로 축소하지 않는다. file/single/acceptance는 동작 실패 확인용이며 전체 통과의 대체가 아니다.
- 반복 콜백 0건 선택 검사도 runner hooks에 따라 DB 준비를 수반할 수 있다. acceptance 명령은 DB 접근 실행으로 취급한다.
- 이번 테스트에서 pg client.query 동시 실행 사용에 대한 deprecation 경고가 있었다. pg@9 대응이나 테스트 수정은 이번 범위에서 하지 않았다.
- coverage 출력은 /private/tmp/pg-client-coverage에 생성한다. 저장소 밖 임시 결과는 장기 증거 보관 위치가 아니므로 필요한 실행 요약은 기능 verification.md에 기록한다.

## 미검증·부재 기능

- mutation: 전용 도구가 없어 null. 자동 설치하지 않는다. StrykerJS 등 도입은 별도 결정이며 현재 헌법은 주요 동작의 의도적 변형 검증을 허용한다.
- property: lock에는 fast-check가 간접 의존으로 있으나 직접 의존·사용은 검증하지 않아 null. 표본 경계 테스트와 속성 증명을 혼동하지 않는다.
- approval·contract: 별도 도구·사용 사례를 확인하지 않아 null. 스냅샷·계약 테스트를 실행했다고 주장하지 않는다.
- useful assertion failure를 만들기 위해 테스트·코드를 일부러 수정하지 않았다. 이번 실패 출력 확인은 최초 실제 DB 연결 실패와 0건 선택 wrapper 오류다.
- 외부 PG·은행·실제 운영 환경·다중 서버는 검증하지 않았다.

## 헌법과 현재 작업 방식

헌법 v1.6.0의 테스트 선행·실패 이유 기록·전체 회귀·변형 검증 요구는 유지한다. 이번 작업에서 헌법을 수정하지 않았다. 003은 별도 speckit-tdd-plan을 생략하고 자동 tdd-run 훅을 제거했으므로, tasks.md를 기준으로 실행하고 필요한 실패 기록은 cycle-log.md에 남긴다.
