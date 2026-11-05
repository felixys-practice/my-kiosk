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

## Phase 2 Codex 재검수 2차 (2026-10-28)

- 범위: `17e1815..32bd915`
- 판정: **통과**. 재검수 1차 P1(인계 후 이전 담당의 완료·삭제 허용)은 해결됐고, 이번 수정 범위에서 추가 차단 결함은 없다.
- Codex가 확인한 것:
  - 처리 트랜잭션 시작 시 `acquireInTransaction`으로 현재 담당 토큰과 IN_PROGRESS를 확인하고 행을 잠근 뒤 handler를 실행한다. 인계된 뒤 재개한 이전 요청은 handler 실행 전에 거절된다.
  - `completeInTransaction`·`remove`는 담당·상태 조건으로 새 담당과 COMPLETED 기록을 보호한다.
  - 처리 트랜잭션이 살아 있는 기록은 takeOver가 행 잠금을 기다린 뒤 상태 재검사로 실패한다. 이는 실제 DB 테스트로 확인했다.
- Codex 직접 실행: 관련 6개 파일 `--runInBand`, 55 tests passed(실제 DB 저장소 테스트 4개 포함). 전체 단위·E2E·tsc·eslint와 뮤턴트는 다시 실행하지 않았다.
- 기록 검토:
  - U298 사후 뮤턴트 확인은 당시 red와 구분돼 있어 타당하다.
  - U299 설정 정정은 의미상 타당하다. 다만 같은 커밋에 반영한 절차 이탈은 기록대로 유지하며, TDD 절차를 무결하게 지켰다는 판정은 아니다.
- 후속 쟁점(이번 판정 범위 밖, 지정된 단계 전에 해결):
  - PAYMENT 대상 환불의 `PaymentCancel.orderItemId` 설계(US6 전)
  - `closedAt` 정지 기록을 활성 정지에서 제외(US1 전)
  - session-lifecycle 잠금 연결(US1)
  - T015 U50 BASELINE
- 이번 판정은 이 후속 구현까지 완료됐다는 뜻이 아니다.

## Phase 2 완료

- T006~T014, T016~T018 완료 표시. T015는 U50 BASELINE 때문에 열어 둔다. Codex 재검수 2차 통과. 다음은 Phase 3(US1, T019~T034·T179)이다.

## Phase 3: 사용자 스토리 1 — 고객 환불 판정과 이용 종료 확정 (2026-10-28)

### 바깥 루프

- A1(`test/refund-customer.e2e-spec.ts` QS-1-1)을 먼저 작성했다.
  - red: `expected 202 "Accepted", got 400 "Bad Request"`. 기존 `POST /refund`가 동의 필드를 허용하지 않는 필드로 거부했다.
  - 단위 루프 동안 이 파일은 스크래치 패드에 보관했다(skip 미사용). 전체 테스트가 바깥 루프의 red로 막히지 않게 하려는 조치다. T033 연결 뒤 되돌려 같은 테스트가 통과했다.
- A2~A10은 안쪽 루프를 마친 뒤 작성해 첫 실행에서 통과했다(바깥 루프 순서 이탈). 대신 뮤턴트로 각 테스트가 동작을 잡는지 확인했다.
  - 뮤턴트 1(종료 동의 검사 제거): A2가 실패했다.
  - 뮤턴트 2(이용권이 있으면 판정 거절을 무시): A3~A10 8개가 실패했다.

### 안쪽 루프

| 동작 | 테스트 | red | green | 커밋 |
|---|---|---|---|---|
| U62 | `refund-policy.spec.ts` 본인 범위 밖 → TICKET_NOT_FOUND | `- Expected - 2 / + Received + 2` | 후보 없음·소유자 불일치 | `158c785` |
| U63 | 결제 SUCCESS 아님 → PAYMENT_NOT_COMPLETED | 같음 | 결제 상태 검사 | `7fc5e66` |
| U65 | PAID 환불 → ALREADY_REFUNDED | 같음 | ACCEPTED·PAID 검사 | `18af95b` |
| U66 | 미지급 확정 환불(PENDING·ACTION_REQUIRED) → REFUND_IN_PROGRESS | 2 failed | 남은 ACCEPTED 검사 | `8e6168b` |
| U68 | 이용 중 → USED_TICKET | 1 failed | inUse 검사 | `e271ca6` |
| U70 / U69 | 활성화된 정기권 USED / 활성화 전 미사용 | U70 1 failed / U69 첫 통과 → 뮤턴트(isUnused 항상 false) 1 failed | `isUnused` 정기권 분기 | `4d76b3c` / `1d7ff16` |
| U72 / U71 | 시간권 잔여 < 구매 USED / 잔여 = 구매 미사용 | U72 1 failed / U71 첫 통과 → 뮤턴트(=== → >) 1 failed | 시간권 분기 | `b87b3b5` / `b5bd5bf` |
| U64·U67 | 결제 미완료·미지급 확정 환불이 사용 이력보다 먼저 | 첫 통과 → 뮤턴트(사용 검사를 결제 검사 앞으로) 2 failed | 구현 변경 없음 | `aa566f4` |
| U75 / U74 | 정기권 활성화 기한 +1ms 초과 / 같은 시각 허용 | U75 1 failed / U74 첫 통과 → 뮤턴트(> → >=) 1 failed | `unusedDeadlineOf` | `70fe316` / `69604b1` |
| U77 / U76 | 시간권 소진 기한 +1ms 초과 / 같은 시각 허용 | U77 1 failed / U76 첫 통과 → 뮤턴트(> → >=) 1 failed | 시간권 기한 분기 | `4049eef` / `8f542b7` |
| U73 | 사용 이력이 기한 초과보다 먼저 | 첫 통과 → 뮤턴트(기한 검사를 앞으로) 1 failed | 구현 변경 없음 | `e16b6bd` |
| U78 | 위반 사유 목록 + CONTACT_SHOP | `- Expected - 5 / + Received + 0` | 위반 수집, 대표는 첫 위반 | `2d35911` |
| U79 | 금액 = 실결제액 전액 | 1 failed(0) | `amount = paidAmount` | `63ee5ed` |
| U86 | DTO 동의 "true" 문자열 → isBoolean | `Expected isBoolean / Received whitelistValidation` | `@IsOptional @IsBoolean` | `a1ec290` |
| U80~U83 | DTO UUID·미허용 필드(amount·userId·shopId) | 첫 통과 → 뮤턴트(IsUUID 제거 + 세 필드 허용) 4 failed | 구현 변경 없음 | `b2a6c59` |
| U84 / U85 | 동의 false / 누락 → REFUND_TERMINATION_CONSENT_REQUIRED(판정 뒤) | U84 `Received constructor: Error`(미구현 신호) / U85 첫 통과 → 뮤턴트(=== false만) 1 failed | 판정 통과 뒤 동의 확인 | `e6bbd28` / `7d83343` |
| U305(추가) | 판정 거절 → 계약 코드 오류(404 1종, 409 5종), 저장 없음 | 6 failed(미구현 Error) | `rejectionError` | `468b88a` |
| U306(추가) | 필터가 도메인 오류 details를 응답에 포함 | `Received: undefined` | `detailsOf` | `1a377bd` |
| U91 | (실제 DB) Refund ACCEPTED + 시도 1 REQUESTED | `TicketNotFoundError`(대상 조회 미구현) | `findCustomerRefundTarget`·`createAcceptedRefund`·202 본문 | `ff0dbfc` |
| U87 | (실제 DB) 이용권 REVOKED | `Expected REVOKED / Received UNUSED` | `terminateTicket`(상태·revokedAt만) | `1375d7e` |
| U88 | (실제 DB) 고정석 배정 해제 | 1 failed | `releaseByTicket(TICKET_REVOKED)` | `e569a6c` |
| U89 | (실제 DB) 열린 정지 REFUND_TERMINATED로 닫힘, resumedAt null | 1 failed | `closeOpenPausesForRefund` | `ce93f8a` |
| U90 | (실제 DB) 기한·만료 시각 불변 | 첫 통과 → 뮤턴트(종료 때 expiresAt +30일) 1 failed | 구현 변경 없음 | `eac0335` |
| U92 | (실제 DB) 마지막 저장 실패 시 이용권·좌석·정지·환불·시도 모두 롤백, PG 미호출 | 첫 통과 → 뮤턴트(terminateTicket을 트랜잭션 밖 저장) 1 failed | 구현 변경 없음 | `bf136a8` |
| U93 | PG 전송은 커밋 뒤에만, 확정 금액으로 | `- Expected - 1 / + Received + 0`(호출 없음) | 이번 요청이 확정한 경우에만 커밋 뒤 `sendCancel` | `3b203c3` |
| U94 | 커밋 실패 시 PG 미호출 | 첫 통과 → 뮤턴트(커밋 전 전송) 1 failed | 구현 변경 없음 | `e438436` |
| U95 | (실제 DB) 동시 신청 두 건 중 한 건만, 다른 건 REFUND_IN_PROGRESS | `P2002 Unique constraint(order_item_id)` | `findLockedTarget`(조회 → 공유 순서 잠금 → 재조회), 5회 반복 통과 | `bb6434d` |
| U96 | (실제 DB) NOT_SENT여도 접수 성공·REVOKED 유지 | 첫 통과 → 뮤턴트(NOT_SENT면 UNUSED 복구) 1 failed | 구현 변경 없음 | `acab3f9` |
| U97 | 접수 응답 202·refundId·종료 시각·PENDING | 첫 통과 → 뮤턴트(200) 1 failed | 구현 변경 없음 | `3c0787a` |
| T033 / A1~A10 | `POST /refund` 연결, 인수 테스트 | 위 바깥 루프 참조 | 컨트롤러 → `RefundAcceptanceService`, DB 멱등 키 | `edd5079` |

### 사용자 결정과 이탈

- **기존 경로 유지(사용자 결정)**: 기존 `RefundService.refund()`와 승인 대기 코드는 Phase 13(RefundLock 흐름 제거)까지 남긴다. 외부에서 호출되지 않는다. T033의 "승인 대기 분기 제거"는 Phase 13으로 미룬다.
- **기존 테스트 수정(사용자 결정)**: 좌석 타입 E2E QS-21을 새 계약(동의 필수, 202, 확정 즉시 좌석 해제, 콜백 단계 제거)으로 바꿨다. 검증하는 결과(배정 RELEASED·TICKET_REVOKED, 좌석 선택 가능)는 그대로다. 새 Refund 행 때문에 seat-type afterAll이 FK 삭제 제한(`refunds_payment_id_fkey`)으로 실패해 정리 순서에 Refund·멱등 기록 삭제를 추가했다.
- **U84·U85의 담당 위치**: 동의 false·누락 거절은 DTO가 아니라 확정 서비스에서 한다. 계약 §4 확인 순서(대상 판정 → 종료 동의)를 지키기 위해서다. DTO는 boolean 형식만 검사한다(U86).
- **PG 전송 결과 저장은 US5로**: NOT_SENT·REJECTED를 FAILED·ACTION_REQUIRED로 저장하는 일은 T096(US5) 범위다. US1은 커밋 뒤 전송만 하고 결과로 이용권을 되돌리지 않는다(U96). 따라서 계약의 "전송 전 실패도 202에 ACTION_REQUIRED로 응답"은 아직 구현되지 않았다. 현재 응답은 확정 시점의 PENDING이다.
- **멱등 재생 응답**: 최초 응답은 확정 트랜잭션에서 저장한 접수 응답(PENDING)이다. PG 결과로 바뀐 최신 상태는 GET에서 확인한다는 계약을 따른다.
- **역할 검사**: `POST /refund`에 역할 데코레이터를 붙이지 않았다. 다른 고객·점주의 요청은 본인 이용권 범위 검사에서 TICKET_NOT_FOUND가 된다. 계약 §2의 "USER·본인 이용권" 범위와 결과는 같지만, 점주·운영자가 자기 이용권을 신청하는 경우의 역할 거절은 따로 검증하지 않았다.
- **E2E 간헐 실패**: VS Code Jest 감시를 끈 뒤에도 seat-type·ticket-pause에서 401·403·404·426 실패가 이어졌고, 재실행하면 통과했다. "IDE 동시 실행"만으로는 설명되지 않는다. 원인은 미확정이다.
- 결과: 단위 352 passed, E2E 69 passed(`edd5079`).

## Phase 3 Codex 검수 1차 (2026-10-28)

- 범위: `335951f..992ec0c`, T019~T034·T179
- 판정: **수정 필요**. 구현 결함 3건(모두 P2)이다.
  1. 고객 환불의 역할 제한과 멱등 재응답의 권한 확인이 없다. OWNER·MANAGER가 자기 이용권을 신청하면 확정과 PG 호출이 진행된다. 계약 §2(USER·본인 이용권)에 따라 403 `REFUND_FORBIDDEN`이어야 한다. 기존 RoleGuard는 401이므로 그대로 쓰면 안 된다.
  2. 실결제액 0원 고객 환불도 PG 취소 요청을 만들고 0원을 전송한다. PG 요청 없이 이용 종료·좌석 해제·PAID·0원 원장을 함께 저장해야 한다.
  3. 닫힌 정지가 주문 조회(`order.repository.ts`)와 이용권 조회(`ticket.repository.ts`)에서 `resumedAt: null`만 보기 때문에 계속 활성 정지로 표시된다(REVOKED·isPaused:true 재현).
- 타당하다고 본 것: 사용자 결정에 따른 기존 경로 유지, QS-21 변경, 서비스의 동의 검사 순서, U305·U306 추가.
- 추가 의견:
  - PG 결과 저장은 후속 미완료로 구분한다. US4·US5 연결 때 실제 최초 응답과 멱등 기록의 응답이 일치하는지 검증한다.
  - session-lifecycle은 US2·US3의 경쟁 처리 검증으로 추적하고, 이번 판정을 동시성 검증 완료로 보지 않는다.
  - A2~A10의 사후 작성은 TDD 절차 이탈이며, 뮤턴트 검증은 보충 근거다.
- Codex는 Herdr 환경 확인(HERDR_ENV) 실패로 Claude 패널에 결과를 보내지 못했다. 결과는 Codex 패널에서 직접 읽었다.

## 사이클: Phase 3 검수 1차 수정 (U307~U311)

| 동작 | 테스트 | red | green | 커밋 |
|---|---|---|---|---|
| U307 | `refund-acceptance.service.spec.ts` OWNER·MANAGER의 고객 환불은 저장 없이 REFUND_FORBIDDEN | 2 failed, `Received promise resolved instead of rejected` | 멱등 처리 전에 `assertCustomerRole`(USER가 아니면 403) | `2839197` |
| U308 | 같은 키 재응답도 현재 역할이 USER가 아니면 REFUND_FORBIDDEN | 첫 통과(U307 확인이 재생 요청에도 실행) → 뮤턴트(역할 확인을 최초 처리 안으로만) 1 failed | 구현 변경 없음 | `9995c93` |
| U309 | (실제 DB) 0원 환불은 PG 취소 요청 없이 REVOKED·PAID·paidAt·0원 원장(RELEASABLE, 지급 연결 없음), PG 미호출 | `- Expected - 12 / + Received + 4`(PENDING·시도 1·원장 없음) | `createAcceptedRefund` 0원 분기, 대상에 orderId·shopId 추가, PG 취소 요청이 없으면 전송 안 함 | `5158283` |
| U310 | 0원 응답은 200·PAID·paymentCancelId null | `- Expected - 2 / + Received + 2`(202·PENDING) | PG 취소 요청이 없으면 200·PAID | `76dc9a1` |
| U311 | (E2E) 환불로 닫힌 정지는 주문 조회 isPaused·시간권 상세 pausedAt에 나타나지 않음 | `orderTicketIsPaused` 기대 false / 실제 true | 공용 조건 `activePauseWhere`(resumedAt·closedAt null)를 주문 조회, 이용권 조회 2곳, 좌석 변경, 정지 저장소, 환불 저장소에 적용 | `dd073d0` |

- U311 테스트는 주문 조회와 시간권 상세만 직접 확인한다. 좌석 변경·정지 저장소의 활성 정지 조회는 같은 상수로 바뀌었지만 별도 테스트가 없다. 다만 정지 재개는 REVOKED 이용권을 이미 거절한다(Codex 확인).
- 결과: 단위 357 passed, E2E 70 passed(`dd073d0`). `ticket.repository.ts`의 eslint 6건은 HEAD에도 있는 기존 오류다.

## Phase 3 Codex 재검수 (2026-10-28)

- 범위: `992ec0c..5939798`
- 판정: **통과**. 1차 지적 3건이 해결됐고, 이번 수정 범위에서 추가 차단 결함은 없다.
  - 역할 제한: 멱등 처리 전에 USER 역할을 확인하므로, 최초 요청과 같은 키 재응답이 모두 제한된다.
  - 0원 환불: PG 요청 없이 PAID·지급 완료 시각·0원 원장을 같은 트랜잭션에 저장하고, 200과 `paymentCancelId: null`로 응답한다.
  - 닫힌 정지: 주문·이용권·좌석 변경·정지 저장소의 활성 정지 조회에 `resumedAt: null, closedAt: null` 조건이 적용됐다. 누락된 다른 조회는 찾지 못했다.
- Codex 직접 실행: 단위 테스트 4개 파일 46개 통과. 통합·E2E 테스트 코드는 검토했지만 공유 DB 테스트는 다시 실행하지 않았다.
- 유지할 후속 쟁점:
  - PG 결과와 최초 응답의 일치(US4·US5)
  - 세션 경쟁 처리(US2·US3)
  - PAYMENT 대상 orderItemId(US6 전)
  - T015 U50 BASELINE
  - A2~A10 사후 작성 이탈 기록
- Codex는 이번에도 HERDR_ENV 확인 실패로 Claude 패널에 직접 보내지 못했다. 결과는 Codex 패널에서 읽었다.

## Phase 3 완료

- T019~T034·T179 완료, Codex 재검수 통과. 다음은 Phase 4(US2 점주의 매장 환불, T035~T056·T180)다.

## Phase 6 (US4 실제 지급별 원장) 사이클 (2026-10-28)

- 실행 순서: tasks.md의 권장 구현 순서(기반 → US1 → **US4 공통 결과** → US2·US3)를 따라 Phase 4(US2)보다 먼저 진행했다. US2의 2-2·2-13(PG 결과 반영)이 이 공통 결과 처리를 필요로 하기 때문이다.
- 바깥 루프: A30(QS-4-1)을 먼저 작성해 red를 확인하고(`expected 200 "OK", got 201 "Created"`, 기존 콜백) scratchpad에 보관한 뒤 안쪽 루프를 진행했다.
- 단위 테스트 위치: tasks T068은 `refund-result.service.spec.ts`·`refund-ledger.repository.spec.ts`를 적었다. 하지만 잠금·원자성·unique를 목(mock)으로는 확인할 수 없어서 `src/refund/refund-result.integration.spec.ts`(실제 DB) 한 파일에 모았다.

| 동작 | 테스트 | red | green·검증 | 커밋 |
|---|---|---|---|---|
| U129 | 성공 실제액 = 확정 금액이면 PAID | `paidAmount 0`·PAID 아님(1 failed) | `RefundResultService.applyPgResult`: 조회 → `lockForPayout`(Refund → PaymentCancel) → 재조회, 시도 SUCCEEDED·실제액, paidAmount 합산, PAID·paidAt | `863730e` |
| U130 | 실제액의 음수 원장 1건(원래 매장·주문·RELEASABLE·paymentCancelId) | Expected 원장 1건 / Received `[]` | `RefundLedgerRepository.recordPayout`를 같은 트랜잭션에서 | `89372a3` |
| U131 | 실제액 부족 → ACTION_REQUIRED·reviewRequired·AMOUNT_MISMATCH, 금액 불변 | PAID로 기록됨 | paidAmount === amount면 PAID, 아니면 조치·검토 필요 | `f87d9de` |
| U132 | 실제액 초과도 같은 처리 | 첫 통과 → 뮤턴트(`>=`이면 PAID) 1 failed | 구현 변경 없음 | `1f0d747` |
| U133 | PG 거절 → 시도 FAILED·PG_REJECTED, Refund ACTION_REQUIRED, 원장 없음 | 시도 REQUESTED·actionCode null | `markAttemptFailed`(예정·담당 지움) | `36540ed` |
| U134 | 같은 성공 결과 두 번 → 원장·paidAmount 한 번 | `Unique constraint failed on the fields: (payment_cancel_id)` | 시도가 REQUESTED·QUERY_FAILED일 때만 반영 | `83deb67` |
| U135 | FAILED 시도에 성공 통보 → 검토 필요·PG_RESULT_CONFLICT·운영자 알림, 지급 없음 | actionCode PG_REJECTED·알림 없음 | 확정 상태와 결과 종류가 다르면 모순 기록. `RefundEventRepository`(eventKey `pg-result-conflict:<시도ID>`, skipDuplicates) | `f8bcc5a` |
| U136 | 담당 토큰이 바뀐 작업의 결과 → 저장하지 않고 저장 상태 반환 | 반환값 undefined·지급 반영됨 | `{applied, attemptStatus, payoutStatus}` 반환, 토큰 불일치면 저장 상태 반환 | `24d39ef` |
| U137 | 저장 중단 시 PAID·원장·시도 성공 모두 롤백 | 첫 통과 → 뮤턴트(시도 성공 저장을 트랜잭션 밖 `this.prisma`로) 1 failed | 구현 변경 없음. 중단은 `updateRefundPayout` 스파이로 재현 | `44e881d` |
| U138 | 콜백 대상 PG 취소 요청 없음 → PG_CALLBACK_TARGET_NOT_FOUND(404) | `Received promise resolved instead of rejected` | `applyCallback` → `applyPgResult`가 null이면 오류 | `d377c65` |
| U139 | 콜백 대상이 다른 환불 → PG_CALLBACK_TARGET_MISMATCH(409), 반영 없음 | `Received promise resolved instead of rejected` | 잠근 뒤 Refund.orderItemId와 콜백 orderItemId 대조, 다르면 오류(롤백) | `0b758ce` |
| A30 | (E2E) 성공 콜백 → 그 매장·주문의 실제액 음수 원장 1건 (QS-4-1) | 위 바깥 루프 red | 컨트롤러 연결(아래), `@HttpCode(200)` | `d8a6920` |
| A31~A33 | (E2E) 중복 성공 통보 원장 1건 / PG 실패 원장 없음 / 미확정 원장 없음 (QS-4-2~4) | 사후 작성, 첫 통과 → 뮤턴트 각각 1 failed(재반영 막기 제거 / 실패에도 원장 / 양수 확정에도 원장) | 구현 변경 없음 | `f480742` |

- 사용자 결정(콜백 연결): "대상별 분기 + 200 통일". Refund에 연결된 PG 취소 요청은 공통 결과 처리로, refundId가 없는 기존 요청은 US6·Phase 13 전환 전까지 기존 `refundService.callback`으로 보낸다. 응답은 계약 §7대로 모두 200이다. 그래서 `test/seat-type.e2e-spec.ts`(QS 자동 결제 취소)의 기대 상태를 201→200으로 바꿨다. 동작 검증은 바꾸지 않았다.
- 이탈:
  - U138의 첫 테스트는 `statusCode: 404`를 단언했다. 도메인 오류에는 없는 속성이라 단언이 틀렸다. `DomainNotFoundError` 인스턴스(필터가 404로 매핑)와 code를 확인하도록 고쳤고, 이 정정은 구현과 같은 커밋에 들어갔다.
  - A31~A33은 안쪽 루프 뒤에 작성했다(사후 작성). 뮤턴트로 각 테스트가 결함을 잡는지 확인했다.
- T072에서 다루지 않은 것(tasks 체크는 마커 동작 기준으로 했다):
  - PAYMENT 대상 콜백의 orderItemId null 허용: DTO는 아직 UUID 필수다. US6 전 결정 사항과 함께 다룬다.
  - PG 취소 거래 ID를 원승인 ID와 구별하는 전역 unique 검증
  - 성공 amount의 정수 검증
  - 서명 인증(US7)
- 남은 연결: A31의 "거래조회로 다시 반영"은 US5 조회 경로에서 같은 `applyPgResult`를 쓸 때 다시 확인한다. SUCCEEDED 뒤 FAILED 통보도 같은 모순 규칙으로 처리되지만 별도 테스트는 없다.
- 결과: 단위 368 passed, E2E 74 passed(`f480742`). 스위트 실행 중 ticket-pause E2E에서 426 간헐 실패가 1회 있었고(e2e-141915), 재실행에서 통과했다.

## Phase 6 Codex 검수 1차 (2026-10-28)

- 범위: `c49fcd6..ca147d3`, T064~T072·T182
- 판정: **수정 필요**. P2 5건과 계층 지적 1건이다.
  1. 결과 중복 판정이 상태 종류만 비교한다. 실제액·거래 ID가 다른 성공 통보도 같은 결과로 무시된다.
  2. 모순 통보가 오면 PAID인데 reviewRequired=true인 상태가 된다. 정상액 판정도 기존 검토 필요를 고려하지 않는다. data-model은 PAID를 검토 완료일 때만 허용한다.
  3. 실패·금액 불일치에 필요한 알림과 거래 로그가 없다(FR-037·FR-027, T070은 내부 알림 저장 포함).
  4. T072 콜백 검증이 끝나지 않았다. 금액 정수 검증, 원승인 거래 ID 구별·전역 unique 검증이 없고, PAYMENT 대상 null 허용은 완료 범위에서 명시적으로 분리해야 한다.
  5. 콜백 저장 실패가 500으로 나간다. 계약 §7·§10은 503 REFUND_STORAGE_UNAVAILABLE이다.
  - 계층 지적: 컨트롤러가 저장소를 직접 조회한다(3계층 규칙 위반).
- 타당하다고 본 것: 대상별 기존/신규 분기와 200 통일, 조회 → Refund → PaymentCancel 잠금 → 재조회 순서, 실제액·합계·원장의 같은 트랜잭션 저장.
- 사용자 결정: 지적 2의 앞부분은 문서 해석이 갈려서 사용자에게 물었다. 결정은 "조치 필요로 내림"이다. 계약 §7의 "최종 상태 유지"는 PG 취소 요청의 확정 결과·실제액·원장을 덮어쓰지 않는다는 뜻으로 읽고, 환불은 ACTION_REQUIRED·reviewRequired·PG_RESULT_CONFLICT로 둔다.

## 사이클: Phase 6 검수 1차 수정 (U312~U327)

| 동작 | 테스트 | red | green·검증 | 커밋 |
|---|---|---|---|---|
| U312 | 성공 확정 뒤 실제액이 다른 성공 통보 → 모순·운영자 알림, 실제액·원장 유지 | actionCode null·알림 0 | `contradicts()`: 종류 또는 성공 실제액이 다르면 모순 | `5b91907` |
| U313 | 성공 확정 뒤 거래 ID가 다른 성공 통보 → 모순 | actionCode null·알림 0 | 모순 판정에 pgTransactionId 비교 추가 | `cd9cf06` |
| U314 | PAID 환불에 모순 통보 → ACTION_REQUIRED·paidAt null·reviewRequired·PG_RESULT_CONFLICT, 시도·지급·원장 유지 | payoutStatus PAID | 모순 기록 때 지급 상태를 내림(사용자 결정) | `8d2d8ad` |
| U315 | 검토 필요인 환불은 정상 금액 성공에도 PAID가 아님 | PAID·paidAt 기록 | settled = 금액 일치 && !reviewRequired. 금액이 맞고 검토 중이면 ACTION_REQUIRED만(기존 actionCode 유지) | `1978ccd` |
| U316 | 고객 환불 PG 거절 → 고객 본인·점주·운영자 알림 | 알림 [] | `notifyPayoutAction`(eventKey `<kind>:<시도ID>`) | `6ad007b` |
| U317 | 매장 환불 PG 거절 → 점주·운영자만 | CUSTOMER 알림 포함 | 고객 알림은 source CUSTOMER일 때만 | `8af6792` |
| U318 | 실제액 불일치 → 운영자 알림 | 알림 [] | 불일치면 `notifyOperator(AMOUNT_MISMATCH)`. 리팩터로 알림 공통화(모순 알림 eventKey도 `<kind>:<시도ID>`로 통일) | `63130f5` |
| U319 | 거절·불일치·모순 → 거래 로그(it.each 3개) | Received array [] (3 failed) | 운영자 알림 때 로그 항목을 모으고, 커밋 뒤 `TransactionLoggerService.logTransaction` | `56397f8` |
| U320 | 콜백 amount 1.5 → 형식 오류 | 오류 필드 [] | `@IsNumber` → `@IsInt` | `d1708aa` |
| U321 | 콜백 orderItemId null 허용(UUID 아닌 문자열은 계속 거절) | orderItemId isUuid | `@IsOptional`, 타입 `string \| null`. 기존 경로에 null이면 연결 불일치 가드(타입상 필요) | `249a040` |
| 리팩터 | 콜백 대상별 분기를 컨트롤러에서 `RefundResultService.receiveCallback`으로 이동(계층 지적) | — | 테스트 변경 없음 | `28350ab` |
| U325 | 기존 경로 PG 취소 요청에 null 대상 콜백 → PG_CALLBACK_TARGET_MISMATCH | 첫 통과(U321 가드) → 뮤턴트(가드 제거) 1 failed | 구현 변경 없음 | `891f838` |
| U322 | PG 취소 거래 ID = 원승인 거래 ID → 409, 반영 없음 | resolved instead of rejected | 성공 결과의 거래 ID가 Payment.pgTransactionId와 같으면 연결 불일치 | `a73c324` |
| U323 | 다른 PG 취소 요청이 쓰는 거래 ID → 409, 반영 없음 | Received constructor: PrismaClientKnownRequestError | 성공 반영 전 `isCancelTransactionUsedByOther` | `3f59061` |
| U326 | 공통: DomainServiceUnavailableError → 503·지정 code | status 500·INTERNAL_SERVER_ERROR | 공통 오류와 필터 매핑 추가 | `cde3235` |
| U324 | 콜백 저장 실패 → RefundStorageUnavailableError(503) | Received constructor: Error | `receiveCallback`이 도메인 오류는 그대로, 그 밖의 오류는 503으로 바꿈(cause 보존) | `774b319` |
| U327 | 대상 없음 오류는 503으로 바뀌지 않음 | 첫 통과 → 뮤턴트(모든 오류 503) 1 failed | U324 과대 변환 방지 | `f003079` |

- 사용자 승인으로 이전 테스트를 고친 것: U135의 단언을 "운영자 알림 전체 = [모순 1건]"에서 "운영자·PG_RESULT_CONFLICT 알림 정확히 1건"으로 좁혔다. U316 이후 준비 단계(PG 거절)에서 정상적인 PG_REJECTED 알림이 생기기 때문이다. 확인하는 동작은 그대로이고, 거절 알림은 U316이 확인한다(`6ad007b`).
- 이탈과 보정:
  - U314: 커밋 전에 한 paidAt 뮤턴트는 sed가 적용되지 않아 무효였다. 커밋 뒤 python으로 다시 적용해 1 failed를 확인했다.
  - U314·U327: `-t` 패턴에 괄호가 있어 첫 실행이 0건 매치였다. 패턴을 바꿔 다시 실행했다.
  - U326: 필터 파일의 기존 eslint 오류 8건 때문에 커밋 도구(gc.sh)가 멈췄다. HEAD와 변경 후가 모두 8건이라 새 오류가 없음을 확인하고, 같은 절차(green 스위트·tsc)로 직접 커밋했다.
  - 린트 비교 중 `git stash`를 쓰고 바로 pop했다. 사용자 미커밋 변경이 그대로인 것을 확인했고, 앞으로는 쓰지 않는다.
- 미검증·남은 것:
  - 같은 거래 ID로 동시에 온 콜백 두 건이 함께 확인을 통과하는 경쟁은 DB unique가 막는다. 다만 그때 응답 코드가 계약 코드인지는 확인하지 않았다.
  - 롤백된 사건이 거래 로그에 남지 않는지는 별도 테스트가 없다(구조상 커밋 뒤 기록).
  - SYSTEM 경로의 점주 알림 여부는 US6에서 정한다.
  - 서명 인증은 US7이다.
  - PAYMENT 대상 PaymentCancel.orderItemId 표현 결정은 US6 전에 한다(콜백 DTO의 null 허용은 이번에 완료).
- 결과: 단위 387 passed, E2E 74 passed(`f003079`). 스위트 실행 중 E2E 간헐 실패 4회(ticket-pause 426·404, seat-type QS-10 404·QS-3 socket hang up)가 있었고 모두 재실행에서 통과했다.

## Phase 6 Codex 재검수 1차 (2026-10-28)

- 범위: `ca147d3..b05d0f6`
- 판정: **수정 필요**. P1 1건, P2 2건, 권고 1건이다.
  1. [P1] `orderItemId`를 생략하면(undefined) 서비스가 대상 비교를 건너뛴다. 상품 대상 환불이 PAID가 되는 것을 재현했다.
  2. [P2] 서로 다른 환불이 같은 거래 ID로 사전 확인을 함께 통과하면 DB unique 위반이 503 REFUND_STORAGE_UNAVAILABLE로 바뀐다. 409 PG_CALLBACK_TARGET_MISMATCH여야 한다.
  3. [P2] 모순 처리 뒤 반환값이 처리 전 상태(PAID)다. DB에는 ACTION_REQUIRED가 저장된다.
  - 권고: 모순 거래 로그에 식별자만 있다. 대사할 수 있게 기존 결과와 새 통보의 종류·실제액·거래 ID를 남긴다.
- Codex 실행: DB 없는 재현, DTO·필터 테스트 11개 통과. 공유 DB 테스트는 실행하지 않았다.

## 사이클: Phase 6 재검수 1차 수정 (U328~U331)

| 동작 | 테스트 | red | green·검증 | 커밋 |
|---|---|---|---|---|
| U330 | 모순 처리 반환 상태 = 저장된 상태(ACTION_REQUIRED) | payoutStatus PAID | 모순 분기 반환에 ACTION_REQUIRED | `8a6de9b` |
| U328 | (E2E) orderItemId 생략 콜백 → 409 PG_CALLBACK_TARGET_MISMATCH, 반영 없음 | 첫 통과(HTTP 경로는 컨트롤러 `?? null`이 이미 정규화) → 뮤턴트(컨트롤러·서비스 정규화 모두 제거) `expected 409, got 200` | `applyCallback`에서도 `?? null`로 정규화(서비스 직접 호출 우회 방지) | `9c4bda6` |
| U329 | 동시 사용으로 거래 ID unique 위반 → 409(503 아님), 반영 없음 | Received constructor: RefundStorageUnavailableError | `applyPgResult` 트랜잭션에 `.catch(rethrowCancelTransactionConflict)`: P2002·PaymentCancel·pg_transaction_id면 연결 불일치. 경쟁은 사전 확인 스파이(false 1회)로 재현했고, 실제 DB unique 위반이 났다 | `f03bb62` |
| U331 | 모순 거래 로그 metadata에 stored(종류·실제액·거래 ID)·received | stored·received 없음 | `recordResultConflict`가 새 결과를 받아 로그에 함께 기록 | `adf241c` |

- Prisma 7 어댑터의 unique 위반은 컬럼이 `meta.driverAdapterError.cause.constraint.fields`에 담긴다. 임시 로그로 확인한 뒤 로그를 지웠고, 판별은 meta 문자열로 한다.
- 실제 DB에서 두 트랜잭션을 동시에 돌리는 경합 테스트는 아니다. 사전 확인을 통과시키는 대역으로 같은 unique 위반 경로를 재현했다.
- 결과: 단위 390 passed, E2E 75 passed(`adf241c`). seat-type 간헐 실패 1회(QS-11a 404, e2e-183804)가 있었고 재실행에서 통과했다.

## Phase 6 Codex 재검수 2차 (2026-10-28)

- 범위: `b05d0f6..ca76d6e`
- 판정: **통과**. 이전 지적 3건과 로그 보강 권고가 반영됐고, 이번 수정 범위에서 추가 수정 사항은 없다.
- Codex 확인(공유 DB 없이 실제 서비스 호출):
  - 대상 생략 시 검증 우회 차단
  - 모순 처리 후 ACTION_REQUIRED 반환
  - 모순 로그에 기존 결과·새 통보 기록
  - 해당 거래 ID unique 위반은 409, 다른 저장 오류는 503 유지
  - 트랜잭션 실패 시 거래 로그 미기록(커밋 실패 대역)
- 통과 판정의 검증 범위 밖:
  - 실제 두 트랜잭션의 동시 경합(U329는 사전 확인 대역 + 실제 unique 위반 확인)
  - US6 항목(SYSTEM 경로 알림, PAYMENT 대상 orderItemId 표현)
  - US7 항목(서명)
- Codex는 이번에도 HERDR_ENV 확인 실패로 Claude 패널에 보내지 못했다. 결과는 Codex 패널에서 읽었다.

## Phase 6 완료

- T064~T072·T182 완료, Codex 재검수 2차 통과. 권장 구현 순서(US4 공통 결과 → US2·US3)에 따라 다음은 Phase 4(US2 점주의 매장 환불, T035~T056·T180)다.

## Phase 4 (US2 점주의 매장 환불) 사이클 (2026-10-28)

- 바깥 루프: A11(QS-2-1)을 먼저 작성해 red를 확인하고(`expected 202 "Accepted", got 404 "Not Found"`, 경로 없음) scratchpad에 보관한 뒤 안쪽 루프를 진행했다.
- 테스트 위치:
  - 판정 규칙: `src/refund/refund-policy.spec.ts`(`evaluateStoreRefund`). tasks T051은 `refund-store.service.spec.ts`로 적었지만 판정을 순수 함수로 분리해 그쪽에서 확인했다.
  - 요청 형식: `src/refund/dto/store-refund.dto.spec.ts`
  - 저장·퇴실·작업 제거: `src/refund/refund-store.integration.spec.ts`(실제 DB)
  - 역할·오류 매핑: `src/refund/refund-store.service.spec.ts`
- 진행 중 추가한 동작: U332~U335(매장 판정의 대상 여부 규칙. 명세 2-7·2-9가 요구하지만 단위 목록에 없었음), U336~U338(매장 범위·현재 점주·거절 코드 매핑).

| 동작 | red | green·검증 | 커밋 |
|---|---|---|---|
| U98 0원·사유 허용 | NOT_IMPLEMENTED | 입력 그대로 허용(가짜 구현) | `276d9cf` |
| U100 실결제액+1 → REFUND_AMOUNT_EXCEEDED | eligible true | amount > paidAmount 거절 | `a8c6e0d` |
| U99 실결제액과 같으면 허용 | 첫 통과 → 뮤턴트(`>=`) 1 failed | — | `4f224fa` |
| U103 사유 없음 → REFUND_REASON_REQUIRED | eligible true | 사유 필수 | `09dbbe4` |
| U104 공백 사유 = 누락 | eligible true reason '   ' | trim 후 빈 값은 null | `fba4258` |
| U107 기한 안 미사용 1원 적음 → UNUSED_TICKET_FULL_REFUND_REQUIRED | eligible true | 고객 판정의 위반 수집을 `unusedRuleViolations`로 추출해 재사용 | `a81a612` |
| U108 기한 안 미사용 전액·사유 없음 확정 | REFUND_REASON_REQUIRED | 기한 안 미사용이면 사유 선택 | `426fc6a` |
| U109·U110 기한 경과 미사용: 사유 필수, 적은 금액 허용 | 각각 첫 통과 → 뮤턴트(기한 경과 무시) 1 failed | — | `9238ffc`·`36f83b5` |
| U111 남은 시간 0인 시간권 확정 | 첫 통과 → 뮤턴트(소진 거절) 1 failed | — | `40d6185` |
| U101 금액 -1 → 400 | 오류 필드 [] | `StoreRefundDto` 추가, `@Min(0)` | `266172c` |
| U102 소수 금액 → 400 | 오류 필드 [] | `@IsInt` | `98cc7c7` |
| U105·U106 trim 뒤 500자 허용 / 501자 400 (경계 쌍) | U106 오류 필드 [] | `@Transform(trim)`·`@MaxLength(500)`, 뮤턴트(trim 제거)에서 U105 실패 | `58dbcf3` |
| U332 매장 범위 밖 → TICKET_NOT_FOUND | eligible true | 후보 null 판정 | `9a109c4` |
| U333 지급 완료 환불 → ALREADY_REFUNDED | eligible true | 고객 판정 2~4단계를 `targetRuleRejection`으로 추출해 공용 | `444cdfd` |
| U334·U335 REFUND_IN_PROGRESS·PAYMENT_NOT_COMPLETED | 첫 통과 → 뮤턴트(분기 제거) 각 1 failed | — | `74ea7b1`·`6829d48` |
| U114 MANAGER → REFUND_FORBIDDEN | Received constructor: Error | OWNER가 아니면 거절 | `5317b8a` |
| 리팩터 | — | 확정 저장 단계를 `RefundAcceptanceService.confirmAcceptedRefund`로 추출(고객 동작 동일), 매장 서비스 등록 | `caa5b4f` |
| U115 점주·시각·사유·금액·종료 동의 저장 | '구현 전' | STORE_REFUND 멱등 처리 안에서 잠금 → 판정 → 종료 동의 → 공용 확정, 커밋 뒤 PG 전송 | `b22af83` |
| U336 다른 매장 이용권 → TICKET_NOT_FOUND | resolved instead of rejected | 대상 shopId ≠ 요청 shopId면 후보 null | `56b1205` |
| U337 현재 점주 아님 → SHOP_NOT_FOUND | resolved instead of rejected | 멱등 처리 전 `assertShopScope`(재응답에도) | `45fc8a8` |
| U338 거절 코드 매핑(400·409·404) | it.each 6 failed | `storeRejectionError`, `RefundInputRejectedError`(400) 추가 | `30de83c` |
| U116~U118 0원 매장 환불: PG 미요청·PAID+0원 원장·200 | 첫 통과(공용 확정) → 뮤턴트 3종 각 1 failed | — | `b47a35f` |
| U112 이용 중 퇴실 동의 없음 → TICKET_IN_USE | resolved instead of rejected | `TicketInUseError`(409) | `c821519` |
| U119 이용 중 시간권: 퇴실 시각까지만 차감, 종료 세션·퇴실 동의 기록 | 첫 실행 TypeError(무효) → 단언 실패로 정정 → session ACTIVE·remaining 500 | `SessionLifecycleService.endSession`(기존 퇴실 규칙) 호출, RefundModule에 SessionLifecycleModule | `a454d5c` |
| U113 금액 오류 거절은 퇴실 안 함 | 첫 통과 → 뮤턴트(금액 상한 제거) 1 failed | 검증 뒤 퇴실 + 거절 시 롤백 | `d12a3a1` |
| U120 동의 사이 이미 퇴실한 세션 재차감 없음 | 첫 통과 → 뮤턴트(세션 필터 제거 + endSession 멱등 제거) 이중 차감 1 failed | — | `0756545` |
| U121 커밋 뒤 자동 종료 작업 제거, 실패해도 복구 없음 | removalCalls [] | session-lifecycle에 `SessionEndJobQueue` 추가, 실패는 경고 로그 | `aa7bce1` |
| A11 (QS-2-1) | 위 바깥 루프 red | `POST /refund/shop/:shopId` 연결 | `cc2cdcf` |
| A12~A26 (QS-2-2~2-13) | 사후 작성, 20개 첫 통과 → 뮤턴트 14종 모두 대상 테스트 실패 | — | `79f49ad` |

- 사용자 결정(E2E 간헐 실패): "127.0.0.1로 명시해 고침".
  - 원인 가설: 앱 코드에는 426이 없다. supertest가 `::` 임시 포트로 띄운 앱에 `127.0.0.1:같은 번호`로 요청하면, 그 번호를 127.0.0.1로 쓰는 다른 프로그램(codex·Orca 등)이 응답한다.
  - 수정: `test/helpers/listen-on-loopback.ts`로 app·ticket-pause·seat-type·refund-test-context의 앱을 `127.0.0.1`로 띄운다. 준비 코드만 바꿨다.
  - 결과: 수정 뒤 E2E 5회 연속 76/76 통과(`1450faf`). 이후 모든 스위트에서 E2E 실패가 없었다.
- 이탈:
  - [실패 상태 커밋] U333 첫 스위트가 E2E 간헐 실패로 커밋되지 않았는데, 반복 스크립트가 멈추지 않고 U334(`74ea7b1`)·U335(`6829d48`)를 spec 파일만으로 커밋했다. 두 커밋에는 U333 테스트가 들어갔지만 구현이 빠져 커밋 시점 기준으로는 실패 상태다. 작업 트리에는 구현이 있어 스위트는 통과했다. 구현은 `444cdfd`로 이어서 커밋했고 기존 커밋은 고쳐 쓰지 않았다.
  - U105·U106은 경계 쌍이라 한 사이클로 처리했다.
  - U119의 첫 red는 TypeError(무효)라 같은 사이클에서 테스트를 단언 실패로 정정했다.
  - A12~A26은 사후 작성이다.
  - 한 번은 단위 스위트의 jest 워커 1개가 10분 넘게 멈춰 종료했고, 재실행에서는 정상이었다(원인 미확인).
- 남긴 것:
  - `SessionEndJobQueue.remove`가 `UsageSessionService.removeJob`과 3줄 겹친다. 기존 usage-session spec 변경을 피하려고 그대로 뒀다.
  - T053의 `session-lifecycle.repository.ts`는 만들지 않고 기존 `SessionLifecycleService.endSession`을 재사용했다.
  - T055의 0원 원장은 Phase 3의 `refund.repository.ts`에서 저장한다.
  - T056의 "남은 작업의 안전한 종료"는 처리기의 endSession 멱등으로 보장되며, 처리기 코드는 바꾸지 않았다.
  - 정상 PG 결과 반영은 US4(A12·A26)와 결합해 확인했다.
- 결과: 단위 427 passed, E2E 95 passed(`79f49ad`).

## Phase 4 Codex 검수 1차 (2026-10-28)

- 범위: `e545fc9..49949ff`
- 판정: **수정 필요**. P2 2건이다.
  1. 일반 퇴실·자동 종료(`SessionLifecycleService.endSession`)는 UsageSession을 먼저 잠근 뒤 Ticket을 갱신한다. 환불(Ticket → UsageSession)과 순서가 반대라 교착이 가능하다. 코드 경로로 확인했고 실제 경합은 실행하지 않았다.
  2. 계약 §4·T052는 제공된 사유를 trim 후 1~500자로 정하는데, DTO에 최소 길이가 없다. `reason: "   "`가 형식 검사를 통과하고, 기한 안 미사용 전액 환불에서는 사유 없이 확정되는 것을 재현했다.
- 타당하다고 본 것: 검증 → 퇴실 → 확정의 같은 트랜잭션, 멱등 재응답 전 OWNER·현재 매장 권한 검사, 0원 PG 미호출·200 PAID.
- 사용자 결정 필요 항목 없음. 두 지적 모두 계약(§6 공유 잠금 순서, §4 사유 형식)에 이미 정해져 있다.

## 사이클: Phase 4 검수 1차 수정 (U339·U340)

| 동작 | red | green | 커밋 |
|---|---|---|---|
| U339 (실제 DB) 환불이 Ticket을 잠근 동안 일반 퇴실이 같은 세션을 종료해도 교착 없이 둘 다 끝남 | `Raw query failed. Code: 40P01. Message: deadlock detected`, 결과에 rejected | `endSession`이 `$executeRaw`로 세션의 이용권을 먼저 `FOR UPDATE`한 뒤 기존대로 세션을 잠금(계약 §6 Ticket → UsageSession) | `169bca1` |
| U340 공백만 있는 사유를 보내면 형식 오류(400) | 오류 필드 [] | `@MinLength(1)`(trim 뒤) | `1870626` |

- U339는 두 트랜잭션을 실제로 동시에 실행해 교착을 재현한 테스트다. 기존 `session-lifecycle.service.spec.ts`는 `$queryRaw` 호출 순서를 목으로 고정하고 있어서, 이용권 잠금을 `$executeRaw`로 넣어 그 테스트를 바꾸지 않았다.
- U104(판정에서 공백 사유를 누락으로 처리)는 HTTP 경로에서는 U340 형식 검사가 먼저 막지만, 서비스 직접 호출을 대비한 방어로 그대로 둔다.
- 결과: 단위 429 passed, E2E 95 passed(`1870626`).

## Phase 4 Codex 재검수 (2026-10-28)

- 범위: `49949ff..5820323`
- 판정: **통과**. 이전 P2 2건이 해결됐고, 이번 수정 범위에서 추가 수정 사항은 없다.
  - `endSession`의 Ticket → UsageSession 잠금 순서, 실제 DB 경합 테스트 코드, 수정 전 교착·수정 후 통과 기록을 확인했다.
  - 사유는 trim 후 최소 1자를 검사하고, 생략은 계속 허용한다.
- Codex 직접 실행: 관련 단위 테스트 40개 통과. 공유 DB 경합 테스트는 직접 실행하지 않았다.
- 판정 범위 밖: US3의 입실·정지 재개 경쟁.

## Phase 4 완료

- T035~T056·T180 완료, Codex 재검수 통과. 권장 구현 순서상 다음은 Phase 5(US3 종료된 이용권의 입실 차단)다.

## Phase 5 (US3 종료된 이용권의 입실 차단) 사이클 (2026-10-28)

- 바깥 루프: A27(QS-3-1)을 먼저 작성해 red를 확인하고(`expected 409 "Conflict", got 400 "Bad Request"`, 고정석 배정 없음 오류가 먼저 나옴) 보관한 뒤 안쪽 루프를 진행했다.

| 동작 | red | green·검증 | 커밋 |
|---|---|---|---|
| U122 REVOKED 입실 → TICKET_TERMINATED | Received constructor: TicketSeatUnassignedError | `TicketTerminatedError`(409) 추가, 입실 첫 단계에서 거절(좌석 검증보다 먼저) | `a91f4e9` |
| U126 (실제 DB 경쟁) 입실이 먼저 이용권을 잠그면 뒤이은 고객 환불은 USED_TICKET | entry rejected·refund fulfilled | 세션 생성 트랜잭션 첫 단계에서 이용권 `FOR UPDATE` 후 REVOKED 재확인(공유 잠금 순서) | `f4ab826` |
| U124 REVOKED 정지 재개 → TICKET_TERMINATED | Received constructor: DomainBadRequestError(정지 아님이 먼저) | 잠근 이용권이 REVOKED면 진행 중 정지 확인보다 먼저 거절 | `ca5b233` |
| U125 REVOKED 좌석 타입 변경 → TICKET_TERMINATED(409) | Received constructor: TicketClosedError | REVOKED만 `TicketTerminatedError`, EXPIRED·EXHAUSTED는 400 유지 | `0abf635`(+ 정리 `eb66a31`) |
| U123 지급 조치 필요 환불의 종료 이용권도 입실 거절 | 첫 통과(재확인은 지급 상태를 보지 않음) → 뮤턴트(잠금 아래 재확인 제거) 1 failed | 저장소를 직접 호출해 잠금 아래 재확인만 검증 | `b3ccaf2` |
| U127·U128 환불 뒤 도착한 자동 종료 작업: 종료 시각을 덮어쓰지 않음·다시 차감하지 않음 | 첫 통과(endSession 멱등) → 뮤턴트(멱등 분기 제거) 2 failed | 처리기와 같은 `UsageSessionService.endUsageSession` 호출로 재현. 처리기 코드는 바꾸지 않음 | `caf22f2` |
| A27~A29, 입실 먼저 순서 (QS-3-1~3-3) | A27은 위 red. A28(2개)·A29·입실 먼저는 사후 작성, 첫 통과 → 뮤턴트(입실 종료 확인 모두 제거) QS-3 4 failed, 뮤턴트(사용 이력 판정 제거) 입실 먼저 1 failed | — | `08d4370` |

- 사용자 결정(U125): "계약대로 409, 기존 테스트 수정". 좌석 기능의 기존 it.each(EXPIRED·EXHAUSTED·REVOKED → TicketClosedError)에서 REVOKED를 빼고 U125 테스트로 옮겼다. 테스트 변경은 구현 전에 했다.
- 이탈: U125 커밋 때 python 문자열 불일치로 `closedStatuses` 정리가 빠졌다. 구조 변경 커밋 `eb66a31`로 따로 반영했다(동작 동일).
- 잠금 순서: 정지·재개(`ticket-pause.repository`)와 좌석 변경(`ticket-seat.repository`)은 이미 이용권을 먼저 `FOR UPDATE`한다. 입실은 이번에 이용권 → 좌석·배정 순서가 됐다. 세션 종료는 Phase 4에서 이용권 → 세션 순서로 맞췄다. 그래서 T062의 저장소 코드는 따로 바꿀 것이 없었다.
- 결과: 단위 435 passed, E2E 100 passed(`08d4370`).

## Phase 5 Codex 검수 1차 (2026-10-28)

- 범위: `ed2801b..4704491`
- 판정: **수정 필요**. P2 1건이다.
  - 입실 커밋 → (작업 ID 등록 전) 매장 환불이 퇴실 확정 → 작업 ID 등록 실패 순서가 생기면, 입실 서비스의 실패 처리가 조건 없는 `failSession`으로 ENDED를 JOB_REGISTER_FAILED로 덮어쓴다. 작업 생성 실패와 외부 API 실패도 같은 메서드를 쓴다. Codex가 서비스·저장소와 DB 대역으로 재현했다.
- 타당하다고 본 것: Ticket 잠금 뒤 REVOKED 재확인, 정지 재개·좌석 변경의 오류 우선순위.
- 사용자 결정 필요 항목 없음(종료 상태 보존 규칙 FR-042).

## 사이클: Phase 5 검수 1차 수정 (U341)

| 동작 | red | green | 커밋 |
|---|---|---|---|
| U341 (실제 DB) 입실 후속 실패 처리는 환불로 이미 종료된 세션을 덮어쓰지 않음 | status JOB_REGISTER_FAILED·failureReason 기록 | `failSession`을 `updateMany(where id·status ACTIVE)`로 조건부 갱신(세 실패 경로 모두 적용) | `c93f20e` |

- 결과: 단위 436 passed, E2E 100 passed(`c93f20e`).

## Phase 5 Codex 재검수 (2026-10-28)

- 범위: `4704491..0ee9183`
- 판정: **통과**. 이전 P2가 해결됐고, 이번 수정 범위에서 추가 수정 사항은 없다. `failSession`은 ACTIVE 세션만 조건부로 갱신하므로, 세 실패 경로 모두 이미 ENDED인 세션을 보존한다. U341의 검증과 수정 전 실패 기록도 확인했다.
- Codex 직접 실행: 관련 단위 테스트 13개 통과. 공유 DB 테스트는 직접 실행하지 않았다.

## Phase 5 완료

- T057~T063·T181 완료, Codex 재검수 통과. 권장 구현 순서상 다음은 Phase 7(US5 PG 결과 조회·재전송·장애 복구)이다.

## Phase 7a (US5 PG 결과 조회·재전송·장애 복구 — 독립 부분) 사이클 (2026-10-28~29)

- 사용자 결정(범위): "독립 부분 먼저 검수, 나머지는 뒤에". 7a는 아래만 다룬다.
  - 전송 결과 저장, 자동 조회·재전송·백오프·결과 확인 실패, PROBE/BATCH 장애 복구
  - 운영자 재확인·현황, 미확정 시도의 개별 확인
  - 7b로 미룬 것: A38·A47(US6 의존), A53·A54의 실패 확정 시도 새 요청 경로와 T102의 해당 부분(US10 공통 재요청 의존), T183
- 사용자 결정(전송 연결): "A: 확정 때 전송 기록". 확정 트랜잭션이 최초 시도에 전송 시도 1회·시각·담당을 함께 저장하고, 커밋 뒤 PG를 호출한 다음 결과 반영은 전송 서비스가 맡는다. 기존 `refund-acceptance.service.spec.ts`는 생성자 인자만 추가했다.
- 사용자 결정(작업자): "설정으로 끄기, 테스트에서만 false". `REFUND_RECOVERY_WORKER_ENABLED`(기본 true)를 추가하고, jest `setupFiles`(`test/setup-env.ts`)에서 false로 둔다. `.env.example`은 사용자 미커밋 변경이 있어 이 항목을 넣지 않았다.
- 사용자 결정(U150): 기본 설정에서는 상한 도달 전에 결과 확인 실패로 넘어가므로, 간격 계산을 순수 함수(`refund-recovery.policy.ts`)로 빼서 단위 테스트한다.

| 묶음 | 동작 | 핵심 구현 | 커밋(대표) |
|---|---|---|---|
| 전송 결과 | U140, U342~U345 | `RefundDispatchService`: 전송 전 시도·담당 저장 → 트랜잭션 밖 전송 → NOT_SENT·REJECTED는 시도 실패·조치 필요, SUCCEEDED는 공통 결과 처리, ACCEPTED·UNKNOWN은 60초 뒤 조회. 응답과 멱등 재응답에 전송 결과(payoutStatus·actionCode) 반영 | `ccf1779`~`a6045ee` |
| 자동 조회 | U142~U145, U149, U151~U153, U169 | `RefundRecoveryService`: 조회 담당 → 트랜잭션 밖 조회 → 미접수는 한도 안 재전송·소진 시 RETRY_EXHAUSTED, 처리 중은 정상 간격, 오류는 백오프·5회째 QUERY_FAILED, 성공·거절은 공통 결과 처리 | `11161cb`~`9976b71` |
| 정기 탐색 | U141, U146~U148, U158, U346 | `findDueInquiries`: 예정 시각이 지났거나 전송 전 중단(예정 없음·담당 기한 경과)인 REQUESTED, 확정·지급 처리 중·PG 방식·예약 없음 | `bdfde83`~`e932778` |
| 장애 복구 | U154~U156, U347, U351 | `RefundWorkRepository` 단일 제어 행: PROBE 900초마다 가장 오래된 1건 → 정상이면 BATCH(20건씩) → 오류 재발 시 PROBE. 실행 중 제어 담당. 결과 확인 실패 건의 재조회 오류는 진입 시각 유지, 처리 중 응답이면 일반 일정으로 복귀 | `582ed0f`~`8da37a0` |
| 기동·작업자 | U157, U348~U350 | `RefundRecoveryScheduler`(upsertJobScheduler 5초), `RefundRecoveryProcessor`(탐색+복구, 꺼짐이면 생략) | `605a5b9`~`8097824` |
| 운영자 API | U159~U161, U352, A44, A45 | `POST /refund/recovery/resume`(SCHEDULED 202·ALREADY_RUNNING·NO_WORK), `GET /refund/recovery/status`, MANAGER만 | `80a39ad`~`80a698f` |
| 개별 확인 | U162~U168, U170~U172, A52 | `RefundPgCheckService`·`POST /refund/:refundId/pg-check`: 범위 권한(USER 403, 범위 밖 404 REFUND_NOT_FOUND), 진행 중 202·최근 결과·대상 아님·확인, 미접수는 한도와 관계없이 즉시 재전송(manualResendCount), 빈 본문만 허용 | `dbc14b8`~`1508b4d` |
| 인수 | A34~A37, A39~A46, A48~A52, A55 | 사후 작성 17개는 뮤턴트 12종으로 확인(A43은 단언 보강) | `0a57560` |

- 진행 중 추가한 동작: U342~U352. 명세·계약에 있지만 단위 목록에 없던 것들이다.
  - 전송 결과 처리, 응답 일치
  - 탐색 대상 환불 조건
  - 결과 확인 실패 복귀
  - 작업자 설정·등록·처리기
  - 복구 담당
  - 현황 API
- 찾아서 고친 실제 결함: U169의 red에서, 조회가 성공·거절을 확정해도 반영하지 않던 문제가 드러났다. 자동·개별 확인 모두 해당하며 `9976b71`에서 고쳤다.
- 이탈:
  - 같은 파일의 테스트 전용 동작을 여러 개 한 커밋으로 묶었다(U149·U150·U151·U153, U167~U170).
  - 무효 red를 같은 사이클에서 정정한 경우: U148·U163(PG 대역 미설정 TypeError), U345(JSONB 키 순서 비교), U147(정기 탐색이 다른 테스트 데이터를 고름).
  - 기존 테스트 변경: acceptance spec 생성자 인자(사용자 결정 A), store spec PG 인자 제거, seat-type afterAll에 알림 삭제(QS-21이 PG 미연동으로 SEND_FAILED 알림을 만듦). 단언은 바꾸지 않았다.
- 발견(범위 밖, 고치지 않음): 기존 `usage-session.service`의 `mockExternalApi`(무작위 10% 실패, 'TODO: 테스트 용 함수') 때문에 E2E QS-15에서 500이 한 번 났다.
- 결과: 단위 484 passed, E2E 124 passed(`0a57560`).

## Phase 7a Codex 검수 1차 (2026-10-29)

- 범위 `ae9b0fc..44aab82`. 판정 **수정 필요**: P1 2건, P2 3건.
  1. [P1] 같은 멱등 키의 응답이 실행 시점에 따라 달라진다. PG 호출 중 재요청은 PENDING을, 최초 요청은 ACTION_REQUIRED를 받는다. 전송 결과 저장과 응답 교체 사이에 중단되면 둘이 어긋난다.
  2. [P1] 담당을 잃은 복구 작업자가 제어 상태를 바꿀 수 있다(토큰 조건 없음). BATCH가 모든 건에 같은 `now`를 써서 뒤쪽 건이 지난 기한으로 담당을 잡는다.
  3. [P2] QUERY_FAILED 건이 미접수 확인 뒤 재전송이 접수돼도 일반 조회로 돌아가지 않는다.
  4. [P2] 개별 확인의 최근 조회 간격 검사가 잠금 밖이라 경합을 막지 못한다.
  5. [P2] 개별 확인 재전송의 실행자·거래 로그가 없다.
- 사용자 결정(1번): **"A: 전송 반영 뒤 완료"**. 계약 §4(전송 전 실패·즉시 거절도 202 ACTION_REQUIRED)를 지키고 Phase 2의 R4(처리와 최초 응답을 같은 트랜잭션에서 완료)를 바꾼다.
  - 확정 트랜잭션은 멱등 기록에 환불만 표시하고 처리 중으로 둔다.
  - 전송 결과를 반영한 최종 응답으로 완료한다.
  - 그 사이 같은 키는 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS`를 받는다.
  - 중단 뒤에는 처리 기한이 지난 같은 키 요청이 저장된 환불 상태로 응답을 만들어 완료한다.

## Phase 7a 검수 수정 사이클 (2026-10-29)

| 동작 | red(실행 명령 → 결정적 줄) | green | 커밋 |
|---|---|---|---|
| U353 | `npx jest src/refund/refund-result.integration.spec.ts -t '재전송이 접수되면 연속 오류를 지우고'` → `+ "failures": 5`, `+ "lastInquiryError": "PG 장애"`, `+ "queryFailedAt": 1990-01-01…` | `scheduleInquiryAfterSend`가 status REQUESTED·queryFailedAt null·연속 오류 0·오류 null도 저장. 단위 485, E2E 124 | `07b9165` |
| U354 | `… -t '잠금 안에서 최근 조회 간격을'` → `+ "checkStatus": "CHECKED"`, `+ "inquiries": 2` | `claimForInquiry(manual)`가 잠금 안에서 `lastInquiryAt` 간격을 확인해 `'RECENT'`를 돌려주고, pg-check가 RECENT_RESULT로 응답. 단위 486, E2E 124 | `933778a` |
| U355 | `… -t '현재 담당 토큰일 때만'` → `error TS2554: Expected 1 arguments, but got 2` 및 `PrismaClientValidationError`(토큰 인자 자체가 없음) | `updateRecoveryControl(claimToken, update)` = `updateMany(id·claimToken)`. 복구 실행이 토큰을 넘기고, `resumeRecovery`는 제어 담당을 잡은 뒤 BATCH로 바꾸고 내려놓는다(못 잡으면 ALREADY_RUNNING). 단위 487, E2E 124 | `59d430d` |
| U356 | `… -t '앞 건 조회에 걸린 시간을'` → `Expected: >= 633830401000`, `Received: 633830400000` | `runRecoveryBatch`가 건마다 `itemNow = now + 경과`를 쓰고, `extendRecoveryControl`로 담당 기한을 늘린다(잃었으면 중단). 오류 재발 때 `nextProbeAt(itemNow)`. 단위 488, E2E 124 | `e7d7d89` |
| U357 | `… -t '실행자·시각·개별 확인 재전송임을'` → `Received: undefined`(MANUAL_RESEND 로그 없음) | pg-check가 실행자 ID를 넘기고, `inquireForCheck`가 재전송했으면 거래 로그 type REFUND·status MANUAL_RESEND·userId 실행자·metadata(refundId·paymentCancelId·requestedAt·사유·resendResult)를 남긴다. 단위 489, E2E 124 | `e708871` |
| U358 | `npx jest src/refund/refund-acceptance.integration.spec.ts -t 'PG 전송 중에 같은 키로'` → `- "duringSend": "IDEMPOTENCY_REQUEST_IN_PROGRESS"`, `+ "duringSend": "resolved"` | `execute`에 커밋 뒤 단계 옵션(`afterCommit`·`rebuild`)을 추가했다. `markHandledInTransaction`이 환불 ID만 표시하고, 커밋 뒤 전송·결과 반영 다음 `completeAfterCommit`(토큰 조건)으로 완료한다. 이어받을 때 환불 ID가 있으면 처리를 다시 하지 않고 `rebuildAcceptance`로 완료한다. `replaceResponse`는 지웠다. 고객·매장 공통(`afterAcceptance`). 단위 491, E2E 124 | `db55d74` |

- 리팩터: 각 사이클 "필요 없음". U354에서 `InquiryOutcome` 타입을 뽑아냈다.
- 이탈·메모:
  - U356: 담당 기한 연장 자체는 중간 상태를 관찰하기 어려워 별도 테스트가 없다. 연장 실패 시 중단하는 분기도 테스트가 없다.
  - U358의 중단 복구 테스트는 처음 실행에서 통과했다(같은 커밋의 구현). 뮤턴트(이어받기 때 재구성 생략)로 `1 failed`를 확인했다.
  - U358 기존 테스트 변경: `refund-acceptance.service.spec.ts`의 멱등 대역이 커밋 뒤 단계를 실행하도록 바꿨다(사용자 결정 A의 범위). 단언은 바꾸지 않았다.
  - `IdempotencyRecord.refundId`는 선택 필드로 두어 Phase 2 단위 테스트의 기록 대역을 바꾸지 않았다.
- 결과: 단위 491 passed, E2E 124 passed(`db55d74`).

## Phase 7a Codex 검수 2차 (2026-10-29)

- 범위 `44aab82..c09ccd7`. 판정 **수정 필요**: P1 2건, P2 1건.
  1. [P1] 이어받기 뒤에도 이어받기 전 조회값(`existing.refundId`)으로 커밋 여부를 판단한다. 이어받기가 이전 처리 트랜잭션의 커밋을 기다렸다면 재처리 → 중복 거절 → 기록 삭제로 이어진다.
  2. [P1] `completeAfterCommit`이 갱신 0건을 무시해, 담당을 잃은 요청이 자기 응답(ACTION_REQUIRED)을 돌려준다. 이어받은 요청은 PENDING을 저장했으므로 응답이 어긋난다.
  3. [P2] 일반 정기 탐색과 처리기가 같은 `now`를 재사용해, 뒤쪽 작업이 지난 담당 기한으로 시작할 수 있다.
- 사용자 결정(3번 처리기): **"U350 단언 변경"**. 장애 복구는 탐색이 끝난 뒤의 현재 시각으로 시작하고, U350은 '복구 시각 ≥ 탐색 시각'으로 바꾼다.

## Phase 7a 검수 2차 수정 사이클 (2026-10-29)

| 동작 | red(실행 명령 → 결정적 줄) | green | 커밋 |
|---|---|---|---|
| U359 | `npx jest src/refund/refund-idempotency.service.spec.ts -t '이어받기가 기다리는 동안'` → `- "reprocessed": 0`(재처리 발생, 결과 undefined) | 이어받기 성공 뒤 `find(scope)`로 최신 기록을 다시 읽어 `refundId`를 판단한다. 단위 492, E2E 124 | `0641bf5` |
| U360 | `npx jest src/refund/refund-acceptance.integration.spec.ts -t '늦게 끝난 최초 요청은'` → `+ "payoutStatus": "ACTION_REQUIRED"`, `- "payoutStatus": "PENDING"` | `completeAfterCommit`이 갱신 여부를 돌려준다. `completeOrReplay`는 실패하면 저장 기록이 COMPLETED일 때 그 응답을, 아니면 409 IN_PROGRESS를 낸다. 재구성 경로도 같은 함수를 쓴다. 단위 493, E2E 124 | `2d48479` |
| U361 | `… refund-result.integration.spec.ts -t '일반 정기 탐색의 뒤쪽 건은'` → `Expected: >= 852076861001`, `Received: 852076860001` | `sweep`이 건마다 `itemNow = now + 경과`를 쓴다. 단위 494, E2E 124 | `b855399` |
| U362 | `npx jest src/refund/refund-recovery.processor.spec.ts` → `Expected: >= 45`, `Received: 0` | 처리기가 `sweep(new Date())` 뒤 `recoverQueryFailed(new Date())`를 호출한다. 단위 495, E2E 124 | `ad4b1d2` |

- 리팩터: 필요 없음.
- 이탈·메모:
  - U361은 처리기 부분이 기존 U350 단언 변경을 요구해 U361/U362로 나눴다.
  - U350 단언은 사용자 결정에 따라 U362 구현 전에 먼저 바꿨다. 바꾼 단언은 현재 코드에서도 통과하는 것을 확인했다.
  - U359는 실제 DB에서 이어받기의 행 잠금 대기를 결정적으로 재현하기 어렵다. 그래서 단위 테스트의 저장소 대역으로 '이어받기 전 조회=환불 없음, 뒤 조회=환불 있음'을 재현했다.
- 결과: 단위 495 passed, E2E 124 passed(`ad4b1d2`).


## Phase 7a Codex 검수 3차 (2026-10-29)

- 범위 `c09ccd7..fa9607a`. 판정 **통과**. 2차 지적 3건 해결, 추가 지적 없음.
- Phase 7a 완료. 다음 순서는 US10 공통 PG 재요청 → 7b(A53·A54 실패 시도 경로, T102, T183) → US6(A38·A47) → US7 → US8/US9 → 최종.

## US10 공통 PG 재요청 (MANAGER 직접 재시도) 사이클 (2026-10-29)

- 범위: 권장 순서의 "US10 공통 PG 재요청". T129·T131, U182~U194, A77·A80·A81.
  - 개별 확인의 실패 시도 경로(T130·T102, U195~U204, A78·A79, A53·A54)는 다음 단계 "US5 개별 확인 완료"에서 다룬다.
  - A82(QS-10-2)는 별도 지급 예약 경로와 함께 검증해야 하므로 US10 외부 지급 단계로 미뤘다.
- 해석 메모(다음 단계용): 계약 §8은 PG 조회 결과를 `FAILED{reason}`(PG가 실패를 확정)과 `QUERY_ERROR{reason}`(판단 불가)로 나눈다. 그래서 U202의 "오류 문자열만 있어 실행 여부가 불명확한 거절"은 PG 연동이 QUERY_ERROR로 넘기는 경우로 보고, 서비스 쪽에서는 U199와 같은 경로로 검증한다.

| 동작 | red(실행 명령 → 결정적 줄) | green | 커밋 |
|---|---|---|---|
| U184 | `npx jest src/refund/refund-retry.policy.spec.ts` → `+ "allowed": true` | REQUESTED·QUERY_FAILED 시도가 있으면 UNRESOLVED | `15b5d51` |
| U185 | 같은 파일 → `+ "allowed": true` | 활성 예약이 있으면 UNRESOLVED | `15b5d51` |
| U186 | 같은 파일 → `+ "allowed": true`(유효 담당) | `claimUntil > now`인 시도가 있으면 UNRESOLVED. 기한이 지난 담당은 허용 | `15b5d51` |
| U187 | 같은 파일 → `+ "allowed": true` | actionCode PG_RESULT_CONFLICT면 UNRESOLVED | `15b5d51` |
| U188 | 같은 파일 → `+ "allowed": true` | `0 < paidAmount < amount`면 PARTIAL_PAYOUT_REQUIRES_MANUAL | `15b5d51` |
| U189 | 같은 파일 → `+ "allowed": true`(PAID). 삼각측량(초과 지급·LEGACY) → `+ "allowed": true` | PAID·비확정은 NOT_ACTIONABLE. `paidAmount ≥ amount`도 NOT_ACTIONABLE | `15b5d51` |
| U182 | `npx jest src/refund/refund-result.integration.spec.ts -t '같은 금액의 새 PG 취소 요청을 만들어'` → `+ "payoutStatus": "ACTION_REQUIRED"`, 새 요청 없음(응답 스텁) | `RefundRetryService.retryByManager`: 역할 → 키 필수 → 없는 환불 404 → 멱등 실행(PAYOUT_RETRY, {refundId, reason}) 안에서 Refund 잠금·재판정 → `createRetryAttempt`(시도 번호+1·같은 금액·실행자·사유·전송 담당, 환불 PENDING/PG) → 커밋 뒤 `dispatch.sendPrepared`. 단위 504, E2E 124 | `e6e29c8` |
| U183 | 첫 통과 → 뮤턴트(새 요청 resendCount 5) `+ "resendCount": 5` | U182 구현 그대로 | `eab1ec9` |
| U190 | `npx jest src/refund/dto/retry-refund.dto.spec.ts` → `+ undefined`(사유 오류 없음) | trim·IsString·MinLength(1) | `707238e` |
| U192 | 같은 파일 → `- "reason"`(501자 허용) | MaxLength(500) | `707238e` |
| U191 | 첫 통과(경계 짝) → 뮤턴트 MaxLength(499)에서 실패 | — | `707238e` |
| U194 | `npx jest --config test/jest-e2e.json test/refund-operations.e2e-spec.ts` → `+ "status": 404`(경로 없음) | `RefundOperationsController` POST `:refundId/payout-retries`와 `RefundOperatorGuard`(본문 검증보다 먼저 MANAGER 확인, 아니면 REFUND_FORBIDDEN) | `707238e` |
| U193 | 첫 통과 → 뮤턴트(키 검사 제거) `+ "status": 202`, `+ "attempts": 2` | U182 서비스의 키 검사 | `707238e` |
| A77·A80·A81 | 첫 통과 → 뮤턴트: 전송 생략(`+ "sent": []`), 미확정 판정 제거, 일부 지급 판정 제거 → 각각 1 failed | — | `55d522e` |

- 리팩터: 접수 서비스 `sendAccepted`의 PG 호출·결과 반영을 `sendPrepared`로 합치려 했지만 되돌렸다. Phase 3 단위 spec(`refund-acceptance.service.spec.ts`)의 PG·전송 대역 단언을 바꿔야 해서다. 중복은 남아 있다.
- 이탈·메모:
  - 정책 함수의 U184~U189는 동작마다 red→green을 확인했지만 한 커밋으로 묶었다.
  - 테스트 준비 변경: `refund-result.integration.spec.ts` 공통 준비에 MANAGER 사용자와 멱등 기록 정리를 추가했다. 단언 변경은 없다.
  - 기존 `RoleGuard`는 역할 불일치에 401을 낸다. 계약의 403 REFUND_FORBIDDEN과 "사유 입력 여부와 관계없이" 조건을 위해 경로 전용 가드를 두었다. 기존 가드는 범위 밖이라 고치지 않았다.
  - 결제 전체 환불(PAYMENT 대상, orderItemId null)은 마지막 요청의 대상 상품으로 새 요청을 만든다. 요청이 하나도 없으면 NOT_ACTIONABLE이다. US6 전에 정할 미결 사항(PAYMENT 대상 orderItemId)과 연결된다.
- 결과: 단위 508 passed, E2E 129 passed(`55d522e`).

## US10 공통 PG 재요청 Codex 검수 1차 (2026-10-29)

- 범위 `ff8788d..b8a3cfd`. 판정 **수정 필요**: P2 2건.
  1. ACTION_REQUIRED가 아닌 환불(예: PENDING이지만 시도는 모두 FAILED)도 재시도를 허용한다. 계약 §5의 필수 조건이다.
  2. PENDING_APPROVAL 시도를 최종 상태처럼 취급한다("모든 PG 결과 최종" 조건 위반).
- U202 해석(QUERY_ERROR로 봄)은 타당하다는 의견을 받았다. 다음 단계에서 PG 응답 분류부터 확인한다.

| 동작 | red | green | 커밋 |
|---|---|---|---|
| U363 | `npx jest src/refund/refund-retry.policy.spec.ts` → `+ "allowed": true`(PENDING·시도 모두 확정) | 마지막 판정에 `payoutStatus ≠ ACTION_REQUIRED`를 추가해 NOT_ACTIONABLE. UNRESOLVED 우선순위는 유지 | `cf56742` |
| U364 | 같은 파일 → `+ "allowed": true`(PENDING_APPROVAL 시도) | 미확정 판정을 "최종 상태(SUCCEEDED·FAILED)가 아닌 시도"로 바꿨다 | `cf56742` |

- 결과: 단위 510, E2E 129 passed(`cf56742`).


## US10 공통 PG 재요청 Codex 검수 2차 (2026-10-29)

- 범위 `b8a3cfd..f7272c1`. 판정 **통과**. 다음 단계는 "US5 개별 확인 완료"(T130·T102, U195~U204, A78·A79, A53·A54)다.

## US5 개별 확인 완료 (실패 확정 시도의 새 요청) 사이클 (2026-10-29)

- 범위: T130·T102(실패 시도 부분), U195~U204, A78(QS-10-1a)·A79(QS-10-1b), 7a에서 남긴 A53(QS-5-18)·A54(QS-5-19)의 실패 시도 경로.
- 구현 흐름(`RefundRetryService.checkFailedAttempt`, pg-check에서 미확정 시도가 없을 때 호출):
  1. `findFailedRetryCandidate`: 최근 시도가 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED로 FAILED이고, 환불이 확정·PG 방식·검토 아님일 때만 대상이다.
  2. Refund 잠금 안에서 대상·담당·최근 조회 간격·`evaluatePayoutRetry`를 다시 확인한 뒤 실패 시도의 조회 담당을 맡는다.
  3. 트랜잭션 밖에서 조회한다.
  4. 결과 반영(Refund 잠금): 담당 토큰을 확인하며 해제하고, 조회 오류면 lastInquiryError를 저장한다.
     - 취소 성공·처리 중이면 `recordFailedAttemptConflict`(PG_RESULT_CONFLICT·검토 필요·운영자 알림)로 남긴다.
     - 미접수·거절 확정이면 재판정 뒤 `createRetryAttempt`로 새 요청을 만든다(실행자·개별 확인 재시도 사유·lastInquiryAt 승계).
  5. 커밋 뒤 `sendPrepared`. 반환값에 전송 결과 종류를 추가했다.

| 동작 | red(결정적 줄) 또는 뮤턴트 | green | 커밋 |
|---|---|---|---|
| U195 | `-t '실패가 확정된 요청의 개별 확인'` → NO_PENDING_ATTEMPT·새 요청 없음 | 위 흐름(미접수만) | `7eea428` |
| U196 | 첫 통과 → 뮤턴트(SEND_FAILED 제외) 1 failed | — | `dbefc49` |
| U197 | `- "resendResult": "ACCEPTED"`, `+ "sends": 0` | 거절 확정(FAILED)도 새 요청, 사유 문구 구분 | `dbefc49` |
| U198 | 첫 통과 → 뮤턴트(PG_NOT_REACHED 허용) 1 failed | — | `dbefc49` |
| U199 | `+ "lastInquiryFailed": false` | 담당 해제 때 조회 오류 사유 저장(정상 응답은 지움) | `dbefc49` |
| U200·U201 | `+ "actionCode": "RETRY_EXHAUSTED"`, `+ "operatorConflicts": 0` | 결과 서비스의 모순 기록을 트랜잭션 안에서 재사용, 거래 로그는 커밋 뒤 | `904a3bc` |
| U202 | `src/pg/pg.service.spec.ts` 첫 통과 → 뮤턴트(HTTP 200이면 모두 FAILED) 1 failed | — | `5c98453` |
| U203·U204 | 첫 통과 → 뮤턴트(PG 방식 조건 제거 / 조회 시각 승계 제거) 각 1 failed | — | `5c98453` |
| A78·A79·A53·A54 | 첫 통과 → 뮤턴트(처리 중 모순 기록 제거 / 한도 소진 개별 확인 제외 / 활성 예약 판정 제거 / 새 요청 전송 생략) 각 1 failed | — | `2ae5439` |

- 이탈·메모:
  - U202는 계약 §8에 따라 PG 응답 분류 단계에서 검증했다. 서비스의 QUERY_ERROR 처리는 U199다(검수 1차 Codex 의견 반영).
  - A53·A54는 기존 7a 테스트를 바꾸지 않고 같은 QS 번호의 테스트를 하나씩 더 두어 실패 시도 경로를 검증했다.
  - 테스트 도우미 `createFailedRefund`·`manager`를 최상위 범위로 옮겼다(이번 세션에서 만든 도우미이고 단언 변경은 없다).
  - T183은 A38·A47(US6) 때문에 아직 체크하지 않았다.
- 결과: 단위 520 passed, E2E 133 passed(`2ae5439`).

## US5 개별 확인 완료 Codex 검수 (2026-10-29)

- 범위 `3c7927f..919cf0b`. 판정 **통과**. 동작상 추가 지적은 없다. 지적된 문서 끝 빈 줄은 이 기록에서 정리했다.
- 다음 권장 순서: US6(A38·A47, 승인 금액 불일치 자동 취소) → US10 외부 지급(별도 지급 예약·증빙·미지급 종료·초과 검토, A82 포함) → US7 → US8·US9 → 최종.

## US6 승인 금액 불일치의 자동 취소 사이클 (2026-10-29)

- 사용자 결정:
  1. **PAYMENT 대상 연결**: `payment_cancels.order_item_id`를 nullable로 바꾸고, 환불에 연결된 행은 환불의 대상 상품과 같아야 한다는 DB 검사를 둔다. 다른 테이블과 비교해야 해서 CHECK 대신 검사 트리거 `payment_cancels_refund_target_check`로 구현했다.
  2. **기존 payment spec 3개 변경**: 불일치 예외 단언 → 수신 확인. 과거 `refundBySystem` 단언 2개 → 새 공통 흐름 단언.
  3. **seat-type E2E QS-31 변경**: 승인 직후 이용 종료·상품 대상 SYSTEM 환불을 단언한다.

| 동작 | red(결정적 줄) 또는 뮤턴트 | green | 커밋 |
|---|---|---|---|
| U365 | 타입 오류(무효) → 일시 캐스트로 실행 시점 확인: `Argument payment is missing`(null 불허) | 스키마 `String?`·`OrderItem?`(`onDelete: Restrict`로 FK 유지), 마이그레이션 DROP NOT NULL | `6a87426` |
| U366 | `Received promise resolved instead of rejected` | 마이그레이션: 기존 데이터 검증 DO 블록 + 검사 함수·BEFORE INSERT/UPDATE 트리거 | `0548928` |
| U367 | `RefundPayoutNotActionableError`(PAYMENT 대상 거절) | 새 요청의 대상 상품 = 환불의 대상 상품(마지막 요청으로 대체하던 것 제거) | `62bf517` |
| U368 | (기존 단언 변경 뒤) `Received promise rejected instead of resolved` — PaymentAmountMismatchError | 불일치 분기에서 예외 대신 수신 확인 | `783f12f` |
| U176 | 결제 실패·승인액 저장·환불 확정 호출 없음 | `failMismatchAndStartRefund`: 결제 잠금(`lockForApproval`) → `failApprovalMismatch`(FAILED·approvedAmount) → 선점 해제 → `RefundSystemService.acceptPaymentMismatch`(`createPaymentTargetRefund`: PAYMENT·SYSTEM·ACCEPTED·PENDING·시도 1·전송 담당) → 커밋 뒤 전송 | `8f69ea1` |
| U174 | 첫 통과 → 뮤턴트(불일치 뒤 승인 흐름 진행) 1 failed | — | `270552e` |
| U178 | `PaymentAlreadyClosedError` | 실패 결제·같은 승인액의 성공 콜백은 수신 확인만(동시 콜백은 결제 잠금 뒤 재확인) | `270552e` |
| U179 | (기존 단언 (2)(3) 변경 뒤) `acceptSeatAssignmentFailure` 호출 없음. 전체 suites에서 seat-type QS-31 red → 사용자 결정으로 단언 변경 | 승인 트랜잭션에서 미배정 이용권마다 `acceptSeatAssignmentFailure`(`findLockedTarget` + `confirmAcceptedRefund`, SYSTEM·실행자 null·실결제액) → 커밋 뒤 `sendSystemRefund`(실패 시 SYSTEM_REFUND_REQUEST_FAILED 로그). `createAcceptedRefund`는 SYSTEM이면 이용 종료 동의 시각 null. 결제 서비스의 과거 `RefundService` 의존 제거 | `8eb545b` |
| A56~A59·U181·A38·A47 | 첫 통과 → 뮤턴트: 선점 해제 생략 / 환불 금액 변경(QS-6-2, 첫 뮤턴트인 시도 금액 변경은 생존 — 지급 완료 판정이 환불 금액 기준이라서) / 시도 금액 변경(QS-6-3) / 같은 금액을 불일치로 처리 / 환불 확정을 트랜잭션 밖으로 / 자동 재전송 금지 / 실패 알림 생략 → 각 1 failed | — | `25c31eb` |

- 이탈·메모:
  - U173·U175·U177은 U176의 저장 단언, 변경한 기존 테스트, 기존 승인 테스트로 확인했다.
  - seat-type QS-31의 "PG 취소 확정 뒤 지급 완료" 단계는 뺐다. 그 파일은 PG 대역 없이 미연동 `PgService`를 써서 최초 전송이 SEND_FAILED가 된다. 이 단계는 QS-6-2에서 PG 대역으로 검증한다(사용자 결정 내용과 다른 점).
  - 결제 콜백 응답은 기존 201을 유지했다. 계약 §7 문구("200 수신 확인")와 다르며, 바꾸려면 기존 E2E 도우미·테스트의 기대 상태도 함께 바뀐다. 보고 항목이다.
  - `payment.service.ts`의 기존 린트 오류 1건(`requestPayment`의 `throw Error;`)은 범위 밖이라 그대로 두었다. 커밋 때 오류 개수가 늘지 않았음을 확인했다.
  - U176·U178 커밋 직전, 테스트 파일의 타입 단언만 고친 뒤(로직 변경 없음) 직전 green 결과로 커밋했다.
  - E2E 도우미: `issueTicket`에서 `orderAwaitingApproval`을 분리했다(동작 동일).
  - US5 인수 A34~A55가 모두 DONE이 되어 T183을 체크했다.
- 결과: 단위 526, E2E 140 passed(`25c31eb`).

## US6 Codex 검수 1차 (2026-10-29)

- 범위 `ebc4137..916e042`. 판정 **수정 필요**: P2 3건.
  1. 결제 콜백이 계약 §2·§7의 200 대신 201을 반환한다.
  2. SYSTEM 실패 알림이 점주(SHOP)에게도 저장된다. 계약 §9는 MANAGER만이다. QS-5-12가 추가 수신자를 검출하지 못한다.
  3. 승인 콜백 금액에 정수 검증이 없다(1000.5 허용).
- 사용자 결정(1번): **"계약대로 200, 기대값 변경"**. 기존 E2E(ticket-pause, seat-type, 공용 도우미)의 결제 콜백 기대값을 201에서 200으로 바꾼다.

| 동작 | red | green | 커밋 |
|---|---|---|---|
| U369 | `+ "SHOP"`(SYSTEM 실패 알림) | `notifyPayoutAction`에서 SYSTEM이면 운영자만. QS-5-12는 수신자를 정확히 비교하도록 강화 | `e4ff2e9` |
| U370 | `- "amount"`(1000.5 허용) | `@IsNumber` → `@IsInt` | `34d4935` |
| U371 | 기대값 변경 뒤 `expected 200 "OK", got 201 "Created"` | 결제 콜백에 `@HttpCode(200)` | `f5d4c25` |

- 결과: 단위 528, E2E 140 passed(`f5d4c25`).

## US6 Codex 검수 2차 (2026-10-29)

- 범위 `916e042..07de33d`. 판정 **통과**. US6과 US5(T183)가 모두 완료됐다.
- 다음 권장 순서: US10 외부 지급(별도 지급 예약·증빙·미지급 종료·초과 검토·장기 미확인 알림, A82~A92) → US7 → US8·US9 → 최종.

## US10 외부 지급(별도 지급 예약·결과 등록·미지급 확인·초과 취소 검토·장기 미확인 알림) 사이클 (2026-10-29)

- 범위: T117~T128, T132~T138, T185, U205~U224, A82~A92.
- 진행 중 추가한 동작: U372(없는 예약 404), U373(종료된 예약 409), U374(등록 금액 불일치 400). 모두 계약 §10에 코드가 있지만 단위 목록에 없던 것이다.

| 동작 | red(결정적 줄) 또는 뮤턴트 | green | 커밋 |
|---|---|---|---|
| U207·U206 | 정책 spec `+ "allowed": true` / `+ "outstandingAmount": 11999`. 삼각측량: 지급 완료·초과 지급 허용 | `hasUnresolvedPayout`을 재시도 판정에서 꺼내 공유. 미지급액 = amount - paidAmount, 0 이하면 재처리 불가 | `c0c0fd5` |
| U205 | 예약 없음·PG 방식(스텁 응답) | `reserveManualPayout`: 역할→키→404→멱등→잠금·판정→RESERVED·payoutMethod MANUAL, 201 | `88ec04e` |
| U208 | 예약 RESERVED·원장 없음 | `confirmManualPayout` 정상 흐름: 성공 확정·원장(manualRefundPayoutId)·지급 합계, 미지급 0이면 PAID | `0c392b5` |
| U212·U213·U214·U372·U373·U374 | 증빙 없이 PAID / 원장 고유 위반 / `P2002` / 다른 환불 예약으로 성공 / 200 / 성공 응답 | 증빙 필수, 같은 결과 반복은 저장 결과, 거래 ID 재사용(동시 경쟁 P2002도 변환), 없는 예약, RESERVED 아님, 금액 불일치 | `9308239` |
| U215 | 검토 미완료 | 미지급 0이 되면 이 증빙으로 부족 지급 검토 완료(검토자·시각·증빙) | `6d1f9b1` |
| U216·U217 | RESERVED 그대로 / 증빙 없이 성공 | `markManualPayoutNotPaid`: 근거 필수, RESERVED만 FAILED, 환불·지급액 그대로 | `a6ad694` |
| U219·U220 | ACTION_REQUIRED·검토 기록 없음 / 성공 응답 | `reviewRefundAmount`: 미확정 지급 UNRESOLVED, 검토 대상 아님·부족액 REVIEW_INCOMPLETE, 검토 기록·PAID | `870278d` |
| U221·U222·U223·U218 | 알림 0 / 첫 통과→뮤턴트(기준 1초 앞당김) / sweep 알림 0 / 뮤턴트(알림 때 예약 FAILED) | `alertUnconfirmedManualPayouts`(예약 ID 사건 키, OPERATOR, MANUAL_CONFIRMATION_REQUIRED), sweep 끝에서 호출 | `354ca06` |
| U209·U210·U211 | 오류 필드 [undefined] / 첫 통과→뮤턴트(199) / 201자 허용 | `ConfirmManualPayoutDto`(MaxDate 현재·거래 ID 1~200·증빙 1000). DTO spec에 `reflect-metadata` import | `59ba01c` |
| U224 | 경로 없음 404 | 경로 4개(RefundOperatorGuard·멱등 키 헤더)와 DTO 3개 | `0b352ac` |
| A82 | `+ "REFUND_PAYOUT_NOT_ACTIONABLE"`(처리 중 환불의 예약) | 예약 판정 순서를 재시도와 같게(지급 완료·비확정 → 미확정 지급 → 조치 필요 아님) | `74ab217` |
| A83~A92 | 첫 통과 → 뮤턴트 각 1개 이상 실패(가드는 이중 방어라 가드+서비스 역할 확인을 함께 해제해 확인) | — | `74ab217` |

- 이탈·메모:
  - U208 첫 실행 때 이 통합 테스트의 `afterAll`이 원장보다 별도 지급을 먼저 지워 FK 오류로 정리가 중단됐다. 남은 조회 대기 데이터 때문에 59/60초 정기 탐색 테스트가 실패했다. 정리 순서를 고치고, 공유 DB에 남은 이 테스트 사용자 12명 범위의 데이터를 `afterAll`과 같은 순서로 한 트랜잭션에서 정리했다.
  - 새 DTO 3개(예약·미지급 확인·검토)의 형식 규칙은 단위 테스트가 없다. 계약에 길이 규칙이 따로 없는 사유는 재시도와 같은 1~500자로 맞췄다.
  - 거래 ID 동시 등록 경쟁(P2002) 변환 경로는 테스트가 없다.
  - 잠금 뒤 재조회 코드(`lockPayoutTarget`)가 재시도 서비스의 `lockRetryTarget`과 같다. 리팩터 후보다.
  - 미지급 확인·검토 요청에서도 근거가 없으면 MANUAL_PAYOUT_EVIDENCE_REQUIRED로 거절한다(계약 §10 '실제 지급·확실한 미지급 증빙 누락'을 검토 근거에도 적용).
- 결과: 단위 552, E2E 152 passed(`74ab217`).

## US10 외부 지급 Codex 검수 1차 (2026-10-29)

- 범위 `bccc4d2..70074c9`. 판정 **수정 필요**: P1 1건, P2 3건.
  1. [P1] 지급 결과 등록이 PG 결과 모순까지 해제한다(예약 뒤 모순이 생겨도 PAID·검토 해제).
  2. [P2] 지급 시각에 ISO 문자열이 아닌 값(0, false)이 1970년 날짜로 변환돼 통과한다.
  3. [P2] 탐색 뒤 지급 결과가 등록된 예약에도 장기 미확인 알림이 저장될 수 있다.
  4. [P2] 장기 미확인 사건의 거래 로그가 없다(FR-037).

| 동작 | red | green | 커밋 |
|---|---|---|---|
| U375 | `+ "PAID"`, 검토 해제 | actionCode PG_RESULT_CONFLICT면 지급 완료·검토 완료로 바꾸지 않음(지급액·원장만 반영) | `e8348eb` |
| U376 | 0·false 통과(2 failed) | `@Type` 대신 ISO8601(strict) 문자열만 Date로 바꾸는 변환 | `c551784` |
| U377·U378 | 완료된 예약에 알림 1 / 거래 로그 없음(2 failed). 뮤턴트(재확인 제거·로그 생략) 각 1 failed | 알림 트랜잭션에서 Refund·예약 잠금 뒤 상태 재확인. `recordNotification`이 새 저장 여부를 돌려주고, 새 알림이면 커밋 뒤 거래 로그 | `91749d0` |

- 결과: 단위 557, E2E 152 passed(`91749d0`).

## US10 외부 지급 Codex 검수 2차 (2026-10-29)

- 범위 `70074c9..395b8e6`. 판정 **수정 필요** 1건(P2): 날짜만 있거나 시간대가 없는 지급 시각("2026-01-01", "2026-01-01T12:30:00")도 허용된다.
- U379 red: 두 값 통과(2 failed). +09:00 정상 변환 테스트는 첫 통과.
- U379 green: 날짜·시각·시간대(Z/±hh:mm) 정규식과 ISO8601(strict)을 모두 만족할 때만 Date로 바꾼다. 커밋 `502f943`.
- 결과: 단위 560, E2E 152 passed.

## US10 외부 지급 Codex 검수 3차 (2026-10-29)

- 범위 `395b8e6..6a1c34e`. 판정 **통과**. US10 전체(T112~T138, T185)가 완료됐다.
- 다음 권장 순서: US7(PG 콜백 서명 인증) → US8·US9 → 최종 검증.

## US7 PG 콜백 서명 인증 사이클 (2026-10-29)

- 사용자 결정: 기존 E2E 9곳(ticket-pause·seat-type 포함)의 콜백 요청은 서명 도우미(`test/helpers/pg-callback.ts`의 `signedCallback`)로 바꾼다. 테스트 앱 생성에 `rawBody: true`를 넣는다. 단언은 바꾸지 않는다.
- 진행 중 추가한 동작: U380(서명 시각이 십진 Unix 초가 아니면 거절). 'abc'로 서명한 요청이 NaN 시각 검사를 통과하던 결함이다.

| 동작 | red(결정적 줄) 또는 뮤턴트 | green | 커밋 |
|---|---|---|---|
| U225 | `Received: "DENIED"` | 가짜 구현(true) | `8cb3fe8` |
| U226 | `Received: "PASS"` | 원문 바이트 sha256 canonical·HMAC-SHA256·`timingSafeEqual`. 설정 대역을 키별로 바꾸자 잘못된 키로 2 failed → `pgCallback.secret` 설정 추가 | `8cb3fe8` |
| U227~U231 | 첫 통과 → 뮤턴트(키 정렬 정규화 해시 — 테스트 원문을 정렬된 본문으로 바꿔 재시도 / 서명 없으면 통과 / 중복 헤더 첫 값 / 받은 길이만 비교 / 대소문자 무시) 각 1 failed | — | `5a8834d` |
| U233·U234·U232 | `Received: "PASS"`(2) / 첫 통과→뮤턴트(>=) | `|now - ts| > pgCallback.maxSkewSeconds`면 PG_CALLBACK_EXPIRED | `64ce4c5` |
| U380 | `Received: "PASS"` | 서명 시각 `/^\d+$/` 아니면 UNAUTHORIZED | `64ce4c5` |
| U235·U236 | `Received: "PASS"`(2) | Content-Encoding(identity 외)·URL의 `?`면 PG_CALLBACK_FORMAT_INVALID(400), 서명 확인보다 먼저 | `4ec59b7` |
| U237·A62 | JWT만 있는 환불 콜백이 200·PAID 반영 | 두 콜백에 `@Public()`+`@UseGuards(PgSignatureGuard)`, `main.ts`의 `rawBody: true`, 기존 E2E 서명 도우미 전환 | `264f8f0` |
| A60·A61·A63·만료 재서명·중복·U238 | 첫 통과 → 뮤턴트(canonical 메서드 GET 고정 / 서명 없으면 통과 / 결제 콜백 가드 제거 / 시각 검사 해제) 각 1 failed | — | `b4fc9ca` |
| 저장 실패 503 | 결제 콜백 `500 INTERNAL_SERVER_ERROR` | `isDomainError`를 `common/errors`로 옮기고, 결제 콜백도 도메인 오류 외 저장 실패를 REFUND_STORAGE_UNAVAILABLE(503)로 | `b4fc9ca` |

- 이탈·메모:
  - 중복 통보 1회 반영은 기존 공통 결과 처리(미확정 시도에만 반영)에 의존한다.
  - 로그 미노출(U238)은 현재 상태를 확인한 테스트다(가드는 아무것도 로그에 남기지 않는다). 뮤턴트로 확인하지 않았다.
  - `Content-Type: application/json` 강제는 하지 않았다(대상 동작에 없음).
  - `payment.service.ts`의 기존 린트 오류(`throw Error;`)는 그대로 두었고, 오류 수가 늘지 않았음을 확인했다.
  - `.env.example`의 `PG_CALLBACK_SECRET`은 사용자 미커밋 변경이 있는 파일이라 건드리지 않았다(항목은 이미 있음).
- 결과: 단위 573, E2E 160 passed(`b4fc9ca`).

## US7 Codex 검수 1차 (2026-10-29)

- 범위 `4596505..31e5481`. 판정 **수정 필요**: P2 2건.
  1. Content-Type(application/json) 계약을 검사하지 않는다.
  2. 시스템 자동 취소의 커밋 뒤 전송 결과 저장이 실패해도 결제 콜백이 200으로 끝난다(503 요구).
- 1번 → U381 red: text/plain PASS. green: 미디어 타입이 application/json(매개변수 허용)이 아니면 FORMAT_INVALID. 커밋 `09779f2`.
- 2번 → 사용자 결정 **"200 유지"**. 근거는 다음과 같다.
  - 그 시점에는 결제·환불 확정·최초 요청(전송 시도·담당 기한)이 이미 커밋돼 있다.
  - PG가 재전송해도 이미 반영된 승인 사건이라 아무것도 하지 않는다.
  - 재처리는 담당 기한이 지난 뒤 자동 조회가 맡는다.
  - 계약 §7의 503은 업무 저장 자체가 실패한 경우(이미 503 처리)를 위한 것이다.
- 결과: 단위 574, E2E 160 passed.

## US7 Codex 검수 2차 (2026-10-29)

- 범위 `31e5481..42cc1e6`. 판정 **통과**. 다음 권장 순서: US8(환불 내역 조회 권한)·US9(환불 상태와 수신자별 알림) → 최종 검증.

## US8 환불 내역 조회 권한 재개 (2026-10-29)

- 범위: T147~T155·T187, U239~U249·A64~A68. 기준 커밋 `1dd2d5a9d8882c6a9ca19d23f5c31066561e0266`.
- 기준선: `npm run test` 49 suites·574 passed(20.127s), `npm run test:e2e` 12 suites·160 passed(16.95s). 공유 DB 테스트는 직렬 실행한다.
- 사용자 미커밋 변경(.env.example·.gitignore·.vscode/settings.json·정책 이동·deferred-changes.md)은 보존한다. 최종 PG·이관·전체 인수·운영 증빙 체크 4개는 완료로 바꾸지 않고, 사용자가 지정한 US8 구현 범위만 진행한다.
- A64 바깥 루프 red: `npx jest --config ./test/jest-e2e.json test/refund-history.e2e-spec.ts -t QS-8-1` → `expected 200 "OK", got 400 "Bad Request"`, `Tests: 1 failed, 1 total`. 기존 조회는 선택적인 상태 쿼리가 없을 때도 400이며 새 환불 식별자 기반 목록이 없다.


### A64

- 구현: 현재 점주/운영자의 매장 범위를 확인하고 Refund 기준 `{items}`를 반환한다. 3계층 연결을 첫 HTTP 동작에서 함께 추가했다(한 파일보다 큰 수직 구현 단계였음).
- 전체 회귀: `npx jest --runInBand` 574 passed, `npx jest --config ./test/jest-e2e.json --runInBand` 161 passed. 리팩터링 없음.
- 실행 메모: 첫 병렬 단위 실행은 복구 전역 조회에 다른 통합 테스트 데이터가 섞여 3 failed·571 passed. 코드를 바꾸지 않고 전체를 직렬 실행하면 574 passed. 이후 전체 단위는 직렬 실행하며 테스트를 제외하지 않는다.

- 실패 근거: `expected 200 "OK", got 400 "Bad Request"` (앞의 A64 red 명령)

- A64 구현·회귀 커밋: `398fbec`.

### U240 red

- 명령: `npx jest src/refund/dto/get-refund-query.dto.spec.ts -t U240`
- 실제 출력: `- "limit": 20`, `- "page": 1`, `+ "limit": undefined`, `+ "page": undefined`; `Tests: 1 failed, 1 total`.

- U240 회귀 중 환경 간섭: 전체 단위 직렬 실행에서도 `4 failed, 571 passed, 575 total`. 예상 밖 PG 취소 요청 ID를 조회했으나 실행 종료 후 DB에서는 해당 행이 없었다. VS Code Jest 확장이 `--watch`로 동일 저장소 테스트를 동시에 실행 중임을 PID 53269·53480의 실제 명령으로 확인했다. 단순 병렬 파일 실행만의 문제라는 앞의 추정은 불충분했으며, watch 중단 뒤 단독 회귀로 확인한다.

### U240

- 기본 page=1·limit=20과 실제 skip/take·페이지 메타를 연결했다. 공개 정렬/경계는 다음 동작에서 검증한다.
- 전체 회귀: Test Suites: 50 passed, 50 total / Tests:       575 passed, 575 total / Time:        20.09 s; Test Suites: 13 passed, 13 total / Tests:       161 passed, 161 total / Time:        22.182 s. 리팩터링 없음.

- 실패 근거: `npx jest src/refund/dto/get-refund-query.dto.spec.ts -t U240` → `+ "limit": undefined`, `+ "page": undefined`, 1 failed.

- U240 구현·회귀 커밋: `9cf941d`.

### U242 red

- `npx jest src/refund/dto/get-refund-query.dto.spec.ts -t U242` → `Expected value: "limit"`, `Received array: []`; `Tests: 1 failed`.

### U242

- limit 상한 100을 DTO에서 검증한다.
- 전체 회귀: Test Suites: 50 passed, 50 total / Tests:       576 passed, 576 total / Time:        16.099 s, estimated 20 s; Test Suites: 13 passed, 13 total / Tests:       161 passed, 161 total / Time:        16.259 s, estimated 21 s. 리팩터링 없음.

- 실패 근거: 위 U242 red 참조.

- U242 구현·회귀 커밋: `f3214fb`.

### U243 red

- `npx jest src/refund/dto/get-refund-query.dto.spec.ts -t U243` → `Expected value: "limit"`, `Received array: []`; 1 failed.

### U243

- limit 최솟값을 1로 검증한다.
- 전체 회귀: Test Suites: 50 passed, 50 total / Tests:       577 passed, 577 total / Time:        15.979 s, estimated 16 s; Test Suites: 13 passed, 13 total / Tests:       161 passed, 161 total / Time:        17.118 s. 리팩터링 없음.

- 실패 근거: 위 U243 red 참조.

- U243 구현·회귀 커밋: `2a46bc7`.

### U241 경계 뮤턴트

- 최초 `npx jest src/refund/dto/get-refund-query.dto.spec.ts -t U241`는 1 passed(앞선 U242 상한 구현이 이미 허용).
- `@Max(100)`을 일시적으로 99로 바꾸자 같은 명령에서 `"max": "limit must not be greater than 99"`, 1 failed. 100으로 원복했다.

### U241

- 허용 최대값 100의 변환·검증을 경계 테스트로 고정했다. 운영 구현 변경 없음.
- 전체 회귀: Test Suites: 50 passed, 50 total / Tests:       578 passed, 578 total / Time:        16.488 s; Test Suites: 13 passed, 13 total / Tests:       161 passed, 161 total / Time:        16.653 s, estimated 17 s. 리팩터링 없음.

- 실패 근거: 위 U241 경계 뮤턴트 참조.

- U241 구현·회귀 커밋: `07987cc`.

### A65 현재 점주 범위 뮤턴트

- `npx jest --config ./test/jest-e2e.json test/refund-history.e2e-spec.ts -t QS-8-2` 최초 1 passed(A64 범위 구현). 점주 필터를 일시 제거하면 `expected 404 "Not Found", got 200 "OK"`, 1 failed. 원복했다.
- 다른 매장과 ShopOwner 해제 뒤의 재요청을 같은 범위 시나리오에서 검증한다.

### A65

- 소유하지 않거나 소유 관계가 해제된 매장은 404 SHOP_NOT_FOUND를 반환하는지 HTTP로 검증했다.
- 전체 회귀: Test Suites: 50 passed, 50 total / Tests:       578 passed, 578 total / Time:        14.362 s, estimated 17 s; Test Suites: 13 passed, 13 total / Tests:       162 passed, 162 total / Time:        16.968 s. 리팩터링 없음.

- 실패 근거: 위 A65 범위 뮤턴트 참조.

- A65 구현·회귀 커밋: `41cdd78`.

### A66 red

- `npx jest --config ./test/jest-e2e.json test/refund-history.e2e-spec.ts -t QS-8-3` → `expected 200 "OK", got 404 "Not Found"`; 1 failed.

### A66

- /refund/me는 JWT 본인 주문으로 범위를 고정한다. 명시적 응답 DTO에 환불 확정·지급 합계·미지급·초과·종료 시각·현재 PG 시도를 연결했다.
- 전체 회귀: Test Suites: 50 passed, 50 total / Tests:       578 passed, 578 total / Time:        14.035 s, estimated 15 s; Test Suites: 13 passed, 13 total / Tests:       163 passed, 163 total / Time:        14.31 s, estimated 16 s. 리팩터링 없음.

- 실패 근거: 위 A66 red 참조.

- A66 구현·회귀 커밋: `d743285`.

### A67 red

- `npx jest --config ./test/jest-e2e.json test/refund-history.e2e-spec.ts -t QS-8-4` → `expected 403 "Forbidden", got 200 "OK"`; 1 failed. 본인 목록 분리와 userId 쿼리 400은 먼저 통과했으나 기존 user 경로가 다른 고객 조회를 허용했다.

### A67

- USER의 user/:userId 조회를 403으로 차단하고 MANAGER 조회는 사용자 존재를 확인한 뒤 주문 범위로 제한했다. /me의 본인 분리와 미허용 userId 쿼리 거절도 HTTP로 확인했다.
- 전체 회귀: Test Suites: 50 passed, 50 total / Tests:       578 passed, 578 total / Time:        13.543 s, estimated 14 s; Test Suites: 13 passed, 13 total / Tests:       164 passed, 164 total / Time:        13.04 s, estimated 14 s. 리팩터링 없음.

- 실패 근거: 위 A67 red 참조.

- A67 구현·회귀 커밋: `4bbb514`.

### A68 운영자 범위 뮤턴트

- `npx jest --config ./test/jest-e2e.json test/refund-history.e2e-spec.ts -t QS-8-5` 최초 1 passed. MANAGER에게도 점주 관계를 요구하는 변형에서 `expected 200 "OK", got 404 "Not Found"`, 1 failed. 원복했다. 서로 다른 매장·고객 각각의 목록을 확인한다.

### A68

- 운영자의 서로 다른 매장·사용자 환불 조회를 HTTP에서 검증했다. 업무 결정 변경 없음.
- 전체 회귀: Test Suites: 50 passed, 50 total / Tests:       578 passed, 578 total / Time:        13.646 s, estimated 14 s; Test Suites: 13 passed, 13 total / Tests:       165 passed, 165 total / Time:        13.1 s. 리팩터링 없음.

- 실패 근거: 위 A68 운영자 범위 뮤턴트 참조.

- A68 구현·회귀 커밋: `f74ba2e`.

### U239 red

- `npx jest src/refund/refund-query.service.spec.ts -t U239` → 기대한 `"orderBy": [{"requestedAt": "desc"}, {"id": "desc"}]`가 호출 인자에 없으며 1 failed. 페이지를 자르기 전 DB 정렬을 데이터 접근 경계에서 확인한다.

### U239

- requestedAt DESC,id DESC를 DB에 전달하여 정렬 뒤 페이지를 자른다. 저장소 쿼리 경계는 목으로 검증하며 실제 DB 페이지 결과는 추가 HTTP 검증에서 확인한다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       579 passed, 579 total / Time:        14.587 s; Test Suites: 13 passed, 13 total / Tests:       165 passed, 165 total / Time:        16.039 s. 리팩터링 없음.

- 실패 근거: 위 U239 red 참조.

- U239 구현·회귀 커밋: `7011afc`.

### U244 빈 목록 뮤턴트

- `npx jest src/refund/refund-query.service.spec.ts -t U244` 최초 1 passed. 빈 목록을 찾을 수 없음으로 바꾸는 변형에서는 `Received promise rejected instead of resolved`, 1 failed. 변형 원복.

### U244

- 권한 안 빈 목록은 오류가 아니라 items=[]·total=0이다. GET의 200 연결은 기존 HTTP 조회 테스트와 함께 확인한다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       580 passed, 580 total / Time:        14.362 s, estimated 15 s; Test Suites: 13 passed, 13 total / Tests:       165 passed, 165 total / Time:        19.502 s. 리팩터링 없음.

- 실패 근거: 위 U244 빈 목록 뮤턴트 참조.

- U244 구현·회귀 커밋: `38c4b4b`.

### U382 red (기존 상세 계약의 누락 동작 추가)

- `npx jest --config ./test/jest-e2e.json test/refund-history.e2e-spec.ts -t U382` → `expected 200 "OK", got 404 "Not Found"`; 1 failed. 기존 U239~U249에는 상세 경로의 접근 범위/이력 검증이 없어 계약 §2·3을 근거로 추가했다.

### U382

- /refund/:refundId를 고정 경로 뒤에 연결했다. 본인 주문·현재 공동 점주·운영자에게 PG/외부 지급 이력을 반환하고, 다른 사람·해제된 점주·없는 환불은 같은 404로 거절한다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       580 passed, 580 total / Time:        13.801 s, estimated 15 s; Test Suites: 13 passed, 13 total / Tests:       166 passed, 166 total / Time:        12.497 s, estimated 19 s. 리팩터링 없음.

- 실패 근거: 위 U382 red 참조.

- U382 구현·회귀 커밋: `889b3f7`.

### U246 금액 뮤턴트

- `npx jest src/refund/refund-query.service.spec.ts -t U246` 최초 1 passed(A66 금액 응답 구현). 실제 지급액을 빼지 않는 변형에서 `- "outstandingAmount": 300`, `+ "outstandingAmount": 1000`, 1 failed. 원복했다. 0·일부·초과 지급을 같은 계산 규칙으로 검증한다.

### U246

- 확정액에서 실제 지급 합계를 뺀 미지급액과 반대 방향의 초과액을 모두 0 이상으로 표시한다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       581 passed, 581 total / Time:        16.486 s; Test Suites: 13 passed, 13 total / Tests:       166 passed, 166 total / Time:        18.915 s. 리팩터링 없음.

- 실패 근거: 위 U246 금액 뮤턴트 참조.

- U246 구현·회귀 커밋: `722b3e2`.

### U248 red

- `npx jest src/refund/refund-query.service.spec.ts -t U248` → `- "outstandingAmount": 0`, `+ "outstandingAmount": 1000`, 1 failed. 과거 거절은 NOT_APPLICABLE이므로 미지급으로 집계하지 않는 계약 §3을 확인한다.

### U248

- LEGACY_REJECTED의 policyVersion·null 종료/확정 시각을 보존하고 NOT_APPLICABLE의 미지급액은 0으로 표시한다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       582 passed, 582 total / Time:        14.954 s, estimated 17 s; Test Suites: 13 passed, 13 total / Tests:       166 passed, 166 total / Time:        17.403 s, estimated 18 s. 리팩터링 없음.

- 실패 근거: 위 U248 red 참조.

- U248 구현·회귀 커밋: `5c00c0f`.

### U247 red

- `npx jest src/refund/refund-query.service.spec.ts -t U247` → `- "actionReason": "비공개 운영 원문"`, `+ "actionReason": null`, 운영 증빙/오류 필드 누락, 1 failed. 원문은 MANAGER만, 고객·점주는 조치 코드에 대응하는 안전한 설명만 받도록 검증한다.

### U247

- 반환 필드를 명시하여 고객·점주에게 원본 오류/증빙/검토 사유를 내보내지 않는다. MANAGER만 상세 운영 필드를 받고, 고객·점주는 조치 코드와 안전한 조치 설명을 받는다. 담당 토큰·멱등 키는 운영자에게도 반환하지 않는다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       583 passed, 583 total / Time:        14.724 s, estimated 15 s; Test Suites: 13 passed, 13 total / Tests:       166 passed, 166 total / Time:        16.657 s, estimated 17 s. 리팩터링 없음.

- 실패 근거: 위 U247 red 참조.

- U247 구현·회귀 커밋: `d45ded2`.

### U249 red

- `npx jest src/refund/refund-query.service.spec.ts -t U249` → 기대한 `"AND"` 상태/조치 필터 대신 `{"payment": {"order": {"userId": "customer"}}}`만 전달돼 1 failed. FAILED 시도만 있다는 이유로 미지급 Refund를 제외하지 않는 쿼리를 검증한다.

### U249

- 지급/결정 상태와 운영자 전용 actionRequiredOnly를 같은 조회 범위 안에서 적용한다. 실패 PG 시도를 필터 조건으로 제외하지 않고 ACTION_REQUIRED·RESERVED를 포함한다. 이전 PaymentCancel status 쿼리는 새 계약의 상태 필터로 교체했다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       584 passed, 584 total / Time:        14.455 s, estimated 15 s; Test Suites: 13 passed, 13 total / Tests:       166 passed, 166 total / Time:        16.165 s. 리팩터링 없음.

- 실패 근거: 위 U249 red 참조.

- U249 구현·회귀 커밋: `904848b`.

### U245 미허용 필드 뮤턴트

- `npx jest src/refund/dto/get-refund-query.dto.spec.ts -t U245` 최초 1 passed. userId를 허용 필드로 임시 추가하면 `Expected value: "userId"`, `Received array: []`, 1 failed. 원복했다. HTTP 400은 A67에서도 검증했다.

### U245

- 목록 DTO에서 userId를 허용하지 않고 /me의 JWT 범위 고정과 함께 다른 고객 지정 경로를 막는다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       585 passed, 585 total / Time:        17.346 s; Test Suites: 13 passed, 13 total / Tests:       166 passed, 166 total / Time:        18.046 s. 리팩터링 없음.

- 실패 근거: 위 U245 미허용 필드 뮤턴트 참조.

- U245 구현·회귀 커밋: `a6f67b4`.

### U383 red (목록 쿼리 계약 경계 추가)

- `npx jest src/refund/dto/get-refund-query.dto.spec.ts -t U383` → page=0에서 `- "valid": false`, `+ "valid": true`, 1 failed. DTO 형식 규칙은 기존 U 목록의 limit 경계 외에도 계약 §9의 페이지 범위를 확인한다.

### U383

- page>=1을 DTO에 추가하고 정수·상태 enum·boolean 형식의 잘못된 쿼리를 거절하는지 확인했다. 새 업무 조건이 아니라 목록 계약의 누락 검증이다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       586 passed, 586 total / Time:        16.231 s, estimated 18 s; Test Suites: 13 passed, 13 total / Tests:       166 passed, 166 total / Time:        18.389 s. 리팩터링 없음.

- 실패 근거: 위 U383 red 참조.

- U383 구현·회귀 커밋: `fa0aaef`.

### U384 실제 DB 페이지·필터 검증

- `npx jest --config ./test/jest-e2e.json test/refund-history.e2e-spec.ts -t U384` 최초 1 passed. 같은 신청 시각의 ID 정렬을 ASC로 바꾸면 `"refundId"` 기대/실제 값이 달라 1 failed. 원복했다.
- 실제 환불 API로 실패 3건·처리 중 1건과 외부 지급 예약을 만들고, 상태/결정 필터·actionRequiredOnly true/false·페이지 합계·비운영자 403·page=0 400을 HTTP에서 확인한다.

### U384

- 실제 DB에서 조회 필터와 정렬 뒤 페이지가 함께 동작하고 실패/예약 건이 유지되는지 검증했다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       586 passed, 586 total / Time:        16.974 s; Test Suites: 13 passed, 13 total / Tests:       167 passed, 167 total / Time:        21.555 s. 리팩터링 없음.

- 실패 근거: 위 U384 실제 DB 뮤턴트 참조.

- U384 구현·회귀 커밋: `5dea2f5`.

### U385 운영 정보 HTTP 검증

- 첫 실행은 테스트의 예약 응답 키를 `payoutId` 대신 `manualRefundPayoutId`로 읽어 confirm 경로가 400이었다. fixture 오류이며 기능 red로 세지 않는다. 기존 API 계약/테스트의 payoutId로 고친 뒤 최초 1 passed.
- `npx jest --config ./test/jest-e2e.json test/refund-history.e2e-spec.ts -t U385`: 모든 상세에 운영자 필드를 넣는 변형에서 `Expected substring: not "비공개 PG 오류와 지급 증빙"`, 1 failed. 원복했다.
- 실제 전송 전 실패와 외부 지급 예약·증빙 등록으로 오류/증빙을 만들었다. 고객·공동 점주 HTTP 응답에는 원문이 없고 MANAGER 상세만 포함한다. 검토 사유는 U247의 동일 응답 DTO 단위 검증에서 확인했다.

### U385

- 실제 지급 이력의 원문 오류와 증빙을 역할별 HTTP 응답에서 확인했다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       586 passed, 586 total / Time:        17.572 s; Test Suites: 13 passed, 13 total / Tests:       168 passed, 168 total / Time:        17.829 s, estimated 21 s. 리팩터링 없음.

- 실패 근거: 위 U385 운영 정보 HTTP 뮤턴트 참조.

- U385 구현·회귀 커밋: `0cff357`.

### U386 HTTP 범위·존재 응답 검증

- `npx jest --config ./test/jest-e2e.json test/refund-history.e2e-spec.ts -t U386` 최초 1 passed. 사용자 존재 확인을 제거하면 `expected 404 "Not Found", got 200 "OK"`, 1 failed. 원복했다.
- USER의 매장 조회·OWNER의 사용자 지정 조회는 403, 없는 매장·사용자는 각각 계약 404 코드이며 범위 안 빈 목록은 200이다.

### U386

- 대상이 없음을 빈 목록과 혼동하지 않고 역할·존재·빈 목록 응답을 구분하는지 HTTP로 확인했다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       586 passed, 586 total / Time:        17.254 s, estimated 18 s; Test Suites: 13 passed, 13 total / Tests:       169 passed, 169 total / Time:        22.644 s. 리팩터링 없음.

- 실패 근거: 위 U386 HTTP 범위 뮤턴트 참조.

- U386 구현·회귀 커밋: `d07c133`.

## US8 구현 완료·최초 검수 준비 (2026-10-29)

- 범위 완료: T147~T155·T187, A64~A68, U239~U249. 계약의 누락 검증 U382~U386(상세 범위/이력·쿼리 형식·실제 DB 페이지/필터·HTTP 정보 노출·조회 대상 존재)을 추가했다. 새 업무 결정은 만들지 않았다.
- 마무리 정리: 테스트 대역의 비공개 `defaultSend` 직접 접근을 기존 공개 `respondToSend`/`reset`으로 교체하고, 응답 배열의 명시 타입으로 린트를 통과시켰다. 테스트 기대값·업무 동작은 변경하지 않았다. 오류 주석과 같은 문자열에 대한 불필요한 trim을 정리했다.
- 프로젝트 설정 점검: 기존 Node/ESLint 무시 설정은 유지했다. Prettier 무시 파일이 없어 의존성·빌드 결과·커버리지·로그·잠금 파일을 제외하는 `.prettierignore`를 추가했다.
- 최종 회귀: `npx jest --runInBand` 51 suites·586 passed(16.248s), `npx jest --config ./test/jest-e2e.json` 13 suites·169 passed(14.952s). package.json의 test/test:e2e는 같은 Jest 명령이며 전체 단위만 직렬 옵션을 추가했다.
- 정적 검사: `./node_modules/.bin/tsc --noEmit` 오류 없음. 이번 변경의 소스·단위·E2E 10개 파일 ESLint 오류/경고 없음. `git diff --check` 통과.
- 남은 범위: US9·최종 이관/실제 PG/운영 증빙 검증은 수행하지 않았다. 체크리스트 미완료 4개는 유지한다. 사용자 미커밋 변경은 스테이징하지 않는다.
- 검수: 기존 US8 Astra 대화(모델 gpt-6-astra, 추론 high, 읽기 전용)에 고정 커밋 범위로 요청한다. 작업별 세션 ID는 무시 대상 `.remember/refund-review-sessions.json`에서 관리한다.

## US8 Astra 최초 검수 (2026-10-29 18:34 KST)

- 고정 범위 `1dd2d5a9..df3ef30`, gpt-6-astra / high, 같은 US8 검수 대화. 판정 **수정 필요**.
- P3: `page=1e308` 같은 큰 양의 정수가 DTO를 통과하여 계산된 skip이 Infinity가 된다. Prisma 검증 오류로 넘어가 계약의 BadRequestException 대신 PRISMA_VALIDATION_ERROR를 반환한다. 페이지/계산 오프셋의 표현 가능 범위 검사와 경계 테스트가 필요하다.
- 절차 이탈: A65·A68은 A64 구현 뒤 최초 통과하고 사후 뮤턴트로 검출력을 확인했다. 이 근거는 구현 전 실패 확인을 충족한 증거가 아니다. 원래 실행 순서는 보존하며 사용자에게 이번 이탈 수용 여부를 별도로 질문했다. 코드 경계 수정은 독립적으로 진행한다.
- 그 외 지정 범위의 권한 우회·운영 정보 노출·실패/예약 누락·금액 계산·최신 시도 선택 결함은 발견하지 못했다.
- 검수자 직접 검증: 고정 커밋의 명세/정책/코드/기록 대조, DB 없는 하네스에서 새 단위 12개 통과, 큰 페이지의 PrismaClientValidationError 재현, diff 형식 검사. 전체 586·E2E169는 구현 담당의 실행 결과다. 검수자는 공유 DB·Redis·실제 PG·최종 이관을 재검증하거나 파일을 수정하지 않았다.

### U387 red

- `npx jest src/refund/dto/get-refund-query.dto.spec.ts -t U387` → page=1e308에서 `- "valid": false`, `+ "valid": true`, 1 failed. 페이지 단위의 안전한 정수 표현 범위를 검증한다.

### U387

- 페이지를 안전한 정수 범위까지 검증한다. 이는 환불 대상·금액 정책 변경이 아닌 요청 숫자의 표현 가능 범위 검증이다. 계산된 오프셋은 다음 U388에서 별도로 확인한다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       587 passed, 587 total / Time:        16.77 s, estimated 17 s; Test Suites: 13 passed, 13 total / Tests:       169 passed, 169 total / Time:        16.199 s. 리팩터링 없음.

- 실패 근거: 위 U387 red 참조.

- U387 구현·회귀 커밋: `a432203`.

### U388 red

- `npx jest --config ./test/jest-e2e.json test/refund-history.e2e-spec.ts -t U388` → page=Number.MAX_SAFE_INTEGER·limit=100에서 `expected 400 "Bad Request", got 200 "OK"`, 1 failed. U387의 페이지 숫자 검증과 별도로 곱셈 결과가 안전하게 표현되지 않는 위치를 검사한다. page=1e308의 일반 BadRequestException은 먼저 확인했다.

### U388

- ORM을 호출하기 전에 계산된 skip이 안전한 정수인지 검사하여 일반 BadRequestException으로 거절한다. 페이지 최대 안전 정수·limit=1은 실제 HTTP에서 빈 목록 200임을 확인했다.
- 전체 회귀: Test Suites: 51 passed, 51 total / Tests:       587 passed, 587 total / Time:        15.408 s, estimated 17 s; Test Suites: 13 passed, 13 total / Tests:       170 passed, 170 total / Time:        16.895 s. 리팩터링 없음.

- 실패 근거: 위 U388 red 참조.

- U388 구현·회귀 커밋: `59299ef`.

## US8 검수 수정 완료·재검수 준비 (2026-10-29)

- P3 수정: `a432203`(U387 페이지의 안전한 정수 표현 범위), `59299ef`(U388 ORM 호출 전 계산된 오프셋의 안전한 정수 확인). 큰 페이지/표현 불가 위치는 400 BadRequestException, 표현 가능한 페이지 경계는 빈 목록 200임을 실제 HTTP에서 확인했다.
- 회귀: `npx jest --runInBand` 51 suites·587 passed(15.408s), `npx jest --config ./test/jest-e2e.json` 13 suites·170 passed(16.895s). 각 수정은 새 테스트의 실제 실패 확인 뒤 별도 커밋했다.
- 정적 검사: tsc --noEmit, 수정 4개 파일 ESLint 오류/경고 없음. 환불 대상·확정액·지급 정책은 변경하지 않았다.
- A65·A68 절차 이탈의 사용자 수용 여부는 대기 중이다. 사후 뮤턴트를 선행 실패로 취급하지 않으며 원래 기록과 커밋 순서를 보존한다. 코드 결함 해결 여부와 절차 수용 여부를 구분해 재검수를 요청한다.
- 검수 패널 설정: 모델 변경 안내 처리 뒤 Sol로 전환된 상태를 발견했다. 검수 발화를 추가로 요청하기 전에 /model 화면에서 Astra와 high를 이 세션에만 다시 지정했고 `Model changed to gpt-6-astra high for this session only`와 패널의 GPT-6-Astra high 표시를 확인했다. 재검수는 같은 US8 세션에서 진행한다.

## US8 Astra 재검수 (2026-10-29 18:45 KST)

- 고정 수정 범위 `df3ef30..6bfdff6`, 같은 US8 대화, GPT-6-Astra high 화면 확인. **기술 검수 통과**, 추가 코드 수정 요구 없음.
- 최초 P3 해결 확인: DTO에서 큰 page를 BadRequestException으로 거절하고, me/shop/user 모두 계산된 오프셋이 안전하지 않으면 목록 쿼리 전에 거절한다. 최대 안전 페이지·limit=1 및 limit=100의 오프셋 경계와 바로 다음 값을 확인했다. 환불 업무 정책 변경은 없다.
- 검수자 직접 검증: DB 없는 하네스에서 단위 13개 통과, 추가 입력 경계 실행, 고정 커밋 코드·테스트·기록 대조, diff 검사. 전체 단위 587·E2E170은 구현 담당의 실제 실행 결과이며 검수자는 공유 DB·Redis·실제 PG·최종 이관을 재실행하지 않았다. 파일 수정·커밋 없음.
- 최종 관문 판정은 **수정 필요(절차 수용 대기)**. A65·A68은 구현 후 최초 통과하고 사후 뮤턴트로 검출력을 확인한 기록을 보존했다. 이는 선행 실패의 증거가 아니므로, 이번 이탈에 대한 사용자 수용 결정이 확인될 때까지 US8 최종 통과를 보류한다.
- 구현·테스트 작업의 완료 체크와 Phase 최종 통과는 구분한다. 답변 대기 동안 US9 구현은 시작하지 않는다.

## US8 절차 이탈의 사용자 수용 (2026-10-29 18:49 KST)

- 사용자 답변: "이번 US8을 수용". A65·A68이 구현 후 최초 통과하고 사후 뮤턴트로 검출력을 확인한 이번 이탈을 수용했다. 이는 원래 실행 순서의 이력을 바꾸거나 선행 실패 증거로 인정한 것이 아니다.
- 이 수용은 이번 US8에 한정한다. 후속 구현의 동작별 테스트 작성·실제 실패 확인·최소 구현·전체 회귀 절차는 유지한다. 환불 업무 정책 변경은 없다.
- 기술 검수 통과 범위 `df3ef30..6bfdff6`의 코드는 변경하지 않았다. 이후 `590ec7b`는 검수 결과 기록만 추가했다. 같은 Astra high 검수 대화에 사용자 수용을 전달하여 최종 판정을 요청한다.

## US8 최종 검수 통과 (2026-10-29 18:52 KST)

- 같은 US8 대화의 GPT-6-Astra high 검수자가 T147~T155·T187을 최종 **통과**로 판정했다. 지정 범위의 남은 코드 지적·미결 검수 조건은 없다.
- 검수자는 `6bfdff6..4da1d2d`가 cycle-log 기록 14줄 추가뿐이고 기술 검수 통과 코드·테스트가 그대로임을 확인했다. 사용자 답변 "이번 US8을 수용"으로 유일한 보류 조건이 충족됐다. 수용은 이번 A65·A68 절차 이탈에 한정하고 원래 이력·후속 TDD 규칙을 유지한다.
- 이번 최종 확인은 기록·변경 범위·diff 형식에 한정하며 테스트 재실행은 없다. 앞선 검수자 직접 검증은 DB 없는 단위 13개·추가 입력 경계이고, 전체 단위 587개·E2E170개·타입·린트 통과는 구현 담당의 실행 결과다. 실제 PG·최종 이관은 검증하지 않았다. 검수자는 파일 수정·커밋을 하지 않았다.
- 사용자 미커밋 변경은 보존했다. 명세·업무 정책 변경 없이 US8 구현·테스트·검수 관문을 완료했다. 다음 구현 단위는 US9다.
- speckit-implement의 after_implement 후크를 확인했다. 등록된 speckit.tdd.verify는 선택 후크로 안내했고 이번 US8 범위에서는 실행하지 않았다.

## US9 환불 상태와 수신자별 알림 재개 (2026-10-29)

- 범위: T156~T168·T188, U250~U261·A69~A76. 기준 커밋 `dbf6b1d76996faad29181530de841b4e49d1cc1d`. 사용자 미커밋 변경은 보존한다.
- 기준선: `npx jest --runInBand` 51 suites·587 passed(17.677s), `npx jest --config ./test/jest-e2e.json` 13 suites·170 passed(18.107s). 공유 DB 테스트는 직렬 실행한다.
- 기존 구현과 새 구현을 구분한다. 환불 결과의 수신자별 알림 생성·접수 응답은 이전 승인 단계의 코드와 기존 테스트 근거를 연결한다. 새 알림 조회·읽음·입력 경계는 동작별 테스트의 실제 실패를 확인한 뒤 구현하며, 기존 기능의 추가 통합 검증을 선행 실패로 기록하지 않는다.
- 최종 PG·이관·운영 증빙 체크리스트 미완료 4개는 그대로 두고 사용자가 승인한 US9 구현을 진행한다. US8의 절차 이탈 수용은 이번 US9의 새 구현에 적용하지 않는다.

### U389 red

- `npx jest src/refund/refund-notification.service.spec.ts -t U389`
```text
    - Object {
    -   "OR": Array [
    -     Object {
    -       "recipientUserId": null,
    -     },
    -     Object {
    -       "recipientUserId": "owner",
    -     },
    -   "audience": "SHOP",
    -   "shop": Object {
    -     "owners": Object {
    -       "some": Object {
    -         "userId": "owner",
    -       },
    -     },
    -   },
    - }
    + Object {}
Tests:       1 failed, 1 total
```

### U389

- 현재 ShopOwner 매장의 SHOP 범위를 조회 조건으로 만들고, 본인 지정 수신자 또는 범위 발송만 허용한다. 아직 HTTP 경로는 연결하지 않았으며 이후 역할별 조건도 각각 선행 실패로 검증한다.
- 전체 회귀: Test Suites: 52 passed, 52 total / Tests:       588 passed, 588 total / Time:        16.884 s, estimated 18 s; Test Suites: 13 passed, 13 total / Tests:       170 passed, 170 total / Time:        16.793 s, estimated 18 s. 리팩터링 없음.
- 실패/기존 근거: 위 U389 실제 red 참조.

- U389 커밋: `a9101ca`.

### U390 red

- `npx jest src/refund/refund-notification.service.spec.ts -t U390`
```text
    -   "audience": "CUSTOMER",
    -   "recipientUserId": "customer",
    -   "refund": Object {
    -     "payment": Object {
    -       "order": Object {
    -         "userId": "customer",
    -       },
    -     },
    +   "id": Object {
    +     "in": Array [],
Tests:       1 failed, 1 skipped, 2 total
```

### U390

- 고객 알림은 자기 주문과 자기 수신자 ID를 함께 만족하는 CUSTOMER만 조회한다.
- 전체 회귀: Test Suites: 52 passed, 52 total / Tests:       589 passed, 589 total / Time:        15.894 s, estimated 17 s; Test Suites: 13 passed, 13 total / Tests:       170 passed, 170 total / Time:        21.523 s. 리팩터링 없음.
- 실패/기존 근거: 위 U390 실제 red 참조.

- U390 커밋: `acad802`.

### U391 red

- `npx jest src/refund/refund-notification.service.spec.ts -t U391`
```text
    -   "OR": Array [
    -     Object {
    -       "recipientUserId": null,
    -     },
    -     Object {
    -       "recipientUserId": "manager",
    +   "id": Object {
    +     "in": Array [],
    -   "audience": "OPERATOR",
Tests:       1 failed, 2 skipped, 3 total
```

### U391

- 운영자에게는 OPERATOR 알림 중 범위 발송 또는 본인 지정 수신자만 노출한다.
- 전체 회귀: Test Suites: 52 passed, 52 total / Tests:       590 passed, 590 total / Time:        15.762 s, estimated 16 s; Test Suites: 13 passed, 13 total / Tests:       170 passed, 170 total / Time:        18.359 s, estimated 21 s. 리팩터링 없음.
- 실패/기존 근거: 위 U391 실제 red 참조.

- U391 커밋: `29057ca`.

### U392 red

- `npx jest src/refund/dto/get-refund-notification-query.dto.spec.ts -t U392`
```text
    -   "limit": 20,
    -   "page": 1,
    -   "unreadOnly": false,
    +   "limit": undefined,
    +   "page": undefined,
    +   "unreadOnly": undefined,
Tests:       1 failed, 1 total
```

### U392

- 알림 쿼리 기본값과 형식을 DTO에서 검증한다. 사용자·매장 임의 지정 필드는 허용하지 않는다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       591 passed, 591 total / Time:        15.998 s, estimated 16 s; Test Suites: 13 passed, 13 total / Tests:       170 passed, 170 total / Time:        16.849 s, estimated 18 s. 리팩터링 없음.
- 실패/기존 근거: 위 U392 실제 red 참조.

- U392 커밋: `4c88dfb`.

### U393 red

- `npx jest src/refund/refund-notification.service.spec.ts -t U393`
```text
    Expected: {"include": {"receipts": {"select": {"readAt": true}, "where": {"userId": "owner"}}}, "orderBy": [{"createdAt": "desc"}, {"id": "desc"}], "skip": 20, "take": 20, "where": {"AND": [{"OR": [{"recipientUserId": null}, {"recipientUserId": "owner"}], "audience": "SHOP", "shop": {"owners": {"some": {"userId": "owner"}}}}]}}
    Number of calls: 0
Tests:       1 failed, 3 skipped, 4 total
```

### U393

- 알림 목록을 수신 범위 안에서 createdAt DESC,id DESC로 정렬하고 페이지를 자른다. 읽음 행은 요청한 사용자 것만 조회한다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       592 passed, 592 total / Time:        16.199 s; Test Suites: 13 passed, 13 total / Tests:       170 passed, 170 total / Time:        17.438 s. 리팩터링 없음.
- 실패/기존 근거: 위 U393 실제 red 참조.

- U393 커밋: `4be68cb`.

### U259 red

- `npx jest src/refund/refund-notification.service.spec.ts -t U259`
```text
    Expected: ObjectContaining {"where": {"AND": [{"OR": [{"recipientUserId": null}, {"recipientUserId": "owner"}], "audience": "SHOP", "shop": {"owners": {"some": {"userId": "owner"}}}}, {"receipts": {"none": {"userId": "owner"}}}]}}
    Received: {"include": {"receipts": {"select": {"readAt": true}, "where": {"userId": "owner"}}}, "orderBy": [{"createdAt": "desc"}, {"id": "desc"}], "skip": 0, "take": 20, "where": {"AND": [{"OR": [{"recipientUserId": null}, {"recipientUserId": "owner"}], "audience": "SHOP", "shop": {"owners": {"some": {"userId": "owner"}}}}]}}
Tests:       1 failed, 4 skipped, 5 total
```

### U259

- 다른 공동 점주의 읽음과 무관하게 요청자 본인의 Receipt가 없는 알림만 필터링한다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       593 passed, 593 total / Time:        16.034 s; Test Suites: 13 passed, 13 total / Tests:       170 passed, 170 total / Time:        15.132 s, estimated 17 s. 리팩터링 없음.
- 실패/기존 근거: 위 U259 실제 red 참조.

- U259 커밋: `25ed016`.

### U394 red

- `npx jest src/refund/refund-notification.service.spec.ts -t U394`
```text
    Expected: ObjectContaining {"where": {"AND": [{"OR": [{"recipientUserId": null}, {"recipientUserId": "owner"}], "audience": "SHOP", "shop": {"owners": {"some": {"userId": "owner"}}}}, {"audience": "OPERATOR"}]}}
    Received: {"include": {"receipts": {"select": {"readAt": true}, "where": {"userId": "owner"}}}, "orderBy": [{"createdAt": "desc"}, {"id": "desc"}], "skip": 0, "take": 20, "where": {"AND": [{"OR": [{"recipientUserId": null}, {"recipientUserId": "owner"}], "audience": "SHOP", "shop": {"owners": {"some": {"userId": "owner"}}}}]}}
Tests:       1 failed, 5 skipped, 6 total
```

### U394

- audience 필터는 권한 조건과 AND로 결합해 역할·소유 매장 범위를 넓히지 않는다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       594 passed, 594 total / Time:        15.978 s, estimated 16 s; Test Suites: 13 passed, 13 total / Tests:       170 passed, 170 total / Time:        15.921 s. 리팩터링 없음.
- 실패/기존 근거: 위 U394 실제 red 참조.

- U394 커밋: `77851d6`.

### U395 red

- `npx jest src/refund/refund-notification.service.spec.ts -t U395`
```text
    Received promise resolved instead of rejected
Tests:       1 failed, 6 skipped, 7 total
```

### U395

- 알림의 계산 위치를 ORM 호출 전에 검사한다. 아직 HTTP는 연결하지 않았다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       595 passed, 595 total / Time:        16.495 s; Test Suites: 13 passed, 13 total / Tests:       170 passed, 170 total / Time:        19.025 s. 리팩터링 없음.
- 실패/기존 근거: 위 U395 실제 red 참조.

- U395 커밋: `3d89593`.

### U396 red

- `npx jest src/refund/refund-notification.service.spec.ts -t U396`
```text
    -       "isRead": false,
    -       "message": Any<String>,
    -       "notificationId": "notification",
    -       "readAt": null,
    -       "isRead": true,
    -       "message": Any<String>,
    -       "notificationId": "read",
    -       "readAt": 2026-10-29T00:00:00.000Z,
    -   "meta": Object {
    -     "limit": 20,
    -     "page": 1,
    -     "total": 2,
    -   },
Tests:       1 failed, 7 skipped, 8 total
```

### U396

- 내부 eventKey·수신자 데이터·다른 사람 Receipt를 반환하지 않고, 공개 사건 정보와 안전한 메시지·본인의 isRead/readAt만 응답한다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       596 passed, 596 total / Time:        16.297 s, estimated 17 s; Test Suites: 13 passed, 13 total / Tests:       170 passed, 170 total / Time:        17.898 s, estimated 19 s. 리팩터링 없음.
- 실패/기존 근거: 위 U396 실제 red 참조.

- U396 커밋: `f6df615`.

### A73 HTTP 연결 red

- `npx jest --config ./test/jest-e2e.json test/refund-notifications.e2e-spec.ts -t QS-9-4`
```text
    expected 200 "OK", got 400 "Bad Request"
Tests:       1 failed, 1 total
```
- 신규 수신 범위·조회·입력·응답 동작은 U389~U396·U259에서 각각 선행 실패로 구현했다. 이제 실제 HTTP 연결을 검증한다.

### A73

- 고정 알림 경로를 동적 환불 ID보다 먼저 등록했다. 실제 PG 거절 사건으로 현재 소유 매장 알림만 조회되는지 HTTP로 확인했다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       596 passed, 596 total / Time:        15.539 s, estimated 16 s; Test Suites: 14 passed, 14 total / Tests:       171 passed, 171 total / Time:        17.834 s, estimated 18 s. 리팩터링 없음.
- 실패/기존 근거: 위 A73 실제 HTTP red 및 선행 단위 근거 참조.

- A73 커밋: `5f59bce`.

### U260 red

- `npx jest src/refund/refund-notification.service.spec.ts -t U260`
```text
    Received promise resolved instead of rejected
Tests:       1 failed, 8 skipped, 9 total
```
- 읽음 처리의 수신 권한 선행 조건을 먼저 구현한다. 실제 읽음 HTTP 연결에서 같은 오류 코드도 검증한다.

### U260

- 読み음 요청 전에 알림 ID와 현재 수신 범위를 함께 조회하고, 없거나 범위 밖이면 같은 NOTIFICATION_NOT_FOUND로 거절한다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       597 passed, 597 total / Time:        15.951 s, estimated 16 s; Test Suites: 14 passed, 14 total / Tests:       171 passed, 171 total / Time:        16.847 s, estimated 17 s. 리팩터링 없음.
- 실패/기존 근거: 위 U260 실제 red 참조.

- U260 커밋: `0b17c1d`.

### U257 red

- `npx jest src/refund/refund-notification.service.spec.ts -t U257`
```text
    -   "first": Object {
    -     "isRead": true,
    -     "readAt": 2026-10-29T00:00:00.000Z,
    -   },
    -   "second": Object {
    -     "isRead": true,
    -     "readAt": 2026-10-29T00:00:01.000Z,
    -   },
    +   "first": undefined,
    +   "second": undefined,
Tests:       1 failed, 9 skipped, 10 total
```

### U257

- 읽음 기록을 notificationId/userId 복합 키로 저장하여 공동 점주별로 분리한다. 수신 범위 확인을 먼저 수행한다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       598 passed, 598 total / Time:        15.868 s, estimated 16 s; Test Suites: 14 passed, 14 total / Tests:       171 passed, 171 total / Time:        16.05 s, estimated 17 s. 리팩터링 없음.
- 실패/기존 근거: 위 U257 실제 red 참조.

- U257 커밋: `f188d30`.

### U258 red

- `npx jest src/refund/refund-notification.service.spec.ts -t U258`
```text
    -   "readAt": 2026-10-29T00:00:00.000Z,
    +   "readAt": 2026-10-29T00:01:00.000Z,
Tests:       1 failed, 10 skipped, 11 total
```

### U258

- Receipt upsert의 기존 행을 갱신하지 않아 최초 readAt을 보존한다. 복합 PK는 같은 사람의 중복 기록을 막는다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       599 passed, 599 total / Time:        16.501 s; Test Suites: 14 passed, 14 total / Tests:       171 passed, 171 total / Time:        16.83 s. 리팩터링 없음.
- 실패/기존 근거: 위 U258 실제 red 참조.

- U258 커밋: `20760bc`.

### A75 HTTP 연결 red

- `npx jest --config ./test/jest-e2e.json test/refund-notifications.e2e-spec.ts -t QS-9-4b`
```text
    expected 200 "OK", got 404 "Not Found"
Tests:       1 failed, 1 skipped, 2 total
```
- 읽음의 권한·사용자 분리·최초 시각 보존은 U260·U257·U258의 선행 실패로 구현한 뒤 HTTP로 연결한다.

### A75

- 읽음 PATCH를 빈 본문/{}로 연결했다. 현재 수신 권한·공동 점주 분리·미읽음 제외·반복 시각·권한 해제와 미허용 본문을 실제 HTTP에서 확인한다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       599 passed, 599 total / Time:        14.807 s, estimated 17 s; Test Suites: 14 passed, 14 total / Tests:       172 passed, 172 total / Time:        18.874 s. 리팩터링 없음.
- 실패/기존 근거: 위 A75 실제 HTTP red 및 선행 단위 근거 참조.

- A75 커밋: `0e99139`.

### A74 단위에서 먼저 구현한 고객 범위의 HTTP 검증

- 고객 범위는 U390 실제 실패 뒤 구현했고, HTTP 연결은 A73에서 실제 실패 뒤 구현했다. 새 A74 통합 테스트의 최초 실행은 1 passed이며 새 동작의 선행 실패로 취급하지 않는다.
- `npx jest --config ./test/jest-e2e.json test/refund-notifications.e2e-spec.ts -t QS-9-4a`: 본인 주문/수신자 조건 제거 뮤턴트에서 타인 알림이 포함되어 1 failed. 원복했다.

### A74

- 선행 단위 U390과 HTTP 연결 A73을 통과한 고객 범위를 실제 다른 고객 데이터로 확인했다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       599 passed, 599 total / Time:        16.196 s; Test Suites: 14 passed, 14 total / Tests:       173 passed, 173 total / Time:        23.284 s. 리팩터링 없음.
- 실패/기존 근거: U390/A73 선행 red·위 A74 HTTP 뮤턴트 참조.

- A74 커밋: `6c39e3a`.

### A69·U261 기존 승인 기능의 HTTP 통합 검증

- 접수 응답은 기준 커밋 이전의 US1·US2·US5에서 구현했다. 기존 `test/refund-recovery.e2e-spec.ts`의 QS-5-1은 202·ACCEPTED/ACTION_REQUIRED·종료 시각을 검증한다.
- `npx jest --config ./test/jest-e2e.json test/refund-notifications.e2e-spec.ts -t QS-9-1` → 최초 1 passed. 새 US9 구현의 선행 실패가 아닌 기존 동작의 추가 통합 검증이다. 새 운영 코드는 추가하지 않았다.
- 고객/매장 ACCEPTED·NOT_SENT·REJECTED, 0원 200 PAID·PG 미호출, 외부 지급 완료 후에도 같은 키의 최초 202 응답 재생과 최신 GET의 PAID를 구분했다.

### A69·U261

- 이전 승인된 접수·지급·멱등 응답을 US9 통합 시나리오에서 재확인했다. 기존 코드 변경 없음.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       599 passed, 599 total / Time:        18.887 s; Test Suites: 14 passed, 14 total / Tests:       174 passed, 174 total / Time:        38.463 s. 리팩터링 없음.
- 실패/기존 근거: 기준선 이전 QS-5-1 및 위 A69 기존 동작 증거 참조.

- A69·U261 커밋: `471946c`.

### A70 기존 US8 조회 응답의 통합 검증

- 최신 조회는 기준 커밋 이전 US8에서 구현·검수했다. 새 QS-9-2는 최초 1 passed이며 새 구현의 선행 실패로 취급하지 않는다. 실제 PG 부분 지급 뒤 고객과 점주 모두의 종료 시각·확정액·실제액·미지급액·지급 상태·안전한 조치 사유를 대조한다.

- A70 전체 회귀 첫 실행: 단위 596 passed·3 failed. 복구 대상 전역 탐색에 다른 시도의 ID가 섞였다. VS Code Jest watch PID 69683·69834가 동시 실행 중이었으며, 종료 요청 시 이미 종료되어 있었다. 변경된 단언 없이 단독 회귀로 재확인한다.

### A70 회귀 검증 보류 (2026-10-30)

- 전체 단위 재실행도 596 passed·3 failed. Jest watch PID 32084·32498가 다시 실행 중임을 확인했으므로 단독 검증으로 기록하지 않는다. 복구 전역 탐색 테스트에 다른 시도가 섞이는 현상이며 단언은 변경하지 않았다.
- watch 종료 요청은 `PermissionRequest hook denied approval`로 자동 승인 검토에서 거절됐다. 사용자에게 자동 실행 중지 또는 설정 변경 허용을 요청한 상태다. A70은 미완료로 유지하고 커밋하지 않았다.
- `npx tsc --noEmit` 통과. US9 대상 eslint 검사에서 미사용 _body, 테스트 require-await/unsafe-assignment, 새 A70 줄바꿈 등 4건을 확인했으며 최종 정리 때 수정해야 한다.
- 검수 패널을 기존 US9 세션 `01a1871d-371c-79a1-bce6-429862a5561f`로 다시 시작했다. argv의 gpt-6-astra/high/read-only와 화면 `GPT-6-Astra high`를 확인했다. 정식 검수는 아직 요청하지 않았다.

- 사용자 승인(2026-10-30 01:32 KST)에 따라 .vscode/settings.json에 jest.runMode={type:on-demand,runAllTestsOnStartup:false}를 추가했다. 기존 설정은 보존하며 US9 커밋에 포함하지 않는다. 변경 후 Jest watch 프로세스가 없음을 확인했다.

### U250~U255 기존 구현·테스트의 재사용

- 새 운영 코드를 쓰지 않고 기준 커밋 이전 테스트를 대조했다. U250~U254는 refund-result.integration.spec.ts의 고객·매장·시스템 PG 거절 수신자, 연속 조회 오류 5회, 실제액 불일치 테스트를 각각 연결했다. U255는 refund-constraints.integration.spec.ts의 null 수신자/특정 수신자 동일 사건 고유성 2개를 연결했다.
- 단독 회귀의 실패는 복구 PROBE 1건이며 위 테스트들은 통과했다. 테스트 목록은 기존 증거 파일·테스트 이름으로 DONE을 기록했다. 새 구현의 선행 실패로 주장하지 않는다. U256 원자적 롤백은 별도 보충 검증이 남았다.

- A70 보충 뮤턴트: 미지급액 계산을 0으로 바꾸고 QS-9-2를 실행했다. 실제 실패 출력:
```text
expect(received).toMatchObject(expected)

    - Expected  - 1
    + Received  + 1

      Object {
        "actionCode": "AMOUNT_MISMATCH",
        "actionReason": "확정 금액과 실제 환불금 지급액이 달라 확인이 필요합니다.",
        "amount": 10000,
    -   "outstandingAmount": 1000,
    +   "outstandingAmount": 0,
        "paidAmount": 9000,
        "payoutStatus": "ACTION_REQUIRED",
        "refundId": "76da95ed-4971-4371-8064-c3db190128a3",
        "terminatedAt": "2026-10-29T16:36:42.435Z",
      }

      172 |         .set('Authorization', `Bearer ${actor.token}`)
      173 |         .expect(200);
    > 174 |       expect(res.body.data).toMatchObject({
          
```
- 원복했다. 과거 중단 fixture 774f9f18의 주문 67개와 연결 테스트 데이터만 정리 후 전체 회귀를 재실행한다.

### A70

기존 US8 조회 동작을 실제 PG 결과 반영과 연결해 확인했다. 새 파일의 미사용 본문·목 비동기·matcher 린트와 줄바꿈도 동작/단언 보존으로 정리했다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       599 passed, 599 total / Time:        15.305 s, estimated 16 s; Test Suites: 14 passed, 14 total / Tests:       175 passed, 175 total / Time:        16.426 s, estimated 35 s. 리팩터링 없음.
- 실패/기존 근거: US8 선행 구현·검수 및 위 A70 최초 실행/뮤턴트 기록 참조.

- A70 커밋: `587a42f`.

### A71 기존 고객 실패 알림의 HTTP 검증

- 기존 U250 실제 DB 테스트 및 선행 U390/A73으로 구현된 알림 조회를 연결했다. 새 QS-9-3 최초 실행은 1 passed. 새 구현의 선행 실패가 아니다. 같은 서명 콜백을 두 번 보내도 고객·현재 공동 점주 각각·MANAGER의 수신 범위에 사건 1건만 보이고 PG 원문은 없다.
- CUSTOMER 저장을 생략한 뮤턴트의 실제 실패:
```text
expect(received).toEqual(expected) // deep equality

    - Expected  - 6
    + Received  + 1

    - Array [
    -   ObjectContaining {
    -     "audience": "CUSTOMER",
    -     "kind": "PG_REJECTED",
    -   },
    - ]
    + Array []

      208 |         (item) => item.refundId === accepted.refundId,
      209 |       );
    > 210 |       expect(related).toEqual([
          |                       ^
      211 |         expect.objectContaining({ audience, kind: 'PG_REJECTED' }),
      212 |    
```
- 뮤턴트를 원복했다.

### A71

기존 고객 실패 알림을 실제 조회·중복 콜백과 연결해 확인했다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       599 passed, 599 total / Time:        14.64 s, estimated 15 s; Test Suites: 14 passed, 14 total / Tests:       176 passed, 176 total / Time:        17.077 s. 리팩터링 없음.
- 실패/기존 근거: 기존 U250 및 위 A71 최초 실행·뮤턴트 참조.

- A71 커밋: `a76ed3a`.

### A72 기존 매장 실패 알림의 HTTP 검증

- U251 기존 DB 테스트의 동작과 선행 조회 구현을 연결한 QS-9-3a는 최초 1 passed. 새 구현의 선행 실패가 아니다.
- 고객 수신자 제한을 지운 뮤턴트의 실제 실패:
```text
expect(received).toEqual(expected) // deep equality

    - Expected  -  1
    + Received  + 15

    - Array []
    + Array [
    +   Object {
    +     "audience": "CUSTOMER",
    +     "createdAt": "2026-10-29T16:39:09.246Z",
    +     "isRead": false,
    +     "kind": "PG_REJECTED",
    +     "manualRefundPayoutId": null,
    +     "message": "환불금 지급 요청이 거절되어 확인이 필요합니다.",
    +     "notificationId": "5c332a1b-cc2b-45df-863d-a7510946d57c",
    +     "paymentCancelId": "2d98391b-b504-4d8b-8384-
```
- 원복했다.

### A72

매장 환불 거절 알림은 점주·운영자만 수신하고 고객은 조회하지 못함을 실제 HTTP로 확인했다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       599 passed, 599 total / Time:        14.798 s, estimated 15 s; Test Suites: 14 passed, 14 total / Tests:       177 passed, 177 total / Time:        17.076 s. 리팩터링 없음.
- 실패/기존 근거: 기존 U251 및 위 A72 최초 실행·뮤턴트 참조.

- A72 커밋: `d6195b1`.

### A76 기존 운영 이상 알림의 HTTP 검증

- U252~U254 기존 DB 테스트의 결과와 선행 U391/A73 조회를 연결한 QS-9-5는 최초 1 passed. 실제 개별 PG 확인·서명 취소 결과·승인 금액 불일치 자동 취소 경로로 사건을 만들었다. 고객·점주의 알림에는 이 운영 사건들이 없다. 새 구현의 선행 실패가 아니다.
- OPERATOR 저장을 생략한 뮤턴트의 실제 실패:
```text
expect(received).toHaveLength(expected)

    Expected length: 3
    Received length: 0
    Received array:  []

      277 |       (item) => ids.includes(item.refundId),
      278 |     );
    > 279 |     expect(related).toHaveLength(3);
          |                     ^
      280 |     expect(related).toEqual(
      281 |       expect.arrayContaining(
      282 |         expected.map((item) =>

  
```
- 원복했다.

### A76

운영 이상 3종이 MANAGER에게만 조회되는지 실제 업무 경로와 연결해 확인했다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       599 passed, 599 total / Time:        14.34 s, estimated 15 s; Test Suites: 14 passed, 14 total / Tests:       178 passed, 178 total / Time:        16.902 s, estimated 17 s. 리팩터링 없음.
- 실패/기존 근거: 기존 U252~U254 및 위 A76 최초 실행·뮤턴트 참조.

- A76 커밋: `c705d80`.

### U256 既存トランザクションの補充検証

- 정정: 위 제목은 '기존 트랜잭션의 보충 검증'을 뜻한다. 기준 커밋 이전 공통 결과 처리는 같은 트랜잭션에서 알림을 저장한다. 새 U256 첫 실행은 1 passed이며 새 구현의 선행 실패로 취급하지 않는다.
- 실제 DB에서 알림 1건을 저장·조회한 직후 예외를 내면 트랜잭션 밖에는 알림 0건, 환불 PENDING, 시도 REQUESTED가 유지된다. 저장 단계까지 도달했음을 확인해 알림을 전혀 쓰지 않는 구현이 통과하지 못하게 했다.
- 트랜잭션을 없애고 Prisma 기본 클라이언트로 각각 커밋한 뮤턴트의 실제 실패:
```text
expect(received).toMatchObject(expected)

    - Expected  -  3
    + Received  + 16

      Object {
    -   "notifications": Array [],
    +   "notifications": Array [
    +     Object {
    +       "audience": "OPERATOR",
    +       "createdAt": 2026-10-29T16:41:49.037Z,
    +       "eventKey": "PG_REJECTED:d958b7e0-0c60-424f-a33e-4b416d6a61d2",
    +       "id": "24c158f9-75e6-49e3-a13a-e19f354ed925",
    +       "kind": "PG_REJECTED",
    +       "manualRefundPayoutId": null,
    +       "paymentCancelId": "d958b7e0-0c60-424f-a33e-4b416d6a61d2",
    +       "recipientUserId": null,
    +       "refundId": "5fe20848-d2c1-4b3c-b75f-c5e227815a27",
    +       "shopId": "8a6c58c6-7022-41a1-bc1c-4f92a20701dd",
    +     },
    +   ],
        "paidAmount": 0,
        "paymentCancels": Array 
```
- 원복했다.

### U256

상태 전이 실패 때 알림·환불·시도가 실제 DB에서 함께 롤백됨을 확인했다.
- 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       600 passed, 600 total / Time:        17.14 s; Test Suites: 14 passed, 14 total / Tests:       178 passed, 178 total / Time:        23.929 s. 리팩터링 없음.
- 실패/기존 근거: 위 U256 최초 실행·트랜잭션 제거 뮤턴트 참조.

- U256 커밋: `8515d35`.

### US9 최종 정리와 검수 범위

- U260 기록의 '読み음'은 '읽음'을 뜻한다. U256 보충 검증 제목은 바로 다음 정정 문장에 쓴 '기존 트랜잭션의 보충 검증'이다. 과거 기록은 삭제/교체하지 않는다.
- T164의 지급 확인 지연은 기존 refund-operations.e2e-spec.ts QS-10-5의 운영자 알림과 refund-result.integration.spec.ts의 장기 미확인 중복·경쟁·거래 로그 테스트를 재사용했다. 명세/수신 정책 변경 없음.
- 테스트의 app.get 제네릭과 matcher 타입 린트, 알림 404 주석을 정리했다. 업무 동작/단언 변경 없음.
- tasks.md의 US9 외 별도 표현 교정이 이전 사이클의 전체 파일 staging에 섞여 있었다. 검수 최종 diff는 기준 커밋의 US9 외 문장으로 되돌려 분리하고, 작업 파일에는 사용자가 교정한 문장들을 그대로 복원한다. 별도 교정을 없애거나 새 정책을 정하는 작업이 아니다. 이후 커밋에서 사용자 문장을 다시 포함하지 않도록 파일 범위를 확인한다.

- 최종 타입 정리: strictBindCallApply=false 환경에서 bind 반환이 any로 추론되어 U256 원본 함수에 메서드 타입을 명시했다. 업무 동작·테스트 단언 변경 없음. 변경 후 U256 1 passed, npx tsc --noEmit 및 US9 변경 TypeScript 파일 10개의 eslint 오류 없음, git diff --check 통과. 전체 회귀는 직전 동작 동일 상태에서 단위600/E2E178 통과했다.

### US9 Astra 검수 1차 (7c52b2c, 2026-10-30 01:50 KST)

- GPT-6-Astra high 판정: 수정 필요. P2: 같은 사용자의 최초 읽음이 동시에 겹치면 Prisma의 빈 update upsert가 SELECT→INSERT로 실행되어 한 요청이 P2002/409가 된다. 생성 경쟁에서도 최초 Receipt를 반환해야 한다. 검수자는 실제 Prisma·Repository와 DB 없는 어댑터 대역으로 재현했다.
- 그 외 추가 차단 결함 없음. 검수자 직접 단위12개 통과, 공유 DB 테스트 미실행. 기존 동작 재사용과 신규 선행 실패 구분·US9 외 사용자 교정 분리를 확인했다.
- 비차단 정정: 이전 'diff check 통과'는 작업 파일의 git diff --check 결과다. 고정 커밋 간 git diff --check dbf6b1d 7c52b2c는 cycle-log의 실제 실패 출력 끝 공백 4곳(1969·2004·2067·2107행)으로 실패한다. 과거 실행 기록은 append-only 규칙에 따라 지우지 않고 검사 범위를 바로잡는다.
- 수정 회귀 U397을 실제 HTTP·PostgreSQL 경쟁으로 검증한다. 동시성 재검수는 같은 세션의 GPT-6-Astra xhigh로 진행한다.

- U397 최초 테스트 준비 오류(유효 red 아님): 실제 PK는 text인데 ::uuid로 비교해 `operator does not exist: text = uuid`가 났다. 테스트 쿼리의 잘못된 cast만 제거하고 운영 구현은 그대로 둔 채 다시 실행한다.

- U397 준비 보완(유효 red 아님): 두 번째 실행은 Jest 기본 5000ms 제한에 걸렸고, 미완료 HTTP 요청과 afterAll 정리가 겹쳐 FK 오류·열린 연결이 남았다. 제가 실행한 해당 테스트 프로세스만 SIGINT로 종료했다. 상태 통계 캐시를 비우며 대기 요청을 관찰하고, 잠금 해제 후 모든 HTTP 요청을 finally에서 기다린 뒤 정리하도록 테스트를 고친다. 경쟁 대기 상한 5초보다 긴 테스트 제한 20초를 명시한다. 운영 코드는 아직 변경하지 않았다.

### U397 有効 red

- 정정: 제목은 'U397 유효 red'이다. `npx jest --config ./test/jest-e2e.json test/refund-notifications.e2e-spec.ts -t U397`
```text
    expect(received).toEqual(expected) // deep equality

    - Expected  - 1
    + Received  + 1

      Array [
    -   200,
    +   409,
        200,
      ]
Tests:       1 failed, 8 skipped, 9 total
```
- 두 INSERT가 실제 PostgreSQL 잠금에서 대기한 뒤 해제했을 때 [409,200]으로 실패했다. 이 출력 기록 전에는 운영 구현을 변경하지 않았다.

### U397 修正後検証

- 정정: 제목은 'U397 수정 후 검증'이다. 읽음 기록은 createMany(skipDuplicates:true)로 먼저 저장하고, 같은 사용자·알림의 저장된 Receipt를 조회한다. 먼저 저장된 readAt을 바꾸지 않는다. 목은 실제 DB 동작과 같은 중복 무시·기존 조회로 바꾸고 U257/U258 단언을 보존했다.
- 새 U397 실제 DB 경쟁: 1 passed. 두 INSERT 대기 확인 뒤 모두 200·같은 readAt·Receipt 1건이다. 전체 회귀: Test Suites: 53 passed, 53 total / Tests:       600 passed, 600 total / Time:        15.869 s; Test Suites: 14 passed, 14 total / Tests:       179 passed, 179 total / Time:        14.781 s, estimated 25 s. 코드·테스트를 서식 정리했으며 동작 추가는 이 수정뿐이다.

### US9 재개 검증 (2026-10-30)

- 변경된 읽음 Repository·회귀 테스트의 tsc·eslint·현재 변경 공백 검사 통과. U397을 포함한 전체 단위600개 통과.
- 전체 E2E 병렬 재실행은 178 passed·1 failed. 기존 refund-operations의 QS-10-1d가 `Exceeded timeout of 5000 ms for a test.`로 실패했다. 새 U397은 통과했다. 테스트 단언·시간 제한을 바꾸지 않고 전체 E2E를 직렬 실행해 공유 DB 부하 영향을 구분한다.
- 현재 도구 환경에는 HERDR_ENV가 없어 Herdr 스킬의 환경 확인 규칙에 따른 패널 제어를 중단하고, 사용자에게 기존 검수 패널 접근 예외를 요청했다. 구현·테스트는 계속 진행한다.

- 재개 후 직렬 전체 회귀: 단위53 suites·600 passed(17.59초), E2E14 suites·179 passed(43.684초). 테스트 제외·단언 완화·기존 시간 제한 변경 없음. tsc 및 수정 파일 eslint 통과. 추가 코드 변경 없이 기존 검수 지적을 재검수할 수 있는 상태다.

- U397 수정 커밋: `0523915abe7022a179ecb34b6c5fe1133d260ffd`. 재검수 대상 `7c52b2c..0523915` 고정. 중단됐던 U397 실행의 정확한 표식 notifications-1793292684993-2f07e74b를 조회로 확인하고 기존 테스트 정리 절차로 사용자6명·매장2개·주문1개와 연결 데이터만 제거했다. 다른 실행 데이터는 변경하지 않았다.
- 최초 검수의 P2를 수정·회귀 검증했으나 재검수 판정은 아직 요청하지 못했다. 기존 세션 01a1871d-371c-79a1-bce6-429862a5561f의 Astra/xhigh 설정을 유지하고, 현재 환경에서 Herdr 패널 접근 예외에 대한 사용자 응답을 기다린다. 검수 통과로 기록하지 않는다.

### US9 재검수 통과 (2026-10-30 12:04 KST)

- 사용자 승인으로 HERDR_ENV가 없는 현재 환경에서 기존 검수 패널 접근을 재개했다. 사용자 최신 모델 결정은 Sol/high 고정이며 동시성·복구도 같은 설정을 쓴다. 기존 US9 세션 01a1871d-371c-79a1-bce6-429862a5561f의 화면 GPT-6.1-Sol high를 요청 전후 확인했다.
- 검수 고정 범위 `7c52b2c..0523915`, 판정: 통과. 기존 P2 동시 최초 읽음의 P2002/409가 해결됐으며 추가 차단 결함은 발견하지 못했다.
- 검수자가 직접 단위12개 및 실제 DB 알림 E2E9개를 단독 실행해 모두 통과했다. U397은 두 INSERT의 PostgreSQL 잠금 대기 뒤 모두200·같은 최초 readAt·Receipt1건을 직접 확인했다. 반복 읽음·공동 점주별 분리·미읽음·권한 거부도 통과했다.
- 전체 단위600/E2E179·타입·린트는 구현 담당의 실제 실행 기록을 확인한 범위이며 검수자가 전체 회귀를 다시 실행한 것은 아니다. 최초 기록의 줄끝공백4곳 보존과 검사 범위 정정, 수정 범위 diff 검사 통과도 확인했다.
- 검수자는 파일 수정·커밋 없이 사용자 미커밋 변경을 보존했다. US9 T156~T168·T188 검수 관문을 통과했다. 이후 변경은 이 판정 기록뿐이며 운영 코드는 0523915와 같다.

### 개발 데이터 폐기 결정에 따른 최종 검증 범위 정리 (2026-10-30)

- 사용자 결정: 서비스 전 개발 프로젝트이며 개발 데이터를 폐기할 수 있다. 과거 환불 이관 도구·과거 운영 데이터 복제본 검증·구버전 중지/전환/재개 절차를 제외한다. FR-007a·INV-1과 T169·T170·U262~U266에 제외 근거를 표시했다. 제외를 구현 완료로 계산하지 않는다.
- 빈 DB의 스키마·제약 재구축, 이전 코드 정리, 동시성·장애 복구·전체 회귀·실제 PG 실연동 전 확인은 유지한다. T174 코드 참조 정리 뒤 T171 테이블 제거를 검증하도록 작업 순서를 맞췄다. 현재 마이그레이션 통합·LEGACY 호환 코드 제거를 실행한 것은 아니다.
- 기존 과거 이력 호환 값·U17/U248 완료 테스트는 기존 구현/검증 기록으로 구분했다. 신규 환불의 금액·판정·동의·지급·권한 규칙과 서비스 시작 후 지급 기록 보존은 변경하지 않았다.
- 검토: 수정 전후 8개 문서의 대상·조건·동작을 대조하고 제외/유지 작업·테스트 매핑과 변경한 절 앵커를 확인한다. 문서 범위 변경만 수행했으므로 소스·스키마·DB 데이터는 변경하지 않고 단위/E2E도 재실행하지 않는다.
- 사용자 기존 표현 교정은 작업 파일에 보존하며, 커밋은 기준 HEAD에 이번 범위 변경만 적용한 patch로 분리한다. 이번 새 검수 대화도 Sol/high 고정으로 준비한다.

### 개발 데이터 폐기 범위 문서 검수 1차와 수정

- Sol/high, 고정 범위 df02faa..83c717f 판정: 수정 필요. P3 1건: tasks.md 완료 기준에 '전환 검증'이 남아 있어 제외한 운영 서버 전환을 배포 선행 조건으로 읽을 수 있다. 이를 '빈 DB 재구축·최초 배포 검증'으로 구체화했다.
- 검수자는 FR-007a만 변경되고 나머지 FR59개·SC25개·인수 목록92개 행이 유지됐으며 U262~U266만 제외됐음을 확인했다. 원장 중복 방지·서비스 시작 후 기록 보존·실제 PG 확인도 유지됐다. 다른 차단 문제는 없었다.
- 고정 문서와 연결 절·관련 코드/테스트 원문·앵커·diff 검사는 확인했으나 DB 재구축·동시성·장애 복구·전체 회귀·실제 PG는 실행하지 않았다. 이번 수정도 문서뿐이며 DB·소스·스키마·테스트를 변경하지 않았다.

### 개발 데이터 폐기 범위 문서 재검수 통과

- 같은 작업 세션 01a18ad0-0210-7dc2-b85d-5e60824bb46d의 GPT-6.1-Sol high가 `83c717f..5a28ae0`을 재검수해 통과 판정했다. tasks.md 완료 기준이 빈 DB 재구축·최초 배포 검증으로 구체화되어 Phase 13·T171·T176과 일치하고 기존 P3가 해결됐음을 확인했다.
- 직접 확인 범위는 수정 diff 전체·주변 완료 기준/작업 순서·검수 기록·고정 범위 diff 검사다. DB 재구축·동시성·장애 복구·전체 회귀·실제 PG 실행을 검증한 판정이 아니다. 검수자는 파일 수정·커밋·DB 테스트를 하지 않았다.
- 문서 범위 정리만 완료했다. 남은 구현은 T174의 이전 환불 코드 정리 후 T171의 빈 DB 스키마·제약 재구축 검증과 T172~T178의 최종 기능 검증이다. T169·T170은 구현 완료가 아닌 범위 제외로 남는다.

### T174/T171 준비와 기준선 (2026-10-30)

- mandatory before_implement 훅 speckit.tdd.run을 실행 절차로 적용했다. feature resolver는 /Users/felix/Develop/practice/my-kiosk/specs/002-refund-completion을 반환했다. 기존 체크리스트의 최종 검증 미완료 항목은 유지하며 사용자 재개 승인에 따라 진행한다.
- 구현 변경 전 단위600/E2E179 전체 직렬 실행 통과. 기존 사용자 문서·주석·설정 변경은 유지하고 정리 대상 원문을 /tmp/refund-finalize-before.json에 보존했다.
- 구형 RefundService 테스트7개·항상 NOT_FOUND를 반환하는 PG 특성화1개·구형 콜백 호환 테스트1개의 정리 범위를 헌법III/T174에 따라 사용자에게 구체적으로 확인 요청했다. 아직 이 테스트나 운영 코드를 삭제/변경하지 않았다. 신규 시스템 취소·PG 분류·고객/매장 환불·원장 회귀는 유지한다.
- 현재 개발 DB를 변경하지 않고 my_kiosk_refund_verify_20261030_1302를 새로 생성했다. 기존 마이그레이션91개를 빈 DB에 전부 적용해 `All migrations have been successfully applied.`를 확인했다. 이는 정리 전 마이그레이션 기준선이며 RefundLock 제거·필수 연결 확정 작업이 완료됐다는 의미가 아니다.
- 새 작업 검수 세션 01a18afd-d56c-7270-a096-2b964ed5f290에서 Sol/high 역할을 수락했고 정식 검수 요청 전에는 파일 수정·테스트·판정 없이 대기한다.

- 새 검증 DB의 현재 스키마 비교: `No difference detected.`. 재구축 DB에서 전체 단위600개(17.852초)·E2E179개(42.384초) 직렬 실행 통과. 실제 단위/E2E 로그는 /tmp/refund-verify-unit.log·/tmp/refund-verify-e2e.log, 마이그레이션 로그는 /tmp/refund-verify-migrate.log에 보존했다. 테스트 뒤 별도 스키마 비교로 원복 상태를 재확인한다.
- 기존 테스트9개 정리에 대한 사용자 확인은 아직 도착하지 않았다. 따라서 운영 소스·스키마와 기존 테스트는 이 작업에서 변경하지 않았다. 새 검증 DB는 후속 T171 검증에 재사용하도록 이름을 검수 세션 기록에 남겼고 현재 개발 DB는 초기화하지 않았다.

- 사용자 확인(2026-10-30 14:31 KST): 앞서 구체적으로 제시한 기존 테스트9개 정리에 대해 "승인"이라고 답했다. 이는 구형 RefundService 테스트7개·구형 PG 특성화1개 폐기와 옛 콜백 호환1개 정리에 한하며, 신규 환불 테스트의 단언 완화·제외를 허용하는 뜻이 아니다. 이 승인 후 테스트 정리를 진행한다.

### 승인된 구형 테스트9개 정리

- 운영 구현을 바꾸기 전에 사용자 승인된 구형 RefundService 테스트7개, PG의 무조건 NOT_FOUND 특성화1개, 구형 콜백 null 대상409 호환1개를 정리했다. 이 동작들은 현재 환불의 처리 시점/대상 또는 폐기한 이관 호환 경로에 관한 테스트다. 실패를 숨기기 위해 삭제한 것이 아니며 사용자 승인과 폐기 대상을 먼저 기록했다.
- 기존 성공/실패 콜백 대상 대조·PG authoritative 분류·고객/매장/SYSTEM 환불·원장/중복 지급 테스트는 그대로 유지한다. U50은 완료가 아닌 DROPPED로 기록한다. 다음 별도 사이클에서 환불에 연결되지 않은 콜백을 거절하는 회귀를 먼저 실패시키고 구현한다.

- 테스트 정리 뒤 단위591개 통과(600-승인된9개). E2E178 passed·1 failed: seat-type QS-13 준비 입실이 `expected 201 "Created", got 500 "Internal Server Error"`로 실패했다. 실제 오류는 `재시도 4회차 실패: 성공 조건 미충족`, UsageSessionService.createSession의 mockExternalApi 재시도 경로다. 해당 함수는 Math.random()<0.1일 때 false를 반환하며 운영 소스는 이 단계에서 변경하지 않았다. 기존에 알려진 비결정적 모의 API 경로의 실패를 기록하고 단언/조건/실행대상 완화 없이 전체 E2E를 재실행한다.

- 같은 전체 E2E 재실행179개 통과(38.676초). 승인된 테스트 폐기로 단위 총계는600→591이며 신규 환불 동작의 회귀179개는 유지했다. 운영 구현 변경 전의 별도 테스트 정리 단계로 커밋한다.

### U398 콜백 연결 필수 red

- 테스트만 먼저 추가하고 `npx jest src/refund/refund-result.service.spec.ts -t U398 --runInBand` 실행.
```text
    expect(received).rejects.toBeInstanceOf()

    Received promise resolved instead of rejected
    Resolved to value: undefined
Tests:       1 failed, 1 total
```
- 환불에 연결된 요청이 없는데 기존 호환 서비스가 처리해 정상 종료하는 실제 실패를 기록했다. 이 기록 뒤 receiveCallback의 옛 경로 분기를 제거해 모든 콜백을 공통 결과 처리로 보낸다.

- U398 green: 같은 테스트1개 통과, 전체 단위592개·E2E179개 통과. 환불에 연결된 시도를 찾지 못하면 공통 콜백 처리의 기존 PG_CALLBACK_TARGET_NOT_FOUND(404)로 거절한다. 금액·동의·지급 상태 규칙은 바꾸지 않았다. 사용하지 않는 클래스·메서드는 다음 별도 구조 정리에서 제거한다.

### T174 사용하지 않는 구형 구현의 구조 정리

- U398 동작 변경이 전체 회귀를 통과한 상태에서, 더는 호출되지 않는 RefundService·그 전용 Repository 메서드·구형 PG 전송/무조건 NOT_FOUND 조회·구형 PG 타입과 Nest 등록/내보내기를 제거한다. U398 단언은 보존하고 생성자 의존성 변경만 테스트 구성에 반영한다. 지급 서비스의 제거된 PG 메서드 참조 주석은 기존 실패 반환 동작을 바꾸지 않고 설명했다.
- 삭제할 RefundService에 있던 사용자 미커밋 메모를 포함한 원문은 /tmp/refund-finalize-before.json에 보존했다. 신규 환불 경로의 사용자 주석·문서·설정 변경은 건드리지 않았다. RefundLock 스키마/테이블은 다음 T171 검증 사이클 전까지 유지한다.

- 構造整理の確認: 정정하여 "구조 정리 검증"으로 읽는다. 전체 단위592개·E2E179개, tsc 통과. U398 단언은 유지했으며 기존 생성자·목에서 제거된 의존성만 정리했다. U50 폐기 후 T015의 유효 동작 U51~U58이 모두 DONE임을 확인해 T015를 완료 표시했고 T174도 코드 정리 범위에서 완료 표시한다. 아직 DB의 RefundLock 테이블이나 필수 FK/시도 번호 제약은 변경하지 않았다.

### U399 PG 취소 요청의 환불 연결 필수 red

- `npx jest src/prisma/refund-constraints.integration.spec.ts -t U399 --runInBand`
```text
    expect(received).rejects.toThrow()

    Received promise resolved instead of rejected
    Resolved to value: 1
Tests:       1 failed, 38 skipped, 39 total
```
- 실제 PostgreSQL에서 refund_id를 생략한 INSERT가 성공하는 실패를 먼저 확인했다. 이 기록 뒤 DB NOT NULL과 Prisma 필수 관계를 적용한다.

- U399의 Prisma 필수 관계를 생성하자 seed.ts가 환불 없이 PG 취소 요청을 만드는 옛 helper 때문에 타입 오류가 발생했다. 이 시드는 같은 상품의 여러 부분 환불과 RefundLock을 만드는 폐기한 예제이므로, 새 정책에 맞는 것으로 추정해 변환하지 않고 해당 helper/예제만 제거한다. 현재 환불 데이터는 실제 API를 쓰는 E2E 공용 컨텍스트가 생성한다. 일반 주문·이용권 시드는 유지한다. 원문은 /tmp/refund-seed-before-cleanup.ts에 보존했다.
- SYSTEM 재시도 테스트의 기대값은 그대로 두고, 준비 과정에서 refundId를 잠시 null로 분리하던 부분만 같은 트랜잭션의 대상 변경으로 바꿨다. 전체 단위593개/E2E179개가 새 연결 필수 제약 아래 통과했다. required FK가 모든 행을 보장하므로 집계의 중복된 not-null 필터도 제거했다.

- U399 검증 DB green: 단일1개·전체 단위593개·E2E179개 통과, 타입 검사 통과. seed.ts 서식 검사는 수정 전 원문에서도 실패하는 기존 상태여서 무관한 전체 서식 변경은 하지 않았다. 현재 변경 공백 검사와 수정 Repository/통합 테스트 eslint는 통과했다.
- 로컬 개발 DB reset은 Prisma 자체 Codex 보호 장치가 실행 전에 차단했다. 데이터 초기화는 실행되지 않았다. 이 장치는 경고 뒤 새 명시적 동의를 요구하고 이전 메시지를 동의로 인정하지 않는다고 안내해, 정확한 명령 npx prisma migrate reset --force·로컬 my_kiosk_db 대상·데이터 삭제 효과를 설명하고 사용자에게 새 확인을 요청했다. 확인 전에는 보호 환경변수를 설정하거나 우회하지 않는다. 이 커밋의 회귀는 별도 검증 DB에서 실행한 범위다. 현재 개발 DB 반영과 최종 T171 완료 표시는 보류한다.

### U400 PG 취소 요청의 시도 번호 필수

- 별도 검증 DB에서 `node /tmp/refund-verify-db.cjs single U400`을 실행했다.
```text
Received promise resolved instead of rejected
Resolved to value: 1
Tests: 1 failed, 39 skipped, 40 total
```
- attempt_number를 생략한 실제 INSERT가 성공하는 실패를 먼저 확인했다. 이 기록 뒤 NOT NULL과 Prisma 필수 필드를 적용한다.
- 필수 필드로 생성한 Prisma 타입에서는 null 정렬 옵션을 허용하지 않아 환불 조회의 시도 번호 정렬을 desc로 단순화했다. 모든 행의 번호가 필수인 조건에서 최신 시도 정렬 결과는 같다. 기존 조회 테스트 단언은 유지한다.
- U400 green: 별도 검증 DB의 단일 테스트1개·전체 단위594개·E2E179개와 타입 검사 통과. 93개 마이그레이션 적용 상태에서 확인했다.

### U401 PG 취소 시도 번호의 하한

- 별도 검증 DB에서 `node /tmp/refund-verify-db.cjs single U401`을 실행했다.
```text
Received promise resolved instead of rejected
Resolved to value: 1
Tests: 1 failed, 40 skipped, 41 total
```
- 0번 시도를 DB가 저장하는 실제 실패를 먼저 확인했다. 이 기록 뒤 1 이상 CHECK 제약을 적용한다. 1번 저장은 기존 제약 통합 테스트에서 계속 검증한다.
- U401 green: 0·음수 거절 단일 테스트1개와 전체 단위595개·E2E179개가 별도 DB에서 통과했다(94개 마이그레이션).

### U402 폐기한 환불 잠금 테이블 제거

- 별도 검증 DB에서 `node /tmp/refund-verify-db.cjs single U402`를 실행했다.
```text
expect(received).toBeNull()
Received: "refund_locks"
Tests: 1 failed, 41 skipped, 42 total
```
- 현재 마이그레이션이 옛 테이블을 남기는 실제 실패를 확인했다. 이 기록 뒤 테이블·Prisma 모델·테스트/시드 정리 참조를 제거한다. 현재 트랜잭션의 행 잠금을 구현하는 RefundLockingRepository는 보존한다.
- U402 green: 별도 DB에서 단일1개·전체 단위596개·E2E179개 및 타입 검사 통과. 95개 마이그레이션으로 구형 잠금 테이블을 제거했다. 최초 빈 DB 전체 재적용은 다음 검증에서 확인한다.

### T171 빈 DB 전체 마이그레이션 확인

- 별도 새 DB `my_kiosk_refund_fresh_20261030_1647`에 이전 이력 포함 전체 95개 마이그레이션을 순서대로 적용했다. `prisma migrate status`는 최신, 실제 DB와 Prisma 스키마 차이 검사는 `No difference detected`였다.
- 새 DB에서 개발 시드를 두 차례 실행해 정리·재생성이 모두 성공했다. 해당 DB에서 전체 단위596개·E2E179개가 통과했다. U399~U402가 필수 환불 연결·시도 번호 필수/양수·구형 잠금 테이블 부재를 실제 DB로 검증한다. 기존 금액·고유 제약 테스트도 같은 전체 단위 실행에 포함했다.
- 원래 로컬 개발 DB `my_kiosk_db`의 초기화는 Prisma 보호 경고 이후 별도 명시적 확인이 없어 실행하지 않았다. T171의 빈 DB 검증은 위 새 DB를 대상으로 완료했으며, 개발 DB 초기화는 별도 운영 선택으로 남는다.

### T174·T171 Sol/high 검수

- 고정 범위 `4901acc..3330088`, 검수 대화 `01a18afd-d56c-7270-a096-2b964ed5f290`. 검수 담당은 구형 서비스/호출처 제거, 현행 환불·잠금 경로, U398~U402 제약, 기존 91개 마이그레이션 불변과 신규 4개 적용 기록을 명세·계약과 정적으로 대조했다. 판정은 **통과**이며 수정 결함은 없었다.
- 검수 담당은 DB·테스트·타입 검사를 직접 실행하지 않았고, 구현 담당의 로그를 확인했다. T172~T178 동시성·중단 복구·전체 인수/실제 PG 검증은 별도 범위로 남는다. 원래 로컬 개발 DB의 초기화는 실행하지 않았으며 T171의 빈 검증용 DB 검증과 구분한다.

### T172 U403 고객·점주 동시 접수

- 새 HTTP E2E는 첫 실행에서 통과했다. 현재 구현에 두 경로의 중복 접수 방지가 이미 있으므로 테스트 사후 검증으로 기록한다.
- 기존 환불 진행 중 판정만 해제한 뮤턴트에서는 U403이 실패하지 않았다. 해당 판정 하나만으로 중복 접수가 되는 것은 아니며, DB 고유 제약·이용권 잠금이 남아 있기 때문이다. 뮤턴트는 정확히 원복했다.
- 커밋 뒤 PG 전송을 생략한 뮤턴트에서는 전체 E2E에서 U403이 `Expected length: 1 / Received length: 0`으로 실패했다. 이 뮤턴트도 원복했다. 따라서 U403의 PG 전송 횟수 단언이 관찰 가능하게 실패함을 확인했지만, 모든 중복 경쟁 결함을 검출한다는 뜻은 아니다. 이후 경쟁 시나리오는 동기화 지점과 저장 수 검증을 보강한다.
- U403 서식 정리 뒤 전체 단위596개·E2E180개, 타입 검사·신규 파일 eslint 통과. T172의 나머지 경합은 아직 진행 중이다.

### T172 U403 Codex 검수 1차 수정

- 고정 검수 범위 `3edbb48..2efbf42`: P2 두 건 수정 필요. Promise.all만으로 두 요청의 처리 구간이 겹쳤는지 보장하지 못했고, 패한 요청의 오류 코드를 단언하지 않았다.
- U403에서 고객 요청의 이용권 잠금·재조회 완료를 대기시킨 뒤 점주 요청이 같은 대상 처리에 들어왔음을 확인하고, 고객의 트랜잭션이 열린 동안 점주 요청은 끝나지 않는지 확인한 다음 고객 요청을 풀도록 동기화했다. 패한 점주 요청은 409 `REFUND_IN_PROGRESS`를 검증한다.
- 수정된 U403의 실제 코드에서 단일 E2E 1개가 통과했다. 잠금 뒤 재조회를 `return unlocked`로 바꾼 임시 뮤턴트에서는 동일한 두 요청 중 점주 요청이 `P2002`로 거절되어 `Expected: "REFUND_IN_PROGRESS" / Received: "P2002"`로 U403이 실패했다. 뮤턴트는 원문과 같게 원복했다.
- 원복·서식 정리 후 단위596개·E2E180개, 타입 검사 및 수정 E2E eslint 통과. 재검수 전 고정 커밋을 별도로 기록한다.

### T172 U403 Codex 재검수 1차 수정

- 고정 범위 `2efbf42..fb402d9`의 재검수는 P2-2 해결, P2-1 일부 미해결이었다. 종전 storeEntered 신호가 최초 DB 읽기 전에 발생해 실제 경합 대기 지점을 보장하지 못했다.
- 점주 요청의 `findLockedTarget` 진입을 식별하고 그 요청의 첫 `findCustomerRefundTarget` 읽기 전에 100ms를 지연한다. 그 읽기가 완료된 뒤 `RefundLockingRepository.lockForAcceptance`에 진입한 신호를 받아서만 고객 트랜잭션을 풀었다. 따라서 고정 지연 시간은 점주 읽기 완료의 판정 근거가 아니다.
- 처음에는 전체 읽기 횟수 3회로 점주 읽기를 구분했으나 재조회 누락 뮤턴트에서 고객 조회 횟수가 달라져 `Expected: >= 3 / Received: 2`로 선행 실패했다. 해당 표본은 버리고 점주 요청 자체를 식별해 지연·완료를 확인하도록 정정했다.
- 정정한 U403은 정상 코드에서 단일 E2E 1개 통과했다. 잠금 뒤 재조회를 `return unlocked`로 바꾼 뮤턴트는 점주의 최초 읽기를 지연시켜도 `Expected: "REFUND_IN_PROGRESS" / Received: "P2002"`로 실패했다. 뮤턴트는 정확히 원복했다.
- 원복 뒤 단위596개·E2E180개, tsc·수정 파일 eslint 통과. 변경은 U403 테스트와 검증 기록뿐이며 운영 코드는 그대로다.

### T172 U403 Codex 재검수 2차 판정

- 고정 범위 `fb402d9..a9e9cf2`, 같은 검수 대화 `01a18afd-d56c-7270-a096-2b964ed5f290`, Sol/high. 검수 담당은 점주 최초 읽기 완료 뒤 잠금 시도 gate, 409 `REFUND_IN_PROGRESS`, 중복 기록·PG 송신 한 건 단언을 정적으로 대조해 **통과** 판정했다.
- 검수 담당은 공유 DB·테스트·타입/린트를 직접 실행하지 않고 로그와 변경 diff를 확인했다. T172의 다른 경쟁 시나리오와 T173 이후는 여전히 미검증이다.

### T172 U404 입실·환불의 잠금 경쟁

- 고정석 정기권 입실 트랜잭션이 이용권 잠금 뒤 세션 생성 전 확인 지점에서 멈춘 상태에서 고객 환불이 공유 잠금 호출에 들어온 것을 관찰하고 입실을 이어 갔다. 입실 201, 환불 409 `USED_TICKET`, 환불 기록0·활성 세션1·이용권 ACTIVE·PG 전송0을 HTTP와 실제 DB에서 검증한다.
- U404는 기존 구현에서 처음부터 통과한 사후 동시성 검증이다. 입실 트랜잭션의 Ticket `FOR UPDATE`를 임시 제거한 뮤턴트에서는 `Expected: 409 / Received: 500`으로 실패했다. 원본 SQL을 정확히 복구했다. 초기 테스트의 가변 인자 타입 오류는 테스트 구성 오류여서 타입에 맞는 명시적 인자로 수정했고, 업무 단언은 바꾸지 않았다.
- 최종 단일 U404 통과, 단위596개·E2E181개, tsc·수정 E2E eslint 통과. T172의 남은 경쟁은 계속 진행한다.

### T172 U404 Codex 검수 1차 수정

- 고정 범위 `fe7cd39..180fe96` 검수: U404의 동기화·단언은 수용됐고, test-list 근거의 FR-029·FR-017은 U404에서 적용되지 않아 수정 필요(P3)였다.
- U404는 입실이 먼저 성공한 이용권의 사용 이력 판정(FR-003), 거절 코드(FR-005), 거절 시 새 환불·PG 취소 요청을 남기지 않음(FR-007)을 검증한다. 잠금 경쟁 순서는 계약 §6과 T172에 연결했다. 테스트·업무 규칙은 바꾸지 않았고 이번 문서 교정으로 테스트를 재실행하지 않았다.

### T172 U404 Codex 재검수 판정

- 고정 범위 `180fe96..97485a5`, 검수 대화 `01a18afd-d56c-7270-a096-2b964ed5f290`, Sol/high. U404의 직접 근거를 FR-003·FR-005·FR-007 및 계약 §6으로 정정한 내용과 인접 U398~U403 추적 보존을 정적으로 대조해 **통과** 판정했다.
- 검수 담당은 문서 수정 후 테스트·DB·타입·린트를 직접 실행하지 않았다. U404 정상 동작의 마지막 전체 실행은 단위596개·E2E181개다. T172 나머지 경합과 T173 이후는 미완료다.

### T172 U405 개별 PG 조회와 성공 콜백의 경합

- 개별 PG 조회가 `IN_PROGRESS` 결과를 받은 뒤 결과 반영 직전에 멈추게 했다. 그사이 성공 콜백을 HTTP 200으로 반영한 다음 조회를 이어 가도록 동기화했다. 실제 DB에서 해당 PG 취소 요청이 `SUCCEEDED`, 환불금 지급 상태가 `PAID`, 실제 지급액이 접수 금액, 원장이 한 건인지 확인한다. PG 조회 호출도 한 번이다.
- U405는 기존 구현에서 처음부터 통과한 사후 동시성 검증이다. `RefundRepository.scheduleNextInquiry`의 담당 토큰 조건을 임시로 제거하자 `Expected: "SUCCEEDED" / Received: "REQUESTED"`로 실패했다. 늦은 조회가 확정된 시도 상태를 덮어쓰는 결함을 단언이 검출한 것이다. 담당 토큰 조건을 정확히 복구한 뒤 U405가 다시 통과했다.
- 원본 복구 후 단위596개·E2E182개, `tsc --noEmit` 및 수정 E2E eslint가 통과했다. 운영 코드 변경은 없으며 T172의 다른 경합은 계속 진행한다.

### T172 U405 Codex 검수 1차 수정

- 고정 범위 `7e19346..9ab4133` 검수에서 U405의 경합 동기화·최종 상태 단언은 수용됐다. 다만 test-list의 FR-023은 PG 조회가 성공·실패로 확정된 경우에 적용되며, U405의 조회 결과는 `IN_PROGRESS`이므로 직접 근거가 아니었다.
- U405의 직접 근거를 개별 확인에서 처리 중 결과를 지급 완료로 추정하지 않는 FR-053과 계약 §8로 바꿨다. 성공 콜백의 실제액·원장·한 번만 반영하는 동작을 설명하는 FR-018·FR-019와 계약 §6·§7은 유지했다. 테스트·업무 규칙은 바꾸지 않았고 이번 추적 문서 수정 후 테스트는 재실행하지 않았다.

### T172 U405 Codex 재검수 판정

- 고정 범위 `9ab4133..892a8d8`, 같은 검수 대화 `01a18afd-d56c-7270-a096-2b964ed5f290`, Sol/high. 검수 담당은 FR-023 제거와 FR-053·계약 §8 연결이 U405의 `IN_PROGRESS` 조회 및 콜백 선행 확정에 맞음을 확인해 **통과** 판정했다.
- 검수 담당은 문서 수정 뒤 테스트·DB·타입·린트를 직접 실행하지 않았다. U405 정상 동작의 마지막 전체 실행은 단위596개·E2E182개다. T172 나머지 경합과 T173 이후는 미완료다.

### T172 U406 점주 개별 조회와 자동 조회의 경합

- 점주가 `POST /refund/:refundId/pg-check`로 개별 확인을 시작해 PG 조회 응답을 기다리는 동안, 자동 작업 경로인 `RefundRecoveryService.inquireAttempt`를 같은 PG 취소 요청에 실행했다. 자동 경로는 담당을 다시 맡지 않아 PG 조회를 한 번만 호출해야 한다. 개별 확인을 끝낸 뒤 조회 횟수 1회, PG 취소 요청 `REQUESTED`, 환불금 지급 `PENDING`, 원장 0건을 실제 DB에서 확인한다.
- U406은 기존 구현에서 처음부터 통과한 사후 동시성 검증이다. `RefundRecoveryService.claimForInquiry`의 유효 담당 기한 확인을 임시로 제거하자 자동 경로가 `IN_PROGRESS` 결과를 반환해 `Expected: null / Received: "IN_PROGRESS"`로 실패했다. 개별 확인 요청이 끝나도록 테스트 단언을 정리한 뒤에도 동일한 변이가 실패함을 다시 확인했다. 담당 기한 확인은 원문과 같게 복구했다.
- 원본 코드에서 U406 단일 E2E 통과, 전체 단위596개·E2E183개 통과를 확인했다. 단언 순서 정리 후 U406 단일 E2E와 `tsc --noEmit`·수정 E2E eslint가 다시 통과했다. 운영 코드 변경은 없으며 T172의 다른 경합은 미완료다.

### T172 U406 Codex 검수 판정

- 고정 범위 `2704367..79840b9`, 같은 검수 대화 `01a18afd-d56c-7270-a096-2b964ed5f290`, Sol/high. 검수 담당은 개별 조회가 담당 기록을 커밋하고 PG 호출에서 대기한 뒤 자동 경로가 유효한 담당 기한을 보고 PG를 중복 호출하지 않는 순서를 확인해 **통과** 판정했다.
- 검수 담당은 DB·테스트·타입·린트를 직접 실행하지 않았다. U406의 자동 조회 선행 반대 방향, sweep 대상 선택·큐 처리, 담당 만료 경계, T172의 다른 경합 및 T173 이후는 미검증이다.

### T172 U407 자동 조회 선행과 점주 개별 확인의 경합

- 자동 경로 `RefundRecoveryService.inquireAttempt`가 PG 조회 응답을 기다리게 한 뒤, 점주의 `POST /refund/:refundId/pg-check`를 실행했다. 개별 확인은 계약 §8에 따라 202 `ALREADY_RUNNING`을 반환하고, PG 조회는 한 번만 호출해야 한다. 자동 조회를 끝낸 뒤 DB 조회 횟수 1회와 PG 취소 요청 `REQUESTED`를 확인한다.
- 최초 U407 테스트는 진행 중 응답을 200으로 잘못 기대해 `Expected: 200 / Received: 202`로 실패했다. 계약 §8의 202 `ALREADY_RUNNING`을 확인하고 테스트 기대값을 정정했다. 이 실패는 구현 결함의 red로 계산하지 않는다. 정정 후 기존 구현에서 U407이 통과했다.
- `RefundPgCheckService`의 유효 담당 안내 분기를 임시 제거한 변이에서는 최근 조회 응답으로 바뀌어 `Expected: 202 / Received: 200`으로 실패했다. 분기를 원문과 같게 복구한 뒤 단위596개·E2E184개, `tsc --noEmit` 및 수정 E2E eslint가 통과했다. 운영 코드 변경은 없다.

### T172 U407 Codex 검수 1차 수정

- 고정 범위 `a24e094..01908df` 검수에서 정상 코드의 202 `ALREADY_RUNNING` 응답과 추적 근거는 수용됐다. 다만 U407의 PG 대역이 모든 조회 호출을 같은 gate에서 멈춰, 중복 조회가 발생하면 HTTP 응답과 gate 해제가 순환 대기하는 결함(P2)이 지적됐다.
- U407은 첫 PG 조회만 대기시키고 이후 호출은 기록 후 반환하게 고쳤다. 개별 확인 HTTP가 끝나고 자동 조회도 정리된 뒤, gate 해제 전 PG 조회 호출 수를 먼저 단언한다. 기존 U403~U406 본문과 운영 코드는 바꾸지 않았다.
- 정상 코드에서 수정된 U407 단일 E2E가 통과했다. 개별 확인의 진행 중·최근 조회 확인과 잠금 안의 담당·최근 조회 확인을 임시로 제거해 두 번째 PG 호출을 허용한 변이에서는 타임아웃 대신 `Expected: 1 / Received: 2`로 실패했다. 모든 확인 조건을 원문과 같게 복구했다.
- 원복 후 단위596개·E2E184개, `tsc --noEmit`·수정 E2E eslint 및 `git diff --check`가 통과했다. 변경은 U407 테스트와 검증 기록뿐이다.

### T172 U407 Codex 재검수 판정

- 고정 범위 `01908df..a74b9ea`, 같은 검수 대화 `01a18afd-d56c-7270-a096-2b964ed5f290`, Sol/high. 검수 담당은 첫 PG 호출만 gate에 두는 수정과, 두 번째 호출 변이가 타임아웃 없이 호출 수 단언에서 실패한 기록을 대조해 **통과** 판정했다.
- 검수 담당은 DB·테스트·타입·린트를 직접 실행하지 않았다. 자동 sweep·큐 처리, 담당 만료·최근 조회 경계, T172의 다른 경합 및 T173 이후는 미검증이다.

### T172 U408 실패 시도 개별 조회와 운영자 지급 재처리의 경합

- 최초 PG 취소 요청이 `FAILED/PG_REJECTED`인 환불을 만들고, 점주의 개별 확인이 PG 조회 응답을 기다리게 했다. 조회 담당이 유효한 동안 운영자가 새 PG 취소 요청과 별도 환불금 지급 예약을 각각 시도한다. PG 재요청을 먼저 시도하는 순서와 예약을 먼저 시도하는 순서를 모두 실행해 두 요청이 409 `REFUND_PAYOUT_UNRESOLVED`로 거절되고, PG 조회 호출은 한 번이며 새 PG 요청·별도 지급 예약·PG 전송이 생기지 않는지 확인한다.
- U408 두 순서는 기존 구현에서 처음부터 통과했다. `hasUnresolvedPayout`에서 실패한 시도의 유효 조회 담당 기한 확인을 임시로 제거하자 PG 재요청 선행에서는 `Expected: 409 / Received: 202`, 별도 지급 예약 선행에서는 `Expected: 409 / Received: 201`로 각각 실패했다. 변이를 원문과 같게 복구했다.
- 원복과 테스트 서식 정리 뒤 단위596개·E2E186개, `tsc --noEmit` 및 수정 E2E eslint가 통과했다. 운영 코드·스키마 변경은 없고 T172의 남은 경합은 계속 진행한다.

### T172 U408 Codex 검수 판정

- 고정 범위 `fe25c55..1ef6b88`, 검수 대화 `01a18afd-d56c-7270-a096-2b964ed5f290`. 검수 담당은 실패 시도 개별 조회의 담당 기록과 운영자 PG 재요청·별도 지급 예약의 차단 조건, 두 실행 순서의 변이 실패 기록을 대조해 **통과** 판정했다. 사용자는 이후 검수 모델을 Sol/medium으로 유지하기로 결정했다.
- 검수 담당은 DB·테스트·타입·린트를 직접 실행하지 않았다. 다른 실패 사유·담당 만료 경계·조회 결과별 처리와 T172의 남은 경합, T173 이후는 미검증이다.

### T172 U409 별도 지급 증빙 반복 등록 경합

- PG 취소가 거절된 환불에 별도 환불금 지급을 예약한 뒤, 운영자가 같은 거래 식별자·금액·지급 시각·증빙을 서로 다른 멱등 키로 두 번 등록한다. 첫 요청이 Refund 잠금을 잡고 지급 결과 저장 직전에 멈춘 동안 두 번째 요청이 같은 잠금 호출에 들어온 것을 확인하고 첫 요청을 이어 간다. 두 응답이 같은 성공 결과를 돌려주고, 실제 지급액은 한 번만 더해지며 별도 지급·음수 원장은 각각 한 건인지 실제 DB에서 확인한다.
- U409는 기존 구현에서 처음부터 통과했다. `RefundOperationsService.confirmManualPayout`의 이미 성공한 같은 지급 결과 반환 분기를 임시로 건너뛰자 두 번째 응답이 `Expected: 200 / Received: 409`로 실패했다. 변이를 원문과 같게 복구했다.
- 원복 후 단위596개·E2E187개, `tsc --noEmit` 및 수정 E2E eslint가 통과했다. 운영 코드·스키마는 바꾸지 않았다.

### T172 U409 Codex 검수 판정

- 고정 범위 `6a727ec..56f7fd6`, 검수 대화 `01a18afd-d56c-7270-a096-2b964ed5f290`, Sol/medium. 검수 담당은 두 요청의 Refund 잠금 경합, 같은 증빙의 반복 성공 반환, 지급액·원장 한 번 반영과 DB 고유 제약을 대조해 **통과** 판정했다.
- 검수 담당은 DB·테스트·타입·린트를 직접 실행하지 않았다. 다른 증빙·거래 식별자, 실패 예약과의 경쟁, 중단 복구, T172의 다른 경합 및 T173 이후는 미검증이다.

### T172 U410 점주·운영자의 실패 시도 개별 조회 경합

- 최초 PG 취소 요청이 `FAILED/PG_REJECTED`인 환불을 만든 뒤, 점주와 운영자가 같은 환불을 개별 확인하는 두 순서를 실행했다. 선행 요청의 PG 조회가 응답을 기다릴 때 후행 요청을 보내고, 후행 요청은 202 `ALREADY_RUNNING`으로 응답하며 PG 조회·조회 횟수는 각 한 번인지 확인한다. 첫 PG 호출만 gate에서 대기시켜 중복 호출이 나더라도 테스트가 끝나도록 한다.
- U410 두 순서는 기존 구현에서 처음부터 통과했다. `checkFailedAttempt`의 유효 담당·최근 조회 확인만 제거하자 후행 요청이 202 대신 200으로 응답해 실패했다. 여기에 공통 지급 판정의 유효 담당 확인까지 임시 제거하자 두 순서 모두 PG 조회가 실제로 두 번 실행되어 `Expected: 1 / Received: 2`로 실패했다. 변이를 원문과 같게 복구했다.
- 원복과 테스트 서식 정리 뒤 단위596개·E2E189개, `tsc --noEmit` 및 수정 E2E eslint가 통과했다. 운영 코드·스키마 변경은 없다.

### T172 U410 Codex 검수 판정

- 고정 범위 `edeb937..f59a92d`, 검수 대화 `01a18afd-d56c-7270-a096-2b964ed5f290`, Sol/medium. 검수 담당은 점주·운영자 선행 두 순서의 담당 획득, 202 진행 중 응답, 중복 PG 조회 차단과 변이 실패 기록을 대조해 **통과** 판정했다.
- 검수 담당은 DB·테스트·타입·린트를 직접 실행하지 않았다. 담당 만료·최근 조회 간격 경계, 담당 획득 전 잠금 경쟁, 다른 PG 조회 결과, T173 이후는 이번 검수에 포함되지 않는다.

### T172 전체 검수와 U411 운영 지급 경로 직접 경쟁

- T172 전체 정적 감사에서 U403~U410 개별 통과는 유지됐으나, PG 재요청과 별도 지급 예약의 직접 경합, 조회와 콜백의 동시 성공 반영, 환불 선행 입실 경합이 미검증으로 확인됐다. T172 완료 표시는 보류한다.
- U411은 PG가 첫 취소 요청을 거절해 `FAILED/ACTION_REQUIRED`가 된 환불에서 시작한다. 운영자의 PG 재요청 또는 별도 지급 예약이 Refund 잠금을 잡고 새 기록 저장 직전에 멈춘 동안 다른 경로의 잠금 진입을 확인한 뒤 먼저 시작한 요청을 이어 간다. PG 재요청 선행은 새 PG 취소 요청 1건·예약 0건·PG 전송 1회, 예약 선행은 새 PG 취소 요청 0건·예약 1건·새 PG 전송 0회를 확인한다. 두 순서 모두 패한 요청은 409 `REFUND_PAYOUT_UNRESOLVED`, 원장은 0건이다.
- U411 두 순서는 기존 코드에서 처음부터 통과했다. 공통 `hasUnresolvedPayout`에서 별도 지급 예약과 미확정 PG 시도 확인을 임시로 제거하자, PG 재요청 선행은 `Expected REFUND_PAYOUT_UNRESOLVED / Received REFUND_PAYOUT_NOT_ACTIONABLE`, 예약 선행은 `Expected 409 / Received 202`로 실패했다. 임시 변경을 정확히 원복하고 단일 E2E 2개 통과를 확인했다.
- 원복 뒤 전체 단위 596개·E2E 191개, `tsc --noEmit` 및 수정 E2E 파일 eslint가 통과했다. 운영 코드·스키마 변경은 없다.

### T172 U411 Codex 검수 판정

- 고정 범위 `4955c26..3778925`, 검수 대화 `01a18afd-d56c-7270-a096-2b964ed5f290`, Sol/medium. 검수 담당은 두 지급 생성 경로가 모두 허용되는 상태에서 Refund 잠금을 직접 경합시키고, 승자별 기록·PG 호출 수와 패자 오류를 확인해 **통과** 판정했다. T172 전체 감사의 지급 생성 경로 직접 경쟁 누락은 해소됐다.
- 검수 담당은 DB·테스트·변이·타입·린트를 직접 실행하지 않았다. 조회와 콜백의 동시 성공 반영, 환불 선행 입실 경합 및 T172 전체 완료는 미검증이다.

### T172 U412 PG 조회·성공 콜백의 같은 결과 반영 경합

- PG 조회가 `SUCCEEDED`를 돌려주고 `Refund → PaymentCancel` 잠금을 잡은 상태에서 성공 시도 저장 직전에 멈췄다. 같은 거래 ID·실제액을 담은 서명 콜백이 결과 처리의 환불 잠금에 진입한 것을 확인하고 조회를 이어 갔다. 조회와 콜백 모두 HTTP 200이며, 같은 취소 시도의 성공 상태·실제액·지급 합계와 연결된 원장 한 건, PG 조회 한 번·추가 송신 없음을 확인한다.
- U412는 기존 코드에서 처음부터 통과했다. `RefundResultService.applyPgResult`의 확정 시도 재반영 방지를 임시로 제거하자 콜백이 지급별 원장의 unique 제약에 걸려 `Expected 200 / Received 503`으로 실패했다. 임시 변경을 원문대로 복구하고 단일 E2E가 다시 통과하는지 확인했다. 실패 로그는 `/tmp/refund-u412-mutant.log`에 보존했다.
- 원복 뒤 전체 단위 596개·E2E 192개, `tsc --noEmit`과 수정 E2E 파일 eslint가 통과했다. 운영 코드·스키마는 변경하지 않았다.

### T172 U412 Codex 검수 판정

- 고정 범위 `0fe8d87..dbba1c3`, 검수 대화 `01a18afd-d56c-7270-a096-2b964ed5f290`, Sol/medium. 검수 담당은 조회와 성공 콜백이 같은 결과 저장의 Refund 잠금에 경합하고 두 응답·실제액·지급별 원장·PG 호출 수를 확인해 **통과** 판정했다. T172 전체 감사의 동시 성공 반영 누락은 해소됐다.
- 검수 담당은 DB·테스트·변이·타입·린트를 직접 실행하지 않았다. 환불 선행 입실 경합과 T172 전체 완료는 미검증이다.
