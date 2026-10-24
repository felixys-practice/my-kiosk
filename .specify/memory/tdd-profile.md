---
detected_at: 76fe8dd
ecosystems: [typescript]
default: typescript
stacks:
  typescript:
    cwd: .
    runner: jest
    single: 'bash -c ''out=$(npx jest "$0" -t "$1" 2>&1); code=$?; printf "%s\n" "$out"; printf "%s\n" "$out" | grep -qE "^Tests:.* [1-9][0-9]* (passed|failed)" || { echo "선택된 테스트 0개"; exit 2; }; exit $code'' {file} "{name}"'
    file: npx jest {file}
    suite: npm run test && npm run test:e2e
    watch: null
    coverage: npm run test:cov
    mutation: null
    acceptance: 'bash -c ''out=$(npx jest --config ./test/jest-e2e.json "$0" -t "$1" 2>&1); code=$?; printf "%s\n" "$out"; printf "%s\n" "$out" | grep -qE "^Tests:.* [1-9][0-9]* (passed|failed)" || { echo "선택된 테스트 0개"; exit 2; }; exit $code'' {file} "{name}"'
    property: null
    approval: null
    contract: null
    test_glob: "src/**/*.spec.ts, test/*.e2e-spec.ts"
    exemplar:
      unit: src/seat-assignment/seat-assignment.service.spec.ts
      dto: src/seat/dto/create-seat.dto.spec.ts
      acceptance: test/seat-type.e2e-spec.ts
    helpers: []
verified: [single, file, suite, coverage, acceptance]
suite_baseline: green
suite_seconds: 25
---

# TDD 스택 프로필

## 실행 확인 결과 (2026-10-24, `76fe8dd`)

| 항목 | 명령 | 확인 내용 |
|---|---|---|
| 단일 테스트 (단위) | `single` | 통과 → 종료 코드 0, 일치하는 이름 없음 → 2(`선택된 테스트 0개`), 실패 → 1 |
| 단일 테스트 (E2E) | `acceptance` | 통과 → 0, 일치하는 이름 없음 → 2 |
| 파일 단위 | `npx jest {file}` | 단위 스위트 실행 중 확인 |
| 전체 | `npm run test` → `npm run test:e2e` | 단위 23 suites·160개 통과(약 7초), E2E 3 suites·51개 통과(약 18초) |
| 커버리지 | `npm run test:cov` | `coverage/`(git 무시 대상)에 lcov·clover 리포트 생성(약 17초), 전체 줄 커버리지 40.6% |

**단일 테스트 명령을 감싼 이유**: Jest는 `-t`의 이름이 아무 테스트와도 일치하지 않아도
`Tests: N skipped`로 **종료 코드 0**을 낸다. 그대로 쓰면 아무것도 실행하지 않은 채 green으로 보이므로,
출력에 `passed`나 `failed`가 1개 이상 없으면 종료 코드 2를 내도록 감쌌다. Jest의 원래 종료 코드(실패 시 1)는 그대로 넘긴다.
red 확인 때는 출력의 `Tests:` 줄에서 `1 failed`인지, 그리고 실패 메시지가 노리는 이유인지 함께 확인한다.

## 따라야 할 작성 관례

- **위치·이름**: 단위 테스트는 소스 옆 `<name>.spec.ts`(`src/**`), E2E는 `test/<기능>.e2e-spec.ts`.
  `describe`·`it` 이름은 한글로 쓴다(전역 규칙).
- **단위 테스트 (Service)**: 예시 `src/seat-assignment/seat-assignment.service.spec.ts`.
  Repository를 `jest.Mocked<...>`로 만들고 `jest.fn()`으로 메서드를 채운 뒤 Service를 `new`로 생성한다.
  시각은 고정 `Date` 상수(`now`, `past`, `future`)로 넘기고, 테스트 데이터는 파일 안의 작은 생성 함수(`openRow(overrides)`)로 만든다.
  목 메서드를 `expect`로 검증하는 파일은 맨 위에 `@typescript-eslint/unbound-method` 비활성 주석을 둔다(예시 파일 1행).
- **Nest 주입이 필요한 단위 테스트**: `Test.createTestingModule`에 의존 대상을 `{ provide: X, useValue: ... }`로 등록한다
  (예: `src/user/user.service.spec.ts`).
- **DTO 검증 테스트**: 예시 `src/seat/dto/create-seat.dto.spec.ts`. `plainToInstance` + `validate`로 오류 필드 이름 목록을 비교한다.
- **E2E (인수 테스트)**: 예시 `test/seat-type.e2e-spec.ts`.
  - `AppModule` 전체를 띄우고 `ValidationPipe`·`TransformInterceptor`·`HttpExceptionFilter`를 `main.ts`와 같게 등록한다.
  - 사용자·매장은 `PrismaService`로 직접 만들고, 이메일에 `Date.now()`를 붙여 겹치지 않게 한다. 토큰은 `JwtService`로 직접 서명한다.
  - `afterAll`에서 자기 사용자·매장 ID 기준으로 FK 역순 삭제 후 `prisma.$disconnect()`, `app.close()`를 호출한다.
  - 테스트 이름 끝에 quickstart 시나리오 번호 `(QS-n)`을 붙인다.
  - 거부 응답은 상태 코드와 함께 `body.error.code`를 검증한다(헌법 VI). DTO 형식 검증 실패는 상태 코드만 검증한다.
  - `supertest`는 `import request from 'supertest'`로 가져온다(`import * as`는 `request is not a function`).
- **공용 테스트 유틸**: 없다. 팩토리·setup 파일·사용자 정의 matcher가 없고, E2E 헬퍼(`createSeat`, `issueTicket` 등)는
  `test/seat-type.e2e-spec.ts` 안에만 있다. 새 E2E 파일은 이 헬퍼를 본떠 파일 안에 만든다.

## 없는 기능

| 기능 | 상태 | 결과 |
|---|---|---|
| 뮤테이션 테스트 | `null`. Stryker가 설치되어 있지 않다 | verify는 위험도가 높은 동작에 의도적 뮤턴트로 대신 점검한다. 생태계 기본 도구는 StrykerJS(`@stryker-mutator/core`, `@stryker-mutator/jest-runner`) |
| 속성 기반 테스트 | `null`. `fast-check`는 `effect`의 간접 의존성으로만 lock에 있고 직접 import할 수 없다 | 불변식은 경계값 예시 테스트 여러 개로 대신하고, 테스트 목록에 "표본 검증"으로 적는다 |
| 승인·스냅샷 | `null`. Jest 스냅샷 기능은 있으나 사용하는 테스트가 없고 실행 확인하지 않았다 | |
| 계약 테스트 | `null` | |
| watch | `null`. `npm run test:watch` 스크립트는 있으나 대화형이라 실행 확인하지 않았다 | |
| CI | `.github/workflows`가 없다. 병합을 막는 자동 검증이 없으므로 위 명령이 기준이다 | |

## 실행 제약

- **E2E와 단위 스위트 일부는 로컬 PostgreSQL·Redis가 필요하다**(`docker compose up -d`). 환경 변수는 루트의 `.env`에서 읽는다
  (`ConfigModule` 기본 경로). 필요한 변수 이름은 `.env.example` 참고: `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`,
  `JWT_SECRET`, `JWT_ACCESS_EXPIRES_MINUTES`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_DAYS`, `SEAT_HOLD_MINUTES`.
  단위 스위트의 `src/prisma/prisma.integration.spec.ts`도 DB에 `SELECT 1`을 실행한다.
- **E2E는 로컬 공유 DB·Redis에 데이터를 만들고 지운다. 다른 곳(IDE의 Jest Runner 등)에서 E2E를 동시에 실행하지 않는다.**
  2026-10-24에 다른 IDE와 동시에 실행했을 때 `seat-type.e2e` QS-16a가 준비 단계에서 404로 실패했고, 단독 실행 10회는 모두 통과했다.
- 전체 실행은 단위 약 7초 + E2E 약 18초라 매 사이클 전체 실행이 가능하다.
- `npx eslint .`는 이전부터 있던 121건(오류 106·경고 15)이 남아 있다(`docs/기존_버그.md` 8번). 린트는 바꾼 파일에만 적용해 확인한다.
- 테스트 출력에 VS Code 확장 Console Ninja의 `console.log`가 섞여 나온다. 실패 판단과는 관계없다.
