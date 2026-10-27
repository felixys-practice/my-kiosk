# 사이클 기록: 환불 기능 완료

추가만 한다. 최신 기록을 맨 아래에 둔다. 각 기록의 `red`는 구현 전에 테스트가 존재했고 실패했다는 증거다.
`tasks.md`의 Phase 검수 절차에 따른 Codex 검수 결과도 해당 Phase 끝에 이 파일로 기록한다.

## 기준선

- 전체 테스트: `npm run test && npm run test:e2e` → **미실행**. 2026-10-27 계획 작성 시점에 Docker 데몬이 꺼져 있어 PostgreSQL·Redis에 연결할 수 없었다.
- 커밋: `0f6338f`
- 기록 시점: 사이클 0, 변경 전
- 다음 조치: 첫 사이클 전에 저장소 루트에서 `docker compose -f docker/infra/docker-compose.yml up -d`로 인프라를 띄우고 전체 테스트를 실행해 이 절 아래에 결과를 새 기록으로 추가한다. 기준선이 실패 상태이면 루프를 시작하지 않는다.

### 기준선 재기록 (2026-10-27)

- 전체 테스트를 커밋 `0f6338f`(코드 변경 없음, 문서만 미커밋)에서 실행했다. 결과는 **통과(green)**다.
  - 단위 테스트 `npm run test`: 테스트 파일 23개, 테스트 163개 모두 통과.
  - E2E 테스트 `npm run test:e2e`: 테스트 파일 3개, 테스트 57개 모두 통과.
- 참고: E2E 실행 끝에 Jest가 "worker process has failed to exit gracefully" 경고를 냈다. 테스트 종료 후 닫히지 않은 연결이나 타이머가 남아 있다는 뜻이며 테스트 결과에는 영향이 없다. 이번 기능 범위 밖이라 원인 조사는 하지 않았다.
- 루프를 시작할 수 있다.

## 사이클 1: U1 PG_CALLBACK_SECRET 외 13개 환불 설정을 생략하면 API 계약 §8 기본값으로 읽힌다

- test: `src/config/configuration.spec.ts::configuration › refund·pgCallback 섹션 › PG_CALLBACK_SECRET 외 13개 환불 설정을 생략하면 API 계약 §8의 기본값으로 읽힌다` (신규)
- red: 프로필 `single` 명령, `{file}`=`src/config/configuration.spec.ts`, `{name}`=`13개 환불 설정을 생략하면`
  - 첫 실행 → `TypeError: Cannot read properties of undefined (reading 'resultWaitSeconds')` (1 failed). `refund` 섹션이 없어 생긴 오류라 유효한 red가 아니므로, `configuration.ts`에 빈 `refund: {}`·`pgCallback: {}`만 선언하고 다시 실행했다.
  - 재실행 → `expect(received).toEqual(expected)` / `- Expected - 13` `+ Received + 13`, 13개 값이 모두 `undefined` (1 failed)
- green: `src/config/configuration.ts`에 `refund` 섹션 12개 값과 `pgCallback.maxSkewSeconds`를 기존 `parseInt(process.env.X || '기본값', 10)` 방식으로 추가했다. 전체 → 단위 164 passed, E2E 57 passed
- refactor: 테스트 상수 `REFUND_ENV_DEFAULTS`를 eslint 이름 규칙(camelCase)에 맞춰 `refundEnvDefaults`로 바꿨다. 전체 재실행 → 단위 164, E2E 57 passed. `npx tsc --noEmit` 오류 없음
- commit: `db0db37`
- notes: 설정 키 이름(`refund.resultWaitSeconds` 등, `pgCallback.maxSkewSeconds`)은 설계 문서에 정해져 있지 않아 기존 `configuration.ts`의 섹션 관례(camelCase, 단위 접미사)를 따랐다. 기본값의 Joi 스키마 반영은 U2 이후 검증 동작에서 함께 다룬다.

## 사이클 2: U2 PG_CALLBACK_SECRET이 없으면 설정 검증이 실패한다

- test: `src/config/validation.schema.spec.ts::validationSchema › PG 콜백 서명 비밀값(PG_CALLBACK_SECRET) › PG_CALLBACK_SECRET이 없으면 필수값 누락으로 검증이 실패한다` (신규)
- red: 프로필 `single` 명령, `{file}`=`src/config/validation.schema.spec.ts`, `{name}`=`PG_CALLBACK_SECRET이 없으면`
  - 첫 작성본(`PG_CALLBACK_SECRET: undefined`를 넣고 경로만 확인)은 첫 실행에서 통과했다(1 passed). 스키마에 없는 키라서 Joi가 "허용되지 않는 키" 오류를 냈기 때문이다. 의도와 다른 이유로 통과한 것이므로, 키를 아예 빼고 오류 종류가 `any.required`인지 확인하도록 테스트를 고쳤다.
  - 수정본 실행 → `Expected: "any.required"` / `Received: undefined` (1 failed)
- green: `src/config/validation.schema.ts`에 `PG_CALLBACK_SECRET: Joi.string().required()`를 추가했다. 기존 테스트의 공용 정상 설정 `validEnv`에 32자 테스트 값 `test-pg-callback-secret-32-chars`를 추가했다(사용자 승인, 아래 notes). 전체 → 단위 165 passed, E2E 57 passed
- refactor: 필요 없음. 스키마 한 줄과 fixture 한 줄 추가
- commit: `526b539`
- notes:
  - 이전 사이클에 없던 기존 테스트 fixture(`validEnv`)를 바꿔야 green이 되는 상황이라 루프를 멈추고 사용자 확인을 받았다(2026-10-27). 사용자 결정: fixture 수정과 로컬 `.env` 추가 둘 다 반영. `validEnv` 변경은 검증을 느슨하게 하는 것이 아니라 정상 설정 예시를 새 필수 항목에 맞춘 것이다.
  - 로컬 `.env`(git 무시 대상, 커밋하지 않음)에 `PG_CALLBACK_SECRET`을 무작위 64자 16진수 값으로 추가했다. 없으면 앱이 기동하지 못해 E2E가 모두 실패한다.
  - fixture만 먼저 바꾸는 별도 단계는 불가능했다. 스키마에 키가 없는 상태에서 `validEnv`에 값을 넣으면 "허용되지 않는 키"로 기존 테스트 7개가 실패했다. 그래서 fixture 변경을 이 사이클의 green 단계에 포함했다.
  - `npx eslint src/config`의 `validation.schema.spec.ts` 오류 8건(`no-unsafe-assignment`·`no-unsafe-member-access`)은 커밋 `db0db37`의 같은 파일에도 그대로 있는 기존 오류다. 범위 밖이라 고치지 않았다.

## 사이클 3: U3 PG_CALLBACK_SECRET이 31자이면 설정 검증이 실패한다

- test: `src/config/validation.schema.spec.ts::validationSchema › PG 콜백 서명 비밀값(PG_CALLBACK_SECRET) › PG_CALLBACK_SECRET이 31자이면 검증이 실패한다` (신규)
- red: 프로필 `single` 명령, `{name}`=`31자이면` → `Expected: "string.min"` / `Received: undefined` (1 failed)
- green: `src/config/validation.schema.ts`의 `PG_CALLBACK_SECRET`에 `.min(32)`를 추가했다. 전체 → 단위 166 passed, E2E 57 passed
- refactor: 테스트 상수 `PG_CALLBACK_SECRET_MIN_LENGTH`를 eslint 이름 규칙에 맞춰 `pgCallbackSecretMinLength`로 바꿨다. 전체 재실행 → 단위 166, E2E 57 passed. `npx tsc --noEmit` 오류 없음
- commit: `2fcf4b6`

## 사이클 4: U4 PG_CALLBACK_SECRET이 32자이면 설정 검증을 통과한다

- test: `src/config/validation.schema.spec.ts::validationSchema › PG 콜백 서명 비밀값(PG_CALLBACK_SECRET) › PG_CALLBACK_SECRET이 32자이면 검증을 통과한다` (신규)
- red: 첫 실행에서 통과했다(1 passed). U3의 `.min(32)`가 이미 경계 반대편을 정하기 때문이다. 의도적 뮤턴트로 확인했다.
  - 뮤턴트: `validation.schema.ts`의 `.min(32)`를 `.min(33)`으로 바꾸고 같은 명령 실행 → `Received: [ValidationError: "PG_CALLBACK_SECRET" length must be at least 33 characters long]` (1 failed)
  - 원복 후 재실행 → 1 passed, `git diff`로 스키마 파일 변경 없음 확인
- green: 구현 변경 없음. 전체 → 단위 167 passed, E2E 57 passed
- refactor: 필요 없음
- commit: `59a4a02` (테스트만)

## 사이클 5: U5 REFUND_RESEND_LIMIT=0이면 설정 검증을 통과한다

- test: `src/config/validation.schema.spec.ts::validationSchema › 환불 PG 처리 설정(REFUND_*) › REFUND_RESEND_LIMIT=0이면 검증을 통과한다` (신규)
- red: 프로필 `single` 명령, `{name}`=`REFUND_RESEND_LIMIT=0이면` → `Received: [ValidationError: "REFUND_RESEND_LIMIT" is not allowed]` (1 failed). 스키마가 이 설정을 모르는 상태다.
- green: `validation.schema.ts`에 `REFUND_RESEND_LIMIT: Joi.number()`를 추가했다. 전체 → 단위 168 passed, E2E 57 passed
- refactor: 필요 없음
- commit: `c373a6e`

## 사이클 6: U6 REFUND_RESEND_LIMIT=-1이면 설정 검증이 실패한다

- test: `src/config/validation.schema.spec.ts::validationSchema › 환불 PG 처리 설정(REFUND_*) › REFUND_RESEND_LIMIT=-1이면 검증이 실패한다` (신규)
- red: `{name}`=`REFUND_RESEND_LIMIT=-1이면` → `Expected: "number.min"` / `Received: undefined` (1 failed)
- green: `REFUND_RESEND_LIMIT`에 `.min(0)`을 추가했다. 전체 → 단위 169 passed, E2E 57 passed
- refactor: 필요 없음
- commit: `c865e19`

## 사이클 7: U7 시간·횟수 설정이 0이면 설정 검증이 실패한다

- test: `src/config/validation.schema.spec.ts::validationSchema › 환불 PG 처리 설정(REFUND_*) › %s=0이면 검증이 실패한다` (신규, `it.each` 12개 설정)
- red: `{name}`=`=0이면 검증이 실패한다` → 12개 모두 `Received: "object.unknown"` (12 failed). 스키마가 12개 설정을 모르는 상태다.
- green: 양의 정수여야 하는 12개 설정(`REFUND_RESULT_WAIT_SECONDS`~`REFUND_RECOVERY_BATCH_SIZE`, `REFUND_MANUAL_CONFIRM_ALERT_SECONDS`, `PG_CALLBACK_MAX_SKEW_SECONDS`)을 `Joi.number().min(1)`로 추가했다. 전체 → 단위 181 passed, E2E 57 passed
- refactor: 필요 없음
- commit: `d7cc0d6`
- notes: 테스트 목록의 U7은 `REFUND_QUERY_INTERVAL_SECONDS` 하나를 표본으로 적었다. 하지만 T005는 시간·횟수 설정 전부에 양의 정수 검증을 요구하므로, 표본 하나만 테스트하면 나머지 11개의 검증은 테스트 없이 구현된다. 그래서 같은 동작을 12개 설정 전부에 대해 `it.each`로 확인했다. 동작 내용은 바뀌지 않고 확인 대상만 넓어졌다. U8·U9도 같다.

## 사이클 8: U8 시간·횟수 설정이 1이면 설정 검증을 통과한다

- test: `src/config/validation.schema.spec.ts::validationSchema › 환불 PG 처리 설정(REFUND_*) › %s=1이면 검증을 통과한다` (신규, `it.each` 12개 설정)
- red: 첫 실행에서 12개 모두 통과했다. U7의 `.min(1)`이 경계 반대편을 이미 정하기 때문이다. 의도적 뮤턴트로 확인했다.
  - 뮤턴트: `REFUND_QUERY_INTERVAL_SECONDS`를 `.min(2)`로 바꾸고 실행 → `REFUND_QUERY_INTERVAL_SECONDS=1이면 검증을 통과한다`가 `Received: [ValidationError: "REFUND_QUERY_INTERVAL_SECONDS" must be greater than or equal to 2]`로 실패 (1 failed, 11 passed)
  - 원복 후 `git diff`로 스키마 변경 없음 확인, 재실행 12 passed
- green: 구현 변경 없음. 전체 → 단위 193 passed, E2E 57 passed
- refactor: 필요 없음
- commit: `68ffd9a` (테스트만)

## 사이클 9: U9 시간·횟수 설정이 소수 1.5이면 설정 검증이 실패한다

- test: `src/config/validation.schema.spec.ts::validationSchema › 환불 PG 처리 설정(REFUND_*) › %s가 소수 1.5이면 검증이 실패한다` (신규, `it.each` 13개 설정)
- red: `{name}`=`소수 1.5이면` → 13개 모두 `Expected: "number.integer"` / `Received: undefined` (13 failed)
- green: 13개 설정 모두 `Joi.number()` 뒤에 `.integer()`를 추가했다. 전체 → 단위 206 passed, E2E 57 passed
- refactor: 필요 없음
- commit: `0c9ede4`
- notes: 12개 양의 정수 설정에 `REFUND_RESEND_LIMIT`도 포함했다. 재전송 한도도 횟수이므로 T005의 "시간·횟수는 양의 정수, 재전송 한도는 0 이상" 중 정수 조건이 적용된다고 보았다. 허용 하한(0 이상)은 U5·U6이 그대로 정한다.

## 사이클 10: U10 REFUND_WORK_LEASE_SECONDS가 REFUND_PG_TIMEOUT_SECONDS와 같으면 설정 검증이 실패한다 (1차, 되돌림)

- test: `src/config/validation.schema.spec.ts::validationSchema › 환불 PG 처리 설정(REFUND_*) › REFUND_WORK_LEASE_SECONDS가 REFUND_PG_TIMEOUT_SECONDS와 같으면 검증이 실패한다` (신규)
- red: `{name}`=`REFUND_PG_TIMEOUT_SECONDS와 같으면` → `Expected: "number.greater"` / `Received: undefined` (1 failed)
- green 시도: `REFUND_WORK_LEASE_SECONDS`에 `.greater(Joi.ref('REFUND_PG_TIMEOUT_SECONDS'))`를 추가했다. 새 테스트는 통과했으나 전체 단위 실행에서 사이클 8 테스트 `REFUND_WORK_LEASE_SECONDS=1이면 검증을 통과한다`가 실패했다(1 failed, 206 passed).
- 판단: 사이클 8 테스트가 계약과 맞지 않는다. API 계약 §8은 처리 기한 > PG 응답 제한(최소 1)이므로 처리 기한은 1이 될 수 없고, 정상 재조회 간격도 탐색 주기+응답 제한(최소 2) 이상이라 1이 될 수 없다. 테스트 목록의 U8 표본(`REFUND_QUERY_INTERVAL_SECONDS`)도 같은 이유로 잘못 적혀 있었다.
- 조치: 플레이북 규칙대로 U10 변경(테스트·구현)을 되돌려 마지막 green(`0c9ede4`)으로 돌아갔다. 잘못된 테스트 정정을 별도 단계로 먼저 커밋한 뒤 U10을 다시 진행했다. 커밋 없음.

## 정정: U8 테스트에서 1이 될 수 없는 두 설정 제외

- 변경: `%s=1이면 검증을 통과한다`의 대상에서 `REFUND_WORK_LEASE_SECONDS`·`REFUND_QUERY_INTERVAL_SECONDS`를 뺐다(12개 → 10개). `REFUND_QUERY_BACKOFF_MAX_SECONDS=1`은 첫 간격 `REFUND_QUERY_BACKOFF_SECONDS`도 1로 둔 상태에서 확인한다. 두 설정의 하한은 U10~U13의 설정 간 관계 검증이 정한다.
- 이유: 위 사이클 10의 판단. 검증을 느슨하게 한 것이 아니라 계약상 허용될 수 없는 값을 "통과"로 기대하던 잘못을 고친 것이다.
- 검증: 단위 204 passed, E2E 57 passed (구현 변경 없음)
- 테스트 목록 U8 문구를 같은 내용으로 고치고 정정 사유를 행에 남겼다.
- commit: `3e9cd4c`

## 사이클 11: U10 (재진행)

- red: 저장해 둔 U10 테스트를 다시 적용하고 실행 → `Expected: "number.greater"` / `Received: undefined` (1 failed)
- green: `REFUND_WORK_LEASE_SECONDS`에 `.greater(Joi.ref('REFUND_PG_TIMEOUT_SECONDS'))`를 추가했다. 전체 → 단위 205 passed, E2E 57 passed
- refactor: 필요 없음
- commit: `366fd6d`

## 사이클 12: U11 REFUND_WORK_LEASE_SECONDS가 REFUND_PG_TIMEOUT_SECONDS보다 1 크면 설정 검증을 통과한다

- test: `...› REFUND_WORK_LEASE_SECONDS가 REFUND_PG_TIMEOUT_SECONDS보다 1 크면 검증을 통과한다` (신규, 응답 제한 10·처리 기한 11)
- red: 첫 실행에서 통과(1 passed). 뮤턴트로 확인했다.
  - 뮤턴트: 비교 기준을 `Joi.ref('REFUND_PG_TIMEOUT_SECONDS', { adjust: (v) => v + 1 })`로 바꿈 → `Received: [ValidationError: "REFUND_WORK_LEASE_SECONDS" must be greater than ref:REFUND_PG_TIMEOUT_SECONDS]` (1 failed)
  - `git checkout`으로 원복, `git diff` 변경 없음 확인, 재실행 1 passed
- green: 구현 변경 없음. 전체 → 단위 206 passed, E2E 57 passed
- refactor: 필요 없음
- commit: `60be0df` (테스트만)

## 사이클 13: U13 REFUND_QUERY_INTERVAL_SECONDS가 SWEEP+TIMEOUT보다 1 작으면 설정 검증이 실패한다

- 순서: 목록은 U12(같으면 통과) → U13(1 작으면 실패) 순이지만, 관계 규칙이 없는 상태에서 U12는 처음부터 통과하고 깨뜨릴 구현도 없어 뮤턴트 확인을 할 수 없다. 그래서 실패 쪽 U13을 먼저 진행했다. U14·U15도 같은 이유로 U15를 먼저 진행했다.
- test: `...› REFUND_QUERY_INTERVAL_SECONDS가 SWEEP+TIMEOUT보다 1 작으면 검증이 실패한다` (신규, 탐색 5·응답 제한 10·간격 14)
- red: `{name}`=`SWEEP\+TIMEOUT보다 1 작으면`(이름의 `+`는 `-t` 정규식이라 이스케이프. 이스케이프 없이 실행한 첫 명령은 `선택된 테스트 0개`, 종료 코드 2) → `Expected: "number.min"` / `Received: undefined` (1 failed)
- green: `.min(Joi.x('{A + B}'))`처럼 `min`을 한 번 더 걸면 앞의 `.min(1)`이 대체되어, 참조 대상이 없을 때 0도 통과하는 것을 별도 Joi 확인 스크립트로 확인했다. 그래서 `.min(1)`은 두고 `.custom()`으로 탐색 주기+응답 제한 이상인지 검사해 `number.min` 오류를 내도록 했다. 전체 → 단위 207 passed, E2E 57 passed
- refactor: 새 eslint 오류(`ancestors[0]` 접근의 `no-unsafe-member-access`)를 `const [env] = helpers.state.ancestors as Record<string, number>[]`로 고쳤다. 전체 재실행 단위 207, E2E 57 passed
- commit: `2fd47c0`

## 사이클 14: U12 REFUND_QUERY_INTERVAL_SECONDS가 SWEEP+TIMEOUT과 같으면 설정 검증을 통과한다

- test: `...› REFUND_QUERY_INTERVAL_SECONDS가 SWEEP+TIMEOUT과 같으면 검증을 통과한다` (신규, 탐색 5·응답 제한 10·간격 15)
- red: 첫 실행에서 통과(1 passed). 뮤턴트: `value >= limit`를 `value > limit`로 바꿈 → `Received: [ValidationError: "REFUND_QUERY_INTERVAL_SECONDS" must be greater than or equal to 15]` (1 failed). 원복·`git diff` 확인 후 1 passed
- green: 구현 변경 없음. 전체 → 단위 208 passed, E2E 57 passed
- refactor: 필요 없음
- commit: `d8170be` (테스트만)

## 사이클 15: U15 REFUND_QUERY_BACKOFF_MAX_SECONDS가 REFUND_QUERY_BACKOFF_SECONDS보다 1 작으면 설정 검증이 실패한다

- test: `...› REFUND_QUERY_BACKOFF_MAX_SECONDS가 REFUND_QUERY_BACKOFF_SECONDS보다 1 작으면 검증이 실패한다` (신규, 첫 간격 15·상한 14)
- red: → `Expected: "number.min"` / `Received: undefined` (1 failed)
- green: `REFUND_QUERY_BACKOFF_MAX_SECONDS`에 U13과 같은 방식의 `.custom()`을 붙였다. 전체 → 단위 209 passed, E2E 57 passed
- refactor: 두 `.custom()`의 중복을 `atLeastSumOf(...keys)` 함수로 추출했다. 전체 재실행 단위 209, E2E 57 passed, eslint·tsc 오류 없음
- commit: `12cbf4f` (동작), `cd05de1` (구조)

## 사이클 16: U14 REFUND_QUERY_BACKOFF_MAX_SECONDS가 REFUND_QUERY_BACKOFF_SECONDS와 같으면 설정 검증을 통과한다

- test: `...› REFUND_QUERY_BACKOFF_MAX_SECONDS가 REFUND_QUERY_BACKOFF_SECONDS와 같으면 검증을 통과한다` (신규, 둘 다 15)
- red: 첫 실행에서 통과(1 passed). 뮤턴트: `atLeastSumOf`의 `>=`를 `>`로 바꿈 → `Received: [ValidationError: "REFUND_QUERY_BACKOFF_MAX_SECONDS" must be greater than or equal to 15]` (1 failed). 원복·`git diff` 확인 후 1 passed
- green: 구현 변경 없음. 전체 → 단위 210 passed, E2E 57 passed
- refactor: 필요 없음
- commit: `cd4f3de` (테스트만)

## 추가한 동작: U267~U269

U10~U15를 마친 뒤, 관계 검증의 비교 대상 설정을 생략하면 정상 값도 거부되는 문제를 발견해 테스트 목록에 추가했다. 예: `REFUND_WORK_LEASE_SECONDS=40`만 설정하면 응답 제한이 Joi 단계에서 비어 있어 `limit references "ref:REFUND_PG_TIMEOUT_SECONDS" which must be a number`로 앱 기동이 막힌다. 기본값은 `configuration.ts`에만 있고 Joi 스키마에는 없었기 때문이다. 근거는 FR-055·FR-025와 U1(생략 시 기본값 사용)이다.

## 사이클 17: U267 응답 제한을 생략하고 처리 기한=11만 설정하면 통과한다

- test: `...› REFUND_PG_TIMEOUT_SECONDS를 생략하고 REFUND_WORK_LEASE_SECONDS=11만 설정하면 기본 응답 제한 10과 비교해 통과한다` (신규)
- red: → `Received: [ValidationError: "REFUND_WORK_LEASE_SECONDS" limit references "ref:REFUND_PG_TIMEOUT_SECONDS" which must be a number]` (1 failed)
- green: `REFUND_PG_TIMEOUT_SECONDS`에 `.default(10)`을 추가했다. 단위 211 passed. E2E 첫 실행은 `test/ticket-pause.e2e-spec.ts`에서 2 failed, 55 passed였다.
- E2E 실패 확인: 같은 파일 단독 재실행 16 passed, 전체 E2E 3회 연속 57 passed로 재현되지 않았다. 변경은 Joi 기본값 하나이고 일시정지 기능과 관련이 없어 간헐 실패로 판단했다. 첫 실행 출력은 요약 줄만 걸러 보았기 때문에 실패한 테스트 이름은 남아 있지 않다. 프로필의 "E2E 동시 실행 금지" 사례(2026-10-24)와 같은 원인일 가능성이 있으나 확인하지 못했다.
- refactor: 필요 없음
- commit: `a9361fa`

## 사이클 18: U268 탐색 주기·응답 제한을 생략하고 재조회 간격=15만 설정하면 통과한다

- test: `...› SWEEP·TIMEOUT을 생략하고 REFUND_QUERY_INTERVAL_SECONDS=15만 설정하면 기본값 합 15와 비교해 통과한다` (신규)
- red: → `Received: [ValidationError: "REFUND_QUERY_INTERVAL_SECONDS" must be greater than or equal to NaN]` (1 failed)
- green: `REFUND_SWEEP_INTERVAL_SECONDS`에 `.default(5)`를 추가했다. 그래도 같은 오류로 실패했다(`NaN`). 응답 제한이 재조회 간격보다 뒤에 선언되어 있어 custom 검증 시점에 기본값이 아직 들어가 있지 않았기 때문이다. `REFUND_PG_TIMEOUT_SECONDS` 선언을 재조회 간격 앞으로 옮기고 그 이유를 주석으로 남겼다. 전체 → 단위 212 passed, E2E 57 passed
- refactor: 필요 없음
- commit: `7078b32`

## 사이클 19: U269 첫 재조회 간격을 생략하고 간격 상한=15만 설정하면 통과한다

- test: `...› REFUND_QUERY_BACKOFF_SECONDS를 생략하고 REFUND_QUERY_BACKOFF_MAX_SECONDS=15만 설정하면 기본 첫 간격 15와 비교해 통과한다` (신규)
- red: → `Received: [ValidationError: "REFUND_QUERY_BACKOFF_MAX_SECONDS" must be greater than or equal to NaN]` (1 failed)
- green: `REFUND_QUERY_BACKOFF_SECONDS`에 `.default(15)`를 추가했다(이미 상한보다 앞에 선언됨). 전체 → 단위 213 passed, E2E 57 passed, eslint·tsc 오류 없음
- refactor: 필요 없음
- commit: `de738ea`

## T005 나머지: `.env.example`

- `.env.example`에 계약 §8의 14개 설정 항목, 기본값, 관계 조건 주석을 추가했다(`PG_CALLBACK_SECRET`은 빈 값). 파일의 기본값 묶음에 테스트용 비밀값만 넣어 검증 스키마를 통과하는지 일회성 스크립트로 확인했다. 동작 변경이 아니라 사이클 기록 대상이 아니다.
- commit: `ad6744d`

## Phase 1 준비 작업: T001~T003 (동작 표식 없음, TDD 사이클 아님)

- T001: 기존 환불·결제·PG 코드의 현재 동작, 테스트 기준선, 새 계약에서 바뀌는 점을 `tdd/baseline.md`에 기록했다.
- T002: `test/helpers/refund-test-context.ts`를 만들었다. 앱 기동, 고객·다른 고객·점주·공동 점주·다른 매장 점주·MANAGER, 매장 2개, 시간권·정기권·고정석 이용권 발급(실제 상품 등록·주문·결제 API 사용), 만든 사용자·매장 ID 기준 정리를 제공한다.
- T003: `test/helpers/refund-pg.stub.ts`를 만들었다. 송신·조회 결과 지정, 호출 기록(PG 취소 요청 식별자·금액), 응답 지연, 응답 전 중단, 초기화를 제공한다. 결과 종류는 API 계약 §8을 따른다. 운영 코드는 바꾸지 않았다.
- 확인: 임시 E2E 파일로 세 종류 이용권 발급, 다른 매장 발급, 공동 점주 연결, 고정석 배정 ACTIVE, PG 대역의 결과 순서·중단·기본값·지연·호출 기록·초기화를 확인했다. `close()` 뒤 DB에서 해당 사용자·매장이 0건임을 `psql`로 확인했다. 임시 파일은 삭제했다. 전체 → 단위 213 passed, E2E 57 passed. eslint·tsc 오류 없음
- 남은 연결: 대역의 메서드 이름 `sendCancel`·`inquireCancel`과 결과 타입은 운영 PG 타입이 정해지기 전이라 계약 §8 기준으로 임시로 정했다. 운영 타입은 T016, 앱에 대역을 끼우는 교체 지점은 T018에서 맞춘다.
