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

## Phase 1 Codex 검수 1차 (2026-10-28)

- 범위: `80ed1ed..e1c5c07`, T001~T005
- 판정: **수정 필요**. 확정된 업무 결정을 바꾸는 지적은 없고 구현 결함 2건이다.
  - P1: 관계식의 검사 대상(처리 기한·재조회 간격·간격 상한)을 생략하면 관계 검증이 실행되지 않는다. 예: `REFUND_PG_TIMEOUT_SECONDS=40`만 넣으면 처리 기한 기본값 30이 쓰이는데도 오류가 없다. `REFUND_SWEEP_INTERVAL_SECONDS=20`만, `REFUND_QUERY_BACKOFF_SECONDS=500`만 넣은 경우도 같다. Joi 필드에 `default`만 붙이면 생략된 값에는 기본값만 넣고 관계 규칙을 건너뛴다는 점도 지적했다.
  - P2: `configuration.ts`의 `parseInt` 재변환이 Joi와 숫자를 다르게 해석한다. `REFUND_WORK_LEASE_SECONDS=3e1`이면 Joi 검증값은 30, 실제 사용값은 3이다. 외부 환경 변수가 이미 있으면 Nest `ConfigModule`이 검증값으로 덮어쓰지 않는다.
  - 쟁점 의견: U8 정정 타당, U7~U9 전체 확인·재전송 한도 정수 타당, 기본값 중복은 P1 해결 우선·불일치 방지 필요, PG 대역 선행 순서와 기본값 적절, JWT 콜백·로컬 비밀값은 차단 사유 아님, ticket-pause 간헐 실패는 다음 실패 시 이름·전체 출력 보존.
- 처리: 지적을 동작 U270~U273으로 테스트 목록에 추가하고 아래 사이클로 고쳤다.

## 사이클 20: U270 REFUND_WORK_LEASE_SECONDS=3e1이면 처리 기한 30초로 읽힌다 (P2)

- test: `src/config/configuration.spec.ts::configuration › refund·pgCallback 섹션 › REFUND_WORK_LEASE_SECONDS=3e1이면 설정 검증과 같은 숫자 해석으로 30초로 읽힌다` (신규)
- red: `{name}`=`REFUND_WORK_LEASE_SECONDS=3e1이면` → `Expected: 30` / `Received: 3` (1 failed)
- green: `configuration.ts`의 `refund`·`pgCallback` 값을 `parseInt` 대신 `validationSchema.validate(process.env, { allowUnknown: true, abortEarly: false }).value`에서 읽도록 바꿨다. 기본값이 검증 스키마 한 곳에만 있도록, 아직 기본값이 없던 환불 설정 10개에 계약 §8 기본값을 `.default()`로 추가했다. U1(기본값 13개)은 그대로 통과했다. 전체 → 단위 214 passed, E2E 57 passed
- refactor: 필요 없음
- commit: `d769066`

## 사이클 21: U271 REFUND_PG_TIMEOUT_SECONDS=40만 설정하면 검증이 실패한다 (P1)

- test: `src/config/validation.schema.spec.ts::...› REFUND_PG_TIMEOUT_SECONDS=40만 설정하면 기본 처리 기한 30과 비교해 검증이 실패한다` (신규)
- red: → `Expected: "number.greater"` / `Received: undefined` (1 failed)
- green: 처리 기한의 키 단위 `.greater(Joi.ref(...))`를 지우고, 스키마 객체 전체에 `.custom(checkRefundRelations)`를 붙였다. 이 함수는 기본값이 모두 채워진 최종 설정에서 처리 기한 > 응답 제한을 검사하고, 오류 경로를 `REFUND_WORK_LEASE_SECONDS`로 지정한다. 객체 단위에서는 `number.greater` 메시지가 정의돼 있지 않아 `.messages()`로 추가했다. 일회성 스크립트로 메시지가 `"REFUND_WORK_LEASE_SECONDS" must be greater than 40`으로 나오는 것을 확인했다. 전체 → 단위 215 passed, E2E 57 passed. 기존 U10·U11·U267 통과 유지
- refactor: 필요 없음
- commit: `c06324d`

## 사이클 22: U272 REFUND_SWEEP_INTERVAL_SECONDS=20만 설정하면 검증이 실패한다 (P1)

- test: `...› REFUND_SWEEP_INTERVAL_SECONDS=20만 설정하면 기본 재조회 간격 15가 20+10보다 작아 검증이 실패한다` (신규)
- red: → `Expected: "number.min"` / `Received: undefined` (1 failed)
- green: 재조회 간격의 키 단위 `.custom(atLeastSumOf(...))`를 지우고 `checkRefundRelations`에 재조회 간격 ≥ 탐색 주기+응답 제한 검사를 옮겼다. `number.min` 메시지도 추가했다. 단위 216 passed. E2E는 `seat-type.e2e-spec.ts` QS-31이 1건 실패했다.
- E2E 실패 확인: QS-31 단독 재실행 통과. 이번에도 첫 실행 출력은 요약만 걸러 봐서 전체 오류가 남아 있지 않다. 이후 E2E 출력을 모두 파일로 저장하며 전체 E2E를 6번 더 실행했고, 4번째 실행에서 다른 테스트(QS-15b)가 실패했다. 출력: `expected 201 "Created", got 426 "Upgrade Required"` (`POST /orders`, `seat-type.e2e-spec.ts:311`). 나머지 5번은 57 passed였다.
- 원인 조사: 저장소 코드와 Nest·Express에는 426 응답이 없다. 로컬의 VS Code 보조 프로세스가 `127.0.0.1:58389`에서 대기하고 있고, HTTP 요청에 426으로 답한다(curl로 확인). 이 포트는 OS가 임시로 나눠 주는 포트 범위 안에 있다. 그래서 supertest가 띄운 테스트 서버가 같은 번호를 받으면 `127.0.0.1` 요청이 VS Code 쪽으로 가는 것으로 판단했다. 이번 변경과는 관계없는 테스트 환경 문제이고, 사이클 17의 ticket-pause 간헐 실패도 같은 원인일 가능성이 높다(추정). 범위 밖이라 고치지 않았다.
- commit: `b65c187`

## 사이클 23: U273 REFUND_QUERY_BACKOFF_SECONDS=500만 설정하면 검증이 실패한다 (P1)

- test: `...› REFUND_QUERY_BACKOFF_SECONDS=500만 설정하면 기본 간격 상한 300이 500보다 작아 검증이 실패한다` (신규)
- red: → `Expected: "number.min"` / `Received: undefined` (1 failed)
- green: 간격 상한의 키 단위 custom을 지우고 `checkRefundRelations`에 간격 상한 ≥ 첫 간격 검사를 옮겼다. 전체 → 단위 217 passed, E2E 57 passed(출력 파일 저장)
- refactor: 쓰지 않게 된 `atLeastSumOf` 함수와, 선언 순서에 의존하던 주석을 지웠다. 전체 재실행 단위 217, E2E 57 passed, eslint·tsc 오류 없음, `.env.example` 값 검증 통과
- commit: `7171763` (동작), `acde709` (구조)

## Phase 1 Codex 재검수 (2026-10-28)

- 범위: `e1c5c07..7f01a0c`, 소스·테스트 diff와 사이클 20~23
- 판정: **통과**. 1차 지적 P1·P2는 해결됐고 추가로 차단할 결함은 없다.
- Codex 직접 검증: 설정 테스트 2개 파일 86개 통과. 읽기 전용 스크립트로 다음을 확인했다.
  - 세 누락 조합의 거절과 오류 path·type·message
  - 정상 경계 조합(응답 제한 40+처리 기한 41+재조회 간격 45, 탐색 20+재조회 간격 30, 첫 간격 500+상한 500)
  - 기본값 전체, `3e1`→실제 30, 여러 관계가 동시에 깨질 때의 기동 차단
  - 전체 단위·E2E·tsc·eslint는 Codex가 다시 실행하지 않았다.
- 의견: 객체 단위 custom이 첫 관계 오류만 반환하는 것은 차단 사유가 아니다. 계약이 오류 일괄 반환을 요구하지 않고, 어느 관계를 위반해도 기동이 거절되기 때문이다.

## 정정: 사이클 22의 426 원인 문장

- 사이클 22에 "VS Code 보조 프로세스와 임시 포트가 겹쳐 요청이 그쪽으로 간 것으로 판단했다"고 적었다. 이는 **확인되지 않은 가설**이다. 사이클 17의 ticket-pause 실패와 같은 원인이라는 연결도 확정되지 않았다.
- Codex 근거:
  - VS Code 프로세스가 같은 포트에서 426을 준다는 사실만으로 supertest가 그 포트에 잘못 연결됐다고 입증되지 않는다.
  - 설치된 `supertest/lib/test.js`는 `app.listen(0)` 뒤 `app.address().port`로 `127.0.0.1`에 접속한다.
  - 재검수 중 supertest HTTP 테스트를 실행하지 않았는데도 `127.0.0.1:58389` 연결 EPERM이 났다. 따라서 도구 연동 코드가 그 포트에 접속하는 경로와 실제 테스트 요청 경로를 구분해야 한다.
- 남은 환경 쟁점: E2E 간헐 실패(`426 Upgrade Required`) 원인 미확정. 다음 실패 때는 실패 직전 `app.address()`의 주소군과 포트, 응답 헤더와 본문, 그 시점의 리스너 목록을 함께 확보한다. 이번 설정 수정의 통과를 막는 사유는 아니다.

## Phase 1 완료

- T001~T005 완료, Codex 재검수 통과. 다음은 Phase 2(T006~T018)다.

## Phase 2 진행 방식 (2026-10-28)

- **마이그레이션**: 사용자 결정에 따라 사이클마다 작은 추가 마이그레이션을 만들어 개발 DB에 적용했다. tasks.md T007~T010은 확장 마이그레이션 파일 하나(`20261027000100_refund_completion_expand`)를 요구하지만, 그 방식은 사이클마다 개발 DB를 초기화해야 해서 택하지 않았다. 하나로 합칠지는 PR 전에 따로 정한다.
- **DB 제약 테스트**: `src/prisma/refund-constraints.integration.spec.ts`가 개발 DB(PostgreSQL)에 직접 저장해 확인한다. 테스트마다 새 주문 항목·결제를 만들고, afterAll에서 자기 데이터만 지운다.
- **red**: 각 동작은 모델이나 열만 있고 제약은 없는 상태에서 "중복·음수 저장이 성공한다"를 먼저 확인했다. 실패 출력은 모두 `Received promise resolved instead of rejected`다. 제약 이름이 오류 메시지에 들어가므로, CHECK 테스트는 `/제약이름/`으로 실패 이유를 고정했다.
- **이미 있던 제약**(U24·U28)과 경계 허용 쪽 동작(U17·U20·U22·U32)은 처음부터 통과한다. 그래서 개발 DB에서 인덱스나 제약을 잠시 바꾸는 뮤턴트로 테스트가 실패하는 것을 확인했다. 그 뒤 원래 정의를 다시 만들고, `pg_indexes`·`pg_constraint`의 정의가 같은지 확인했다.
- **Prisma가 관리하지 않는 제약**(부분 unique 인덱스, CHECK)은 기존 프로젝트 방식대로 raw SQL 마이그레이션으로 만들었다. `schema.prisma`의 모델에는 이름을 주석으로 남겼다.
- **도구 문제**:
  - Prisma 7의 `migrate dev`는 클라이언트를 자동으로 생성하지 않는다. U21의 첫 실행은 클라이언트가 옛 상태라 무효 red였고, `prisma generate` 뒤 다시 확인했다.
  - unique 추가 경고가 있으면 `migrate dev`가 비대화형 환경에서 실패한다. U23부터는 `prisma migrate diff`로 SQL을 만들고 마이그레이션 폴더를 직접 만들어 `migrate deploy`로 적용했다.

## 사이클 24~59: Phase 2 DB 제약 (U16~U34, U274~U283)

| 동작 | 내용 | red (프로필 `single`, `{file}`=`src/prisma/refund-constraints.integration.spec.ts`) | green | 커밋 |
|---|---|---|---|---|
| U16 | 같은 주문 항목의 확정된 상품 대상 환불 두 번째 저장 실패 | 1 failed, `Received promise resolved instead of rejected` | Refund 모델 선언 마이그레이션 + `refunds_order_item_id_accepted_key` 부분 unique | `1800975` |
| U17 | 과거 거절 이력은 확정 환불과 공존 | 첫 실행 통과 → 뮤턴트(인덱스 조건에서 decision_status 제거) 1 failed | 구현 변경 없음 | `68f40d3` |
| U18 | 같은 결제의 확정된 결제 전체 대상 환불 두 번째 저장 실패 | 1 failed, 위와 같은 출력 | `refunds_payment_id_accepted_key` 부분 unique | `f18fb14` |
| U19 | 확정된 환불 금액 -1 실패 | 1 failed | `refunds_amount_check` (amount >= 0) | `18cccae` |
| U20 | 확정된 환불 금액 0 저장 | 첫 실행 통과 → 뮤턴트(amount > 0) 1 failed, `violates check constraint` | 구현 변경 없음 | `356a732` |
| U274 | 지급 합계 -1 실패 | 1 failed | `refunds_paid_amount_check` | `4257693` |
| U275 | 확정된 환불의 NOT_APPLICABLE 실패 | 1 failed | `refunds_not_applicable_legacy_check` | `599119b` |
| U276 | 상품 대상인데 주문 항목 없음 실패 | 1 failed | `refunds_order_item_target_check` | `fa901b0` |
| U277 | 결제 전체 대상인데 주문 항목 있음 실패 | 1 failed | `refunds_payment_target_item_check` | `328b580` |
| U278 | 결제 전체 대상인데 SYSTEM 아님 실패 | 1 failed | `refunds_payment_target_source_check` | `8f9cca7` |
| U279 | 확정된 고객 환불의 실행자 없음 실패 | 1 failed | `refunds_accepted_actor_check` | `c78acb1` |
| U280 | 확정된 매장 환불의 종료 동의 없음 실패 | 1 failed | `refunds_accepted_consent_check` | `afaba94` |
| U281 | 확정된 환불의 확정 시각 없음 실패 | 1 failed | `refunds_accepted_at_check` | `331f368` |
| (T008 선언) | PaymentCancel 필드·상태·실패 사유, Payment.approvedAmount, 환불 관련 FK ON DELETE RESTRICT | — | 구조 변경 | `5eae3ab` |
| U21 | 한 환불의 미확정 요청 두 번째 저장 실패 | 클라이언트 재생성 후 1 failed (첫 실행은 무효 red) | `payment_cancels_refund_id_active_key` 부분 unique | `89a9a71` |
| U22 | FAILED가 있어도 새 REQUESTED 저장 | 첫 실행 통과 → 뮤턴트(상태 조건 없는 unique) 1 failed | 구현 변경 없음 | `656be2d` |
| U23 | 같은 (refundId, attemptNumber) 실패 | 1 failed | `@@unique([refundId, attemptNumber])` | `95cf511` |
| U24 | 같은 PG 취소 거래 ID 실패 | 첫 실행 통과(기존 unique) → 뮤턴트(인덱스 제거) 1 failed | 구현 변경 없음 | `d91d25a` |
| U25 | 실제 취소액 -1 실패 | 1 failed | `payment_cancels_actual_amount_check` | `b9b87db` |
| U282 | 횟수 필드 5개 -1 실패 | 5 failed | `payment_cancels_counts_check` | `3321049` |
| (T009 선언) | ManualRefundPayout 모델, TicketPause closedAt·closeReason | — | 구조 변경 | `f51a5e6` |
| U26 | 한 환불의 RESERVED 두 번째 저장 실패 | 1 failed | `manual_refund_payouts_refund_id_reserved_key` 부분 unique | `cc6c4d0` |
| U27 | 다른 환불의 같은 외부 거래 식별자 실패 | 1 failed | `externalTransactionId @unique` | `93200da` |
| U283 | 별도 지급 금액 0 실패 | 1 failed | `manual_refund_payouts_amount_check` (amount > 0) | `bf59da3` |
| (T010 선언) | Ledger refundId·manualRefundPayoutId, RefundNotification·Receipt, RefundRecoveryControl, RefundIdempotencyRecord | — | 구조 변경 | `82c0397` |
| U28 | 같은 paymentCancelId 원장 실패 | 첫 실행 통과(기존 unique) → 뮤턴트(인덱스 제거) 1 failed | 구현 변경 없음 | `a458e59` |
| U29 | 같은 manualRefundPayoutId 원장 실패 | 1 failed | `manualRefundPayoutId @unique` | `0e9fdf9` |
| U30 | 두 지급을 모두 가리키는 원장 실패 | 1 failed | `ledger_single_payout_check` | `5790e71` |
| U31 | 같은 환불의 0원 원장 두 번째 실패 | 1 failed | `ledger_refund_id_zero_payout_key` 부분 unique | `6ff7c54` |
| U32 | 같은 (notificationId, userId) 읽음 실패 | 첫 실행 통과(복합 PK) → 뮤턴트(PK 제거) 1 failed | 구현 변경 없음 | `9e4fdfa` |
| U33 | 같은 사건·범위·수신자 알림 실패(수신자 null 포함) | 1 failed | NULLS NOT DISTINCT unique → 리팩터링으로 부분 unique 2개 | `8ffff6a`, `3e7e299`(구조) |
| U34 | 같은 (requesterId, operation, key) 멱등 기록 실패 | 1 failed | `@@unique([requesterId, operation, key])` | `dda3df6` |

- 각 green 뒤 전체 실행 결과: 단위 218 → 251 passed, E2E 57 passed. 단, 아래 이탈 사항이 있다.
- 추가 동작 U274~U283: data-model §3·§6·§5가 정했지만 테스트 목록에 빠져 있던 값 제약이다. 불변식 INV-2로 근거를 적고 목록에 추가했다.
- U33 리팩터링: NULLS NOT DISTINCT unique 인덱스를 Prisma가 "스키마 밖 일반 인덱스"로 보고 다음 diff에서 `DROP INDEX`를 만들려 했다. 그래서 같은 의미의 부분 unique 2개(수신자 있음·없음)로 나눴다. 나누기 전에 수신자가 있는 경우의 테스트를 추가해 통과를 확인했고, 나눈 뒤 두 테스트가 모두 통과했다.

### 이탈과 미해결 사항

- **red 상태 커밋 1건**: `89a9a71`(U21)은 E2E 2건이 실패한 상태에서 커밋됐다. 도우미 스크립트가 실패를 확인하지 않고 커밋했기 때문이다.
  - 실패 내용: seat-type QS-25 `expected 200, got 404`, QS-10 `expected 201, got 401`
  - 이후 E2E 3회 재실행은 모두 57 passed였다. 도우미를 고쳐 이후 red 상태의 커밋 2건을 막았다.
- **E2E 간헐 실패(원인 미확정)**: Phase 2 중 seat-type E2E가 다음과 같이 실패했다.
  - U32 직전: QS-19 `got 401`
  - U32 재실행: QS-3 `got 401`
  - 모두 바로 재실행하면 통과했다. 실패 로그와 그 시점 리스너 목록은 스크래치 패드에 저장했다.
  - JWT 검증이 401을 내는 조건(토큰 형식, 사용자별 `session_revoked` Redis 키)을 확인했지만 E2E 사용자에게 해당할 근거는 찾지 못했다. Phase 1 재검수의 정정대로 원인은 확정하지 않는다.
- **E2E 멈춤 1건**: U25에서 E2E가 10분 넘게 출력 없이 멈춰 직접 종료했다. 그 시각 DB에는 대기 중인 쿼리가 없었다. VS Code Jest 확장이 `--watch`로 단위 테스트를 14시간째 실행 중이었다(PID 99019). TDD 프로필은 IDE와 E2E를 동시에 돌리지 않도록 정하고 있으므로, 간헐 실패와의 관계를 사용자에게 알린다.
- **설계 확인 필요**(검수 때 함께 알림):
  - `PaymentCancel.failedAt`이 기존 스키마에서 `@updatedAt`이다. 앞으로 담당 토큰·조회 일정을 갱신할 때마다 실패 시각이 바뀐다. data-model §4는 실패 확정 시각으로 정의한다.
  - 재개 없이 닫은 정지 기록(`closedAt`)도 기존 부분 unique `unique_active_ticket_pause`(`resumed_at IS NULL`)에서는 "활성"으로 남는다. REVOKED 이용권에는 새 정지를 만들지 않으므로 제약 충돌은 없지만, "활성 정지"를 `resumedAt IS NULL`로 찾는 기존 조회는 닫힌 기록을 활성으로 볼 수 있다.
  - 0원 원장의 금액이 0이어야 한다는 조건은 DB 제약으로 두지 않았다(테스트 목록에 없음).
  - "이용권이 있는 신규 환불의 종료 시각 필수"는 다른 테이블을 봐야 해서 DB CHECK로 표현할 수 없다. 환불 확정 서비스(US1)에서 검증한다.

## 사이클 60~75: Phase 2 멱등·오류 코드·권한 범위·PG 현재 동작 (U35~U50)

공통:
- red는 프로필 `single` 명령으로 확인했다.
- 단위 테스트의 저장소는 두 가지로 만들었다.
  - 멱등 서비스: (requesterId, operation, key) 고유성을 흉내 내는 메모리 대역
  - 권한 서비스: `jest.Mocked` 저장소
- 각 green 뒤 전체 실행 결과는 단위 252 → 271 passed, E2E 57 passed다.

| 동작 | 테스트 | red | green | 커밋 |
|---|---|---|---|---|
| U35 | `refund-idempotency.service.spec.ts` 같은 키·같은 본문 재요청은 최초 응답 | 1 failed, `- Expected - 1 / + Received + 1`(refund-2 ≠ refund-1) | 처리 중 기록 생성이 실패하면 저장된 응답 반환 | `54aa8bb` |
| U36 | 같은 키·다른 본문은 `IdempotencyKeyReusedError` | 1 failed, `Received promise resolved instead of rejected` | 본문 지문 비교 | `561f440` |
| U37 | 최초 요청 처리 중이면 `IdempotencyRequestInProgressError` | 1 failed, 위와 같음 | IN_PROGRESS 기록이면 거절 | `63bf05a` |
| U38 | 재요청 시점에 권한이 없으면 `RefundForbiddenError` | 1 failed, 위와 같음 | 저장된 응답을 돌려주기 전에 `authorize()` 호출 | `24f42c2` |
| U39 | 600초(Redis 키 만료) 지난 뒤에도 DB 기록의 최초 응답 | 첫 실행 통과 → 뮤턴트(600초 지나면 처리 재실행) 1 failed | 구현 변경 없음 | `567908e` |
| U40 | 동의 누락으로 거절된 키가 이후 유효 요청을 막지 않음 | 1 failed, `IdempotencyKeyReusedError` 발생 | 처리 실패 시 기록 삭제 후 오류 전달 | `b90f20d` |
| U42 | 129자 키 거절 | 1 failed, `Received promise resolved instead of rejected` | 길이 128 초과면 `BadRequestException` | `8c34ed0` |
| U41 | 128자 ASCII 키 허용 | 첫 실행 통과 → 뮤턴트(최대 127) 1 failed | 구현 변경 없음 | `9eea1e9` |
| U43 | 공백이 든 키 거절 | 1 failed | `/^[\x21-\x7E]+$/` 검사 | `0a6eb23` |
| U44 | 사유의 앞뒤 공백만 다르면 같은 본문 | 1 failed(`IdempotencyKeyReusedError`) | 지문 = 키 정렬·문자열 trim·SHA-256 | `6511f4a` |
| U45 | 도메인 오류 5종에 지정한 `code`가 응답 `error.code`로 나감 | 5 failed, `Received: "DomainConflictError"` 등 클래스 이름 | 필터 `codeOf()` = `code ?? name` | `f94d014` |
| U46 | `code` 없는 도메인 오류는 클래스 이름 | 첫 실행 통과 → 뮤턴트(코드 없으면 'UNKNOWN') `Received: "UNKNOWN"` 1 failed | 구현 변경 없음 | `ae4de58` |
| U47 | 고객 역할의 점주·운영자 전용 기능 호출은 `RefundForbiddenError` | 1 failed, `Received function did not throw` | OWNER·MANAGER가 아니면 거절 | `3b02ebc` |
| U48 | 점주의 소유 매장 밖 범위 조회는 `ShopNotFoundError`(404) | 1 failed, `Received promise resolved instead of rejected` | MANAGER 통과, 그 외는 `isCurrentShopOwner` 확인 | `963b8b4` |
| U49 | 점주 관계 해제 후 같은 매장 조회는 404 | 첫 실행 통과 → 뮤턴트(점주 확인 결과 캐시) 1 failed | 구현 변경 없음 | `4ef9acc` |
| U50 | (현재 동작 기록) PG 거래조회는 지금 항상 NOT_FOUND | 첫 실행 통과(현재 동작) → 뮤턴트(IN_PROGRESS 반환) 1 failed | 구현 변경 없음, 상태 BASELINE | `33c31b8` |

- **순서 변경**: U41과 U42는 U12·U13과 같은 이유로 거절 쪽(U42)을 먼저 했다.
- **U45 테스트 범위**: 처음에는 충돌 오류 1종으로 테스트를 썼다. 구현하기 전에 도메인 오류 5종 전부로 넓혔다(T014 "필터는 `error.code ?? error.name`"이 모든 도메인 오류에 적용되기 때문).
- **판단한 것**:
  - 멱등 키 형식 오류(129자 이상, 공백, 비ASCII, 빈 키)는 계약 §10에 전용 코드가 없다. 그래서 "DTO 형식 오류 → 400 `BadRequestException`" 행을 적용했다.
  - 오류 클래스의 `code`는 계약 §10 코드다(`IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_REQUEST_IN_PROGRESS`, `REFUND_FORBIDDEN`, `SHOP_NOT_FOUND`).
- **남은 위험**:
  - 멱등 서비스는 처리 중 기록 생성에 실패한 직후 기록을 다시 찾는다. 그 사이에 최초 요청이 실패해 기록이 지워지면 `find`가 null을 돌려준다. 현재 코드는 이 경우를 처리하지 않는다(`existing!`). 다시 시도할지 오류로 돌려줄지 정해야 한다.
  - Prisma 저장소(`RefundIdempotencyRepository`의 P2002 처리, `RefundRepository.isCurrentShopOwner`)는 단위 테스트가 없다. 고유 제약 자체는 U34에서 확인했다.
- 기존 eslint 오류: `http-exception.filter.ts` 8건은 이번 변경 전 HEAD에도 있다.

## 사이클 76~93: Phase 2 PG 계약·잠금 순서 (U51~U61, U284~U289)와 T018

**PG 계약 설계(사용자 결정 2026-10-28, "전송 계층 분리 + 가상 응답 형식")**
- `src/pg/pg-cancel.client.ts`의 `PgCancelClient`(주입 토큰 `PG_CANCEL_CLIENT`)는 PG 원래 응답(HTTP 상태·본문)만 돌려준다.
- `PgService.sendCancel` / `inquireCancel`이 원래 응답을 계약 §8 결과(`pg.types.ts`의 `PgCancelSendResult`·`PgCancelQueryResult`)로 분류하고, 응답 제한 시간(`refund.pgTimeoutSeconds`)을 적용한다.
- 원래 응답 본문 형식(`status`·`authoritative`·`pgTransactionId`·`cancelledAmount`·`reason`)은 실제 PG가 없어 정한 **가상 형식**이다. 이 점을 코드 주석에 적었다.
- 기본 전송 계층은 `UnconfiguredPgCancelClient`다. 그래서 송신은 NOT_SENT, 조회는 QUERY_ERROR가 된다.
- 기존 `inquiryPaymentCancel`(항상 NOT_FOUND, U50 기록)은 기존 환불 흐름이 아직 쓰므로 그대로 두었다. 새 환불 흐름으로 바꿀 때 제거한다.

**추가 동작**
- U284~U289: 계약 §8의 정상 분류(조회 SUCCEEDED·FAILED·IN_PROGRESS, 송신 ACCEPTED·SUCCEEDED·REJECTED)가 테스트 목록에 없었다. U55("성공 응답에 실제 취소액이 없으면 QUERY_ERROR")를 의미 있게 검증하려면 정상 성공 분류가 먼저 있어야 하므로 추가했다.

| 동작 | 테스트(`src/pg/pg.service.spec.ts`, 조회는 `PG 취소 조회 결과 분류`, 송신은 `PG 취소 송신 결과 분류`) | red | green | 커밋 |
|---|---|---|---|---|
| U52 | authoritative=true 미접수만 NOT_FOUND | `Rejected to value: [Error: 미구현]`(의도적 미구현 신호) | 상수 반환(fake it). 구조: 전송 계층·ConfigService 주입, U50 테스트 생성자 인자 갱신 | `7f6c73e` |
| U51 | 일반 HTTP 404는 QUERY_ERROR | 1 failed(NOT_FOUND 반환) | 전송 계층 호출, 200·NOT_FOUND·authoritative만 NOT_FOUND | `2e6f3d5` |
| U284 | 성공 응답(거래 ID·실제액)은 SUCCEEDED | 1 failed(QUERY_ERROR) | SUCCEEDED 분기 | `406ef3b` |
| U55 | 실제 취소액 없는 성공 응답은 QUERY_ERROR | 1 failed(SUCCEEDED·cancelledAmount undefined) | 실제액·거래 ID 타입 검사(거래 ID 누락은 별도 테스트 없음) | `e4b9d88` |
| U285 | 실패 확정 응답은 FAILED{reason} | 1 failed(QUERY_ERROR) | 200·FAILED 분기 | `3bef386` |
| U286 | 처리 중 응답은 IN_PROGRESS | 1 failed(QUERY_ERROR) | 200·IN_PROGRESS 분기 | `e255ace` |
| U54 | PG 인증 오류(401, 본문 FAILED)는 QUERY_ERROR | 첫 실행 통과 → 뮤턴트(FAILED 분기의 HTTP 200 조건 제거) 1 failed | 구현 변경 없음 | `be5bc42` |
| U53 | 조회 응답 제한 시간 초과는 QUERY_ERROR | `Exceeded timeout of 5000 ms`(fake timers, 응답 없는 대역) | `withinPgTimeout`(Promise.race·AbortController) | `686eaae` |
| U57 | PG 미연동 조회는 QUERY_ERROR | `Received promise rejected instead of resolved` | `configured=false`면 QUERY_ERROR | `8a67346` |
| U56 | PG 미연동 송신은 NOT_SENT | `[Error: 미구현]` | `configured=false`면 NOT_SENT | `4977546` |
| U287 | 접수 응답은 ACCEPTED | 미구현 reject | ACCEPTED 분기, 판단 불가 응답은 UNKNOWN | `9efb42e` |
| U288 | 즉시 성공은 SUCCEEDED | 1 failed(UNKNOWN) | SUCCEEDED 분기(필수 값 없으면 UNKNOWN) | `31a2fcf` |
| U289 | 거절은 REJECTED{reason} | 1 failed(UNKNOWN) | 200·REJECTED 분기 | `bc4b8eb` |
| U58 | 송신 응답 제한 시간 초과는 UNKNOWN | `Exceeded timeout of 5000 ms` | 송신도 `withinPgTimeout` | `5ecd9e4` |
| U59 | 환불 확정 잠금 Payment → Ticket → TicketPause → UsageSession → SeatAssignment | `- Expected - 7 / + Received + 1`(잠금 없음) | 행별 `SELECT id FROM "<table>" WHERE id = $1 FOR UPDATE` | `b896f64` |
| U60 | 같은 종류 행은 ID 오름차순 | `- Expected - 1 / + Received + 1`(입력 순서) | `[...ids].sort()` | `8f70596` |
| U61 | 지급 경로 Refund → PaymentCancel → ManualRefundPayout | `- Expected - 5 / + Received + 1` | `lockForPayout` | `e79c6fe` |

- **잠금 테스트 방식**: 트랜잭션 대역이 실행된 `$queryRaw`의 테이블과 ID를 순서대로 기록한다. 잠금 순서 자체가 지켜야 할 동작이라 상호작용 기반 테스트로 했다. 대역은 SQL 문자열만 보기 때문에, 테이블 이름이 `@@map`과 같은지와 SQL이 PostgreSQL에서 실행되는지를 `psql`로 따로 확인했다.
- **T017 범위**: `session-lifecycle.repository.ts`의 잠금은 아직 만들지 않았다. 세션 종료 흐름은 환불 확정(US1)에서 이 공유 순서를 쓰도록 연결한다.
- **각 green 뒤 전체 실행**: 단위 272 → 288 passed, E2E 57 passed.
  - U52 첫 실행에서는 ticket-pause E2E가 2건 실패했다(404·401, 로그 보존). 재실행 2회는 57 passed였다.

**T018 모듈 연결(동작 표식 없음)**
- `REFUND_PG_GATEWAY` 토큰(`src/pg/refund-pg.gateway.ts`, 기본 `useExisting: PgService`)을 환불 PG 취소 교체 지점으로 두었다. E2E는 이 토큰만 대역으로 바꾸므로 결제 승인용 `PgService`는 그대로다.
- `RefundModule`에 공통 Provider 4개를 등록했다: `RefundIdempotencyRepository`, `RefundIdempotencyService`, `RefundAccessService`, `RefundLockingRepository`.
- T003 PG 대역이 운영 타입과 `RefundPgGateway`를 쓰도록 맞췄다.
- `test/refund-bootstrap.e2e-spec.ts` 2개가 통과했다. 뮤턴트(`RefundLockingRepository` 등록 제거)에서는 `Nest could not find RefundLockingRepository`로 실패하는 것을 확인했다.
- 전체 결과: 단위 288 passed, E2E 59 passed (`7404e54`).
- tasks.md 완료 표시: T016·T017·T018에 표시했다. T015는 현재 동작 기록인 U50(BASELINE)을 포함하므로 실행 규칙("BASELINE 동작이 있는 작업은 완료 표시하지 않음")에 따라 열어 두었다. T015의 나머지 동작(U51~U58)은 모두 DONE이다.

## Phase 2 Codex 검수 1차 (2026-10-28)

- 범위: `da0a90f..2128308`, T006~T018
- 판정: **수정 필요**. 확정된 업무 결정을 바꾸는 지적은 없고, 기존 계약을 지키기 위한 구현 결함 5건이다.
  - R1 [P1]: 전송 계층이 거부·throw하면 `sendCancel`·`inquireCancel`이 예외를 그대로 낸다. 중단 신호에 반응하는 전송 계층은 시간 초과 대신 AbortError가 난다.
  - R2 [P2]: 송신 ACCEPTED·SUCCEEDED 분기가 HTTP 상태를 보지 않는다. 401 본문의 SUCCEEDED가 지급 확정 근거가 된다.
  - R3 [P2]: 멱등 기록 생성이 실패한 뒤 `find`가 null이면 TypeError가 난다(최초 요청 거절로 기록이 삭제되는 정상 경로).
  - R4 [P1]: 처리(환불 확정)와 최초 응답 저장이 별도 커밋이다. 그 사이에 실패하면 기록이 영구 IN_PROGRESS로 남는다. 단순 삭제나 TTL 뒤 재실행은 중복 PG 재시도를 만들 수 있어 해결책으로 인정하지 않는다.
  - R5 [P2]: 0원 환불 원장(환불 연결, 두 지급 ID 모두 null)의 amount=0 제약이 없다. T010·data-model §8이 명시한 조건이다.
- 추가 의견:
  - U274~U289 추가 근거, NULLS NOT DISTINCT 대체, 선택 FK RESTRICT, `REFUND_PG_GATEWAY` 분리, 키 형식 오류 400은 타당하다.
  - `failedAt` `@updatedAt`은 새 담당·조회 갱신을 연결하기 전에 고쳐야 한다(잘못 기록된 기존 시각은 추정 복원하지 않음).
  - `closedAt`은 `resumedAt: null` 조회들에서 제외되도록 US1 연결 전에 추적한다.
- 설계 쟁점: PAYMENT 대상 Refund는 `orderItemId`가 null인데, `PaymentCancel.orderItemId`는 여전히 필수다. 결제 전체 취소를 어떤 데이터 연결로 표현할지 US6 전에 확인해야 한다. 임의 주문 상품 선택이나 가짜 상품으로 메우지 않는다.
- 기타: T015 BASELINE과 session-lifecycle 후속 연결은 완료한 기반과 구분해 기록한다. 공유 DB 검증은 단독 실행 조건에서 한다. red 상태 커밋은 이탈 기록으로 유지한다.

### 사용자 결정 (2026-10-28)

- R4: **같은 트랜잭션에서 완료**. 처리 중 기록은 먼저 커밋해 동시 요청에 409 IN_PROGRESS를 유지한다. 처리(handler)는 트랜잭션 클라이언트를 받아 업무 데이터를 쓰고, 같은 트랜잭션에서 최초 응답·refundId로 기록을 완료한다. 커밋 전 중단에 대비해 처리 기한(claimUntil)을 두고, 기한이 지난 기록은 같은 본문의 다음 요청이 이어받는다.
- VS Code Jest 확장의 `--watch` 실행은 사용자가 직접 끈다.

## 사이클 94~104: Phase 2 검수 1차 수정 (U290~U299)

| 동작 | 테스트 | red | green | 커밋 |
|---|---|---|---|---|
| U290 (R1) | `pg.service.spec.ts` 송신 중 전송 계층 예외(비동기 거부·동기 throw)는 UNKNOWN | 2 failed, `Received promise rejected instead of resolved` | `sendCancel`이 예외를 UNKNOWN으로 분류 | `902d5f5` |
| U291 (R1) | 조회 중 전송 계층 예외는 QUERY_ERROR | 2 failed, 위와 같음 | `inquireCancel`이 예외를 QUERY_ERROR로 분류 | `c02065d` |
| U292 (R1) | 중단에 반응하는 전송 계층의 송신 시간 초과는 시간 초과 사유의 UNKNOWN | 1 failed, `reason` 기대 'PG 송신 응답 시간 초과' / 실제 'PG 송신 오류: aborted' | 시간 초과를 먼저 확정(resolve)한 뒤 abort | `e3cb998` |
| U293 (R1) | 같은 조건의 조회 시간 초과는 QUERY_ERROR | 첫 실행 통과(U292 수정이 공용 함수에 적용됨) → 뮤턴트(abort를 먼저) 1 failed | 구현 변경 없음 | `4bbdbd6` |
| U294 (R2) | 비정상 HTTP(401) 송신 응답은 본문이 ACCEPTED·SUCCEEDED여도 UNKNOWN | 2 failed, `- Expected - 1 / + Received + 1` | 2xx가 아니면 먼저 UNKNOWN. REJECTED의 `=== 200` 조건은 이 공통 2xx 검사로 대체 | `f52cd21` |
| U295 (R3) | 기록 생성 실패 후 기록이 사라졌으면 다시 만들어 처리 | `TypeError: Cannot read properties of null (reading 'requestFingerprint')` | 최대 3회 생성·조회 반복, 있으면 replay(권한·지문·처리 중 검사 유지) | `2e34c39` |
| U296 (R5) | 환불 연결·두 지급 ID null 원장의 금액이 0이 아니면 저장 실패 | 1 failed, `Received promise resolved instead of rejected` | `ledger_zero_payout_amount_check`(refund_id가 null인 매출 원장 제외). 0원 허용은 U31이 확인 | `b5a5967` |
| U297 | 실패가 아닌 갱신은 `failedAt`을 바꾸지 않음 | 1 failed, `Received: 2026-10-27T19:13:02.105Z` | `failedAt`의 `@updatedAt` 제거(클라이언트 동작만 바뀌어 DB 변경 없음). 기존 저장소는 생성 null·실패 now를 직접 넣으므로 동작 유지 | `c2c9cb7` |
| U298 (R4) | 최초 응답 저장이 실패하면 같은 트랜잭션의 환불 확정도 커밋되지 않고, 같은 키 다음 요청이 처리됨 | `Cannot read properties of undefined (reading 'writes')`(처리가 트랜잭션을 받지 않음) | `runInTransaction` 안에서 `handler(tx)`·`completeInTransaction`, 실패 시 기록 삭제. 키 없는 요청도 트랜잭션 안에서 처리 | `7c13613` |
| U299 (R4) | 처리 기한이 지난 처리 중 기록은 같은 본문의 다음 요청이 이어받음 | `IdempotencyRequestInProgressError` | `claim_until` 열 마이그레이션, 생성 시 기한(`refund.workLeaseSeconds`), 기한 지난 같은 본문 기록은 권한 확인 후 조건부 갱신(`takeOver`) | `f060a7f` |

- U300("성공하면 최초 응답과 환불이 같은 트랜잭션에서 기록")은 U298 테스트가 같은 내용을 확인하므로 DROPPED로 표시했다. U298은 응답 저장이 실패하면 환불도 커밋되지 않고, 성공하면 둘 다 커밋됨을 함께 검증한다.
- 각 green 뒤 전체 실행: 단위 290 → 301 passed, E2E 59 passed. E2E 간헐 실패가 U291·U296 첫 실행에서 각 1~2건 있었고, 재실행하면 통과했다(로그 보존).
- 남은 쟁점(코드 미반영):
  - PAYMENT 대상 환불의 `PaymentCancel.orderItemId` 표현(US6 전 확인)
  - `closedAt` 정지 기록을 `resumedAt: null` 조회에서 제외(US1 전 추적)
  - session-lifecycle 잠금 연결(US1)
  - T015는 U50 BASELINE이라 열린 상태다. BASELINE과 실제 동시성 경합은 최종 동작 검증으로 보지 않는다.
  - Prisma 저장소의 `takeOver`·`completeInTransaction`·`runInTransaction`은 단위 테스트가 메모리 대역을 쓰므로 실제 DB 동작은 이 단계에서 검증하지 않았다. 환불 확정 E2E(US1)에서 확인한다.

## Phase 2 Codex 재검수 1차 (2026-10-28)

- 범위: `2128308..17e1815`
- 판정: **수정 필요**. R1·R2·R3·R5와 `failedAt` 수정은 타당하다. 차단 결함은 1건이다.
  - [P1] 인계 후에도 이전 요청의 완료·삭제가 허용된다. `takeOver`는 이어받는 요청끼리의 경쟁만 막는다. `completeInTransaction`은 id만으로 갱신하고 `remove`도 id만으로 삭제한다.
  - Codex 재현: A가 처리 중 지연 → 기한 경과 → B가 이어받아 COMPLETED 저장 → A가 늦게 실패하면 `remove(id)`가 B의 완료 기록을 삭제 → 같은 키 C가 처리를 다시 실행한다. A가 늦게 성공하면 B의 최초 응답을 덮어쓰는 경로도 열려 있다.
  - 기한 경과를 이전 작업 종료의 증거로 쓰면 안 된다. 완료와 실패 정리도 현재 담당임을 확인해야 하고, 실제 저장소의 경합 검증을 US1로 모두 미루지 말아야 한다.
- 추가 지적: U298 red(`Cannot read properties of undefined (reading 'writes')`)는 tx 인자가 없어 생긴 준비 오류다. 이것만으로는 "응답 저장 실패 시 업무도 롤백"의 증거가 되지 않는다. 기존 기록은 보존하고, 잘못된 별도 커밋 구현을 테스트가 잡는지 보충 검증해 덧붙인다.

## 보충 검증: U298 (2026-10-28, 사후 확인)

- 위 사이클 표의 U298 red 기록은 당시 그대로 둔다. 그 red는 처리가 트랜잭션 인자를 받지 않아 생긴 준비 오류였고, 응답 저장 실패 시 롤백을 직접 보여 주는 증거는 아니었다.
- 사후 보충으로 뮤턴트를 적용했다. 처리(handler)와 응답 저장을 각각 별도 트랜잭션으로 커밋하도록 서비스를 바꾸고 U298 테스트를 실행했다.
  - 결과: `- Expected - 1 / + Received + 3`로 1 failed. 응답 저장이 실패해도 환불 쓰기가 커밋된 것이 드러났다.
  - 원복 후 1 passed, `git diff` 변경 없음을 확인했다.
- 따라서 U298 테스트는 별도 커밋 구현을 잡는다. 다만 이 보충은 당시의 red 증거가 아니라 사후 확인이다.

## 사이클 105~108: 재검수 1차 수정 — 멱등 기록 담당 토큰 (U301~U304)

설계(사용자 결정 "같은 트랜잭션에서 완료"는 유지):
- 실행마다 담당 토큰(`randomUUID`)을 발급하고 `refund_idempotency_records.claim_token`에 저장한다.
- 처리 트랜잭션을 시작하자마자 `acquireInTransaction`(`SELECT ... FOR UPDATE`, 처리 중이고 토큰이 같을 때만)으로 기록 행을 잡는다. 이 잠금은 트랜잭션 끝까지 유지되므로, 살아서 처리 중인 요청의 기록은 기한이 지나도 다른 요청의 이어받기(`updateMany`)가 잠금을 기다린 뒤 조건 불일치로 실패한다.
- `completeInTransaction`(트랜잭션 안 조건부 갱신, 실패 시 오류로 롤백)과 `remove`(조건부 삭제)는 같은 토큰일 때만 반영된다. 담당을 잃은 요청은 `IdempotencyRequestInProgressError`로 처리 전체가 롤백되고, 새 담당의 기록을 지우거나 덮어쓰지 못한다.

| 동작 | 테스트 | red | green | 커밋 |
|---|---|---|---|---|
| U301 | `refund-idempotency.service.spec.ts` 트랜잭션 전에 멈췄던 A를 B가 이어받아 성공 → A의 처리는 커밋되지 않고 B 응답 보존, C는 B 응답 재생 | 1 failed, `담당이 아닌 완료`(서비스가 담당 토큰을 쓰지 않음) | 담당 토큰 열 마이그레이션, 토큰 조건부 acquire·complete·remove, takeOver가 새 토큰 지정 | `d1e1962` |
| U302 | 처리 트랜잭션 안에서 처리 중인 기록은 기한이 지나도 이어받지 못함 | 첫 실행 통과(U301 설계가 보장) → 뮤턴트(acquire 생략) 1 failed | 구현 변경 없음 | `7d590a8` |
| U303 | 기한 지난 같은 기록을 두 요청이 동시에 이어받으면 하나만 처리 | 첫 실행 통과 → 단일 뮤턴트(대역의 이어받기 기한 조건 제거 / 서비스의 이어받기 결과 무시)는 통과, 두 장치를 함께 제거하면 `Expected: 1 / Received: 2` 1 failed | 구현 변경 없음 | `faae5bd` |
| U304 | `refund-idempotency.repository.integration.spec.ts`(실제 DB) 다른 토큰의 완료 실패·기록 유지 / 다른 토큰의 정리 무효 / 동시 이어받기 하나만 성공 / 잡힌 기록의 이어받기는 트랜잭션 종료까지 대기 후 실패 | 첫 실행 4 passed → 뮤턴트 4종(완료 토큰 조건, 정리 토큰 조건, 이어받기 기한 조건, `FOR UPDATE` 각각 제거) 각 1 failed | 구현 변경 없음 | `3d4bbe3` |

- U303 단일 뮤턴트가 살아남은 이유: "하나만 처리"를 두 장치가 각각 독립적으로 보장한다(이어받기의 조건부 갱신, 처리 트랜잭션 시작 시 담당 토큰 확인). 두 장치를 모두 제거했을 때만 실패한다.
- **테스트 대역 정정**: 메모리 대역의 `find`가 원본 객체를 돌려줘, 다른 요청의 갱신이 이미 읽은 값에 반영됐다. 실제 DB처럼 사본을 돌려주도록 고쳤다.
- **이탈: U299 테스트 정정을 별도 단계로 분리하지 못함**: U299는 "처리 트랜잭션 안에서 영원히 대기하는 A"를 멈춘 요청으로 가정했다. 그런 요청은 살아 있는 요청이라 이어받으면 안 되며(U302), 서버가 실제로 멈추면 트랜잭션이 롤백되어 잠금이 풀린다. 그래서 "처리 트랜잭션을 시작하기 전에 멈춘 A"로 설정을 정정했다. 정정 이유는 맞지만, 구현 변경(`d1e1962`)과 같은 커밋에 들어가 플레이북의 "테스트 정정은 구현보다 먼저 별도 단계로"를 지키지 못했다.
- 전체 결과: 단위 302 → 308 passed, E2E 59 passed. VS Code Jest `--watch`를 끈 뒤 단독 실행했고, 이 구간에는 간헐 실패가 없었다.
