# TDD 사이클 기록: time-pass-pause-rejected

헌법 III은 실패 확인 기록을 `specs/<기능>/tdd/cycle-log.md`에 남기라고 정한다. 이 작업은 spec 기능이 아니라 bug 확장으로 진행하는 버그 수정이라 `specs/` 디렉터리가 없다. 그래서 같은 버그의 assessment·fix 보고서 옆인 이 파일에 기록한다.

코드 블록 안의 출력은 실제 실행 출력을 그대로 옮긴 것이다. 단위 테스트 출력에 나오는 테스트 이름과 변수 이름(`activation`)은 실행 당시의 이름이다. 그 뒤에 이름만 바꿨고 단언은 그대로다. 지금 이름은 각 항목의 **테스트** 줄에 적었다.

**버그의 성공 기준** (assessment Symptom):
- 정지: 그 이용권에 `resumedAt = null`인 `TicketPause`가 1개 생기고 `Ticket.status`는 `ACTIVE`로 유지된다. 진행 중 세션 종료와 `remainingMinutes` 감소는 정지의 부수 효과다.
- 재개: `TicketPause.resumedAt`이 기록되고, `minuteExpireDeadline`이 정지 기간만큼 늘어난다.
- 고정석: 정지 시 배정이 해제되고, 재개할 때 고른 좌석으로 다시 배정된다.

**E2E 실패 확인 방법**: 수정이 이미 들어간 뒤에 테스트를 다시 썼다(아래 "E2E 재작성 경위"). 그래서 E2E는 수정 코드 3개(`usage-session.service.ts`, `usage-session.repository.ts`, `usage-session.types.ts`)를 잠시 `main` 버전으로 되돌린 상태에서 실행해 실패를 확인하고, 그다음 복원해 통과를 확인했다.

---

## 단위 테스트 (`src/usage-session/usage-session.service.spec.ts` › `createSession`)

### U0. 기간권 첫 입실 처리 특성 테스트 (기존 동작 고정)

- **목적**: repository `createSession`의 7번째 인자를 바꾸는 동안 기존 기간권 동작이 바뀌지 않게 고정한다. 기존 동작은 첫 입실 때 `activatedAt`과 `expiresAt`(`activatedAt` + 30일)을 넘기는 것이다. 이미 있는 동작이라 처음부터 통과하는 것이 맞다.
- **테스트**: "미사용 기간권으로 처음 입실하면 activatedAt과 expiresAt을 함께 넘긴다"
- **결과**: `Tests: 7 skipped, 1 passed, 8 total` (통과, 의도한 결과)

### U1. 미사용 시간권 첫 입실 시 repository에 넘기는 7번째 인자 (red)

- **테스트**: "미사용 시간권으로 처음 입실하면 activatedAt만 넘기고 expiresAt은 넘기지 않는다"
- **명령**: `npx jest src/usage-session/usage-session.service.spec.ts -t "미사용 시간권으로 처음 입실하면"`
- **실패 출력** (실행 당시 테스트 이름):

```
  ● UsageSessionService › createSession › 미사용 시간권으로 처음 입실하면 활성화 시각만 넘기고 만료 시각은 넘기지 않는다
    expect(received).toBeInstanceOf(expected)
    Expected constructor: Date
    Received value has no prototype
    Received value: undefined
    > 215 |       expect(activation?.activatedAt).toBeInstanceOf(Date);
Tests:       1 failed, 8 skipped, 9 total
```

- **실패 이유 확인**: 수정 전 `createSession`에서 지역 변수 `updateTicketData`에 값을 넣는 곳은 기간권 조건(`ticket.status === 'UNUSED' && ticket.type === 'PERIOD'`) 안 한 곳뿐이었다. 그래서 시간권이면 `updateTicketData`가 `undefined`인 채로 repository `createSession`의 7번째 인자(`updatePeriodTicketData`)로 넘어간다. repository는 이 인자가 있을 때만 이용권을 `UNUSED → ACTIVE`로 update하므로, 시간권은 `UNUSED`로 남는다. 메서드나 필드가 없어서 난 오류가 아니라 동작이 없어서 생긴 실패이므로 노린 이유로 실패했다.

### 최소 구현 → green

- **변경**:
  - `usage-session.service.ts` `createSession`에 분기를 추가했다. 미사용 시간권이면 `updateTicketData = { activatedAt: new Date() }`로 둔다.
  - `updateTicketData` 타입과 repository 인자 `updatePeriodTicketData` 타입에서 `expiresAt`을 선택(optional)으로 바꿨다.
  - repository Step 2는 `expiresAt`이 있을 때만 `expiresAt`을 기록한다.
- **결과**: 단위 `Tests: 9 passed, 9 total`, 전체 `npm run test` → `23 suites, 162 passed`

### U2. 이미 ACTIVE인 시간권 재입실 (구현으로 이미 생긴 동작, 의도적 변형으로 검증)

- **테스트**: "이미 ACTIVE인 시간권으로 다시 입실하면 7번째 인자를 넘기지 않는다"
- **정상 실행**: `Tests: 9 skipped, 1 passed, 10 total`
- **처음부터 통과한 이유**: 최소 구현이 `ticket.status === 'UNUSED'` 조건으로 이미 이 동작을 만든다(헌법 III의 의도적 변형으로 대신 확인).
- **의도적 변형**: 조건 `ticket.status === 'UNUSED' && ticket.type === 'TIME'`을 `ticket.type === 'TIME'`으로 바꿨다.
- **변형 실행 출력** (실행 당시 테스트 이름):

```
  ● UsageSessionService › createSession › 이미 활성화된 시간권으로 다시 입실하면 활성화 데이터를 넘기지 않는다
    expect(received).toBeUndefined()
    Received: {"activatedAt": 2026-10-24T11:47:31.547Z}
Tests:       1 failed, 9 skipped, 10 total
```

  ACTIVE 시간권인데도 7번째 인자로 `{ activatedAt }`이 넘어간 것을 테스트가 잡아냈다. 원래 코드로 되돌렸다.

---

## E2E 재작성 경위

처음 작성한 E2E 3개는 `test/seat-type.e2e-spec.ts`(좌석 타입 기능 E2E)에 들어 있었다. 핵심 테스트는 정지 성공을 "200 응답 + 진행 중 세션 종료"로 확인했다. 그런데 세션 종료는 정지의 부수 효과일 뿐이라, 정지 자체(`TicketPause` 생성)는 검증하지 않았다. 재개도 실제 흐름으로 검증하지 않았다. 사용자 지적으로 확인했고(2026-10-25), 다음과 같이 고쳤다.
- 세 테스트를 `seat-type.e2e-spec.ts`에서 지웠다(그 파일은 커밋된 상태로 되돌림).
- `test/ticket-pause.e2e-spec.ts`에 실제 흐름 헬퍼(주문 → 결제 요청 → PG 승인 콜백 → 입실)와 함께 아래 4개를 새로 썼다.

## E2E (`test/ticket-pause.e2e-spec.ts` › "결제·입실한 시간권 정지·재개 (bug: time-pass-pause-rejected)")

### E1. 결제 후 입실한 시간권을 일시정지할 수 있다 (red → green)

- **확인 내용**: 정지 200, `resumedAt = null`인 `TicketPause` 1개(`pausedBy`, `pausedReason`), `Ticket.status = ACTIVE`. 부수 효과로 세션 `ENDED`, `remainingMinutes < 600`.
- **명령**: `npx jest --config ./test/jest-e2e.json test/ticket-pause.e2e-spec.ts -t "결제 후 입실한 시간권을 일시정지할 수 있다"`
- **수정 전(main) 실행 출력**:

```
  ● TicketPauseController (E2E) › 결제·입실한 시간권 정지·재개 (bug: time-pass-pause-rejected) › 결제 후 입실한 시간권을 일시정지할 수 있다
    expected 200 "OK", got 400 "Bad Request"
    > 541 |         await pauseTicket(ticketId, '외출').expect(200);
```

- **실패 이유 확인**: 응답 상태·본문과 이용권 상태를 임시로 출력해 수정 전 코드로 두 번 실행했다(확인 후 출력 코드는 지움).

```
RED 400 {"code":"DomainBadRequestError","message":"정지할 수 없는 상태의 티켓입니다 (현재: UNUSED)"} ticket={"status":"UNUSED",...}
RED 400 {"code":"DomainBadRequestError","message":"정지할 수 없는 상태의 티켓입니다 (현재: UNUSED)"} ticket={"status":"UNUSED",...}
```

  보고된 증상과 같으므로 노린 이유로 실패했다.
  - 참고: 첫 출력 시도는 임시 코드를 `.then(...).expect()`로 잘못 써서 즉시 TypeError가 났다. 테스트가 바로 끝나면서 정지 요청이 처리되는 중에 `afterAll`이 데이터를 지웠고, 그래서 `DomainNotFoundError`가 출력됐다. 측정 코드의 실수라 위 결과로 대체했다.
- **수정 후**: `Tests: 10 skipped, 1 passed, 11 total`

### E2. 정지한 시간권을 재개하면 정지 기간만큼 minuteExpireDeadline이 늘어난다

- **테스트**: "결제 후 입실해 정지한 시간권을 재개하면 정지 기간만큼 minuteExpireDeadline이 늘어난다"
- **확인 내용**: 재개 200, `TicketPause.resumedAt`·`resumedBy` 기록, 활성 정지 0개, `Ticket.status = ACTIVE`, `minuteExpireDeadline` 증가분 = `resumedAt − pausedAt`.
- **수정 전(main)**: 정지 단계에서 `expected 200 "OK", got 400 "Bad Request"` (572행). 버그가 정지를 막기 때문에 재개 단계까지 갈 수 없다.
- **수정 후**: `Tests: 11 skipped, 1 passed, 12 total`
- **재개 단언 검증 (의도적 변형)**: `ticket-pause.service.ts`의 `pauseDurationMs`를 `0`으로 바꿨다.

```
    expect(received).toBe(expected) // Object.is equality
    Expected: 76
    Received: 0
```

  변형을 잡아냈다. 원래 코드로 되돌렸다.

### E3. 고정석 시간권 정지 시 배정 해제, 재개 시 재배정 (FR-018)

- **테스트**: "결제 후 입실한 고정석 시간권을 정지하면 배정이 해제되고, 재개할 때 고른 좌석에 다시 배정된다 (FR-018)"
- **확인 내용**: 정지 후 활성 정지 1개, `ACTIVE` 배정 0개. `seatId`를 주고 재개하면 그 좌석에 `ACTIVE` 배정이 생기고 활성 정지는 0개다.
- **수정 전(main)**: 정지 단계에서 `expected 200 "OK", got 400 "Bad Request"` (616행)
- **수정 후**: `Tests: 12 skipped, 1 passed, 13 total`
- **의도적 변형 a**: 정지 시 배정 해제(`releaseByTicket`) 블록을 실행하지 않게 했다 → `Expected: 0, Received: 1` (ACTIVE 배정이 남음)
- **의도적 변형 b**: 재개 시 재배정(`assign`) 블록을 실행하지 않게 했다 → `prisma.seatAssignment.findFirstOrThrow()` 실패(배정 없음)
- 두 변형 모두 잡아냈다. 원래 코드로 되돌렸다.

### E4. 시간권은 첫 입실 때 ACTIVE가 되고 activatedAt이 재입실 후에도 바뀌지 않는다

- **테스트**: "시간권은 첫 입실 때 ACTIVE가 되고 activatedAt이 퇴실 후 재입실해도 바뀌지 않는다"
- **수정 전(main)**:

```
    expect(received).toBe(expected) // Object.is equality
    Expected: "ACTIVE"
    Received: "UNUSED"
```

- **수정 후**: `Tests: 13 skipped, 1 passed, 14 total`
- 이 테스트는 처음 seat-type 파일에 있을 때 기본 제한 시간 5초를 넘겨 가끔 실패했다. 옮기면서 제한 시간을 지정했다(`flowTimeoutMs`).

### E5. 정지·재개 이력이 한 기록에 모두 남는다 (검수용 이력)

- **추가 경위**: 사용자 지적(2026-10-25). 검수하려면 누가·언제·왜 정지하고 재개했는지가 남아야 한다. 그런데 기존 재개 테스트는 `resumedAt`이 null이 아닌지와 `resumedBy`만 확인했다. 재개 후 `pausedAt`·`pausedBy`·`pausedReason`이 남는지, `resumedReason`이 저장되는지는 확인하지 않았다.
- **테스트**: "시간권을 정지했다가 재개해도 누가·언제·왜 정지하고 재개했는지가 한 기록에 모두 남는다"
- **확인 내용**: 재개 후 `TicketPause` 1건에 `pausedBy`, `pausedReason = '외출'`, `pausedAt`(정지 요청 전후 사이), `resumedBy`, `resumedReason = '복귀'`, `resumedAt`(정지 요청 후 ~ 재개 요청 후 사이)이 모두 남아 있다.
- **수정 전(main)**: 정지 단계에서 `expected 200 "OK", got 400 "Bad Request"` (629행)
- **수정 후**: `Tests: 15 skipped, 1 passed, 16 total`
- **의도적 변형 a**: `ticket-pause.repository.ts` `resumePause`가 `pausedReason: null`도 함께 저장하게 했다 → `Expected: "외출", Received: null`
- **의도적 변형 b**: `resumePause`가 `resumedReason`을 저장하지 않게 했다 → `Expected: "복귀", Received: null`
- 두 변형 모두 잡아냈다. 원래 코드로 되돌렸다.

### E6. 정지·재개를 반복하면 이력이 차례로 쌓인다

- **테스트**: "시간권을 정지·재개를 두 번 반복하면 이력이 2건 차례로 쌓인다"
- **확인 내용**: 정지 시각 순으로 `TicketPause`가 2건이다. 각 건의 (정지 사유, 재개 사유)는 `('1차 정지', '1차 재개')`, `('2차 정지', '2차 재개')`이다. 두 건 모두 `resumedAt`이 있고, 1차 재개 시각 ≤ 2차 정지 시각이다.
- **수정 전(main)**: 정지 단계에서 `expected 200 "OK", got 400 "Bad Request"` (667행)
- **수정 후**: `Tests: 15 skipped, 1 passed, 16 total`
- **의도적 변형 c**: `createPause`가 그 이용권의 기존 정지 행이 있으면 새로 만들지 않고 그 행을 고쳐 쓰게 했다 → `toEqual` 실패(`- Expected - 4`, 이력 1건만 남음). 잡아냈다. 원래 코드로 되돌렸다.

---

## Refactoring (전체 green 상태에서, 동작 변경 없음)

- `createSession`에는 기간권 `UNUSED` 처리 블록이 두 번 있었고, 최소 구현에서 시간권 분기가 하나 더 생겼다. 이 셋을 `ticket.status === 'UNUSED'` 블록 하나로 합쳤다.
- 이름을 바꿨다.
  - 7번째 인자의 타입: 공용 타입 `FirstEntryTicketUpdate`(`usage-session.types.ts`, 첫 입실 때 이용권에 기록할 `activatedAt`·`expiresAt`)를 추가했다.
  - 서비스 지역 변수: `updateTicketData` → `firstEntryUpdate`
  - repository 인자: `updatePeriodTicketData` → `firstEntryUpdate`
- 주석: 정지 서비스 2단계 주석(기존 버그 7번), 스키마 `ACTIVE` 주석. 단위 테스트 이름에서 코드에 없는 표현을 지우고 `activatedAt`, `expiresAt`, `ACTIVE`로 바꿨다(단언은 그대로).

## 사용자 변경: 외부 API 스텁 (2026-10-25)

- 사용자가 `usage-session.service.ts`의 `mockExternalApi`를 바꿨다: 기본 대기 1000ms → 100ms, 실패 확률 `0.3` → `0.1`.
- 이에 맞춰 단위 테스트 주석 "외부 API 스텁(30% 실패)"을 "외부 API 스텁(무작위 실패)"으로 고쳤다. E2E 제한 시간 `flowTimeoutMs`는 20000 → 10000ms로 바꿨다.

## 최종 결과

- `npx tsc --noEmit` 오류 0, 바꾼 파일 `npx eslint` 0건
- `npm run test` → `23 suites, 163 passed`
- `ticket-pause.e2e-spec.ts` 단독: E1~E4 추가 후 5회 모두 `14 passed`, E5·E6 추가 후 3회 모두 `16 passed`
- E2E 전체는 `test.md` 참고
