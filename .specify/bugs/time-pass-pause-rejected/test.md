# Bug Verification: 시간권은 입실해도 ACTIVE가 되지 않아 일시정지가 거부된다

- **Slug**: time-pass-pause-rejected
- **Tested**: 2026-10-25 (테스트 재작성 후 재검증)
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

보고된 증상은 더 이상 재현되지 않는다. 결제 후 입실한 시간권을 정지하면 `resumedAt = null`인 `TicketPause`가 생기고 이용권은 `ACTIVE`로 유지된다. 재개하면 정지 기간만큼 `minuteExpireDeadline`이 늘어나고, 고정석은 배정 해제·재배정까지 동작한다. 이번에 추가한 테스트는 반복 실행에서 실패하지 않았다. 다만 E2E 전체 실행에서 seat-type 파일의 다른 테스트가 가끔 실패한다. 이번 수정 경로와는 겹치지 않지만, 수정 전부터 있던 문제인지는 확인하지 못했다. 그래서 `verified`가 아니라 `partial`로 판정한다.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| 재현 (수정 후) | `npx jest --config ./test/jest-e2e.json test/ticket-pause.e2e-spec.ts -t "결제 후 입실한 시간권을 일시정지할 수 있다"` | pass | assessment 재현 절차(주문 → 결제 요청 → PG 승인 콜백 → `POST /usage-sessions` → `PATCH /tickets/:id/pause`)를 `AppModule` 전체와 실제 HTTP API로 실행했다. 결과 상태(`TicketPause`, `Ticket.status`)를 DB에서 확인했다 |
| 재현 (수정 전) | 수정 코드 3개를 `main` 버전으로 잠시 되돌려 같은 테스트 실행 | fail (의도) | `400 "정지할 수 없는 상태의 티켓입니다 (현재: UNUSED)"`, 이용권 `status = UNUSED` (2회 확인). 복원 확인함 |
| 재개·고정석·`activatedAt` E2E 3개 | 같은 파일, 이름별 실행 | pass | 수정 전 코드에서는 모두 실패했다(정지 400 또는 `Received: "UNUSED"`). 재개 연장, 배정 해제, 재배정은 의도적 변형으로 단언을 검증했다 |
| 정지·재개 이력 E2E 2개 (검수용) | 같은 파일, 이름별 실행 | pass | 재개 후에도 누가·언제·왜 정지·재개했는지가 한 기록에 남고, 반복하면 이력이 2건 쌓인다. 수정 전 코드에서는 정지 400으로 실패했다. 이력 저장을 망가뜨리는 변형 3가지(정지 사유 삭제, 재개 사유 미저장, 기존 행 덮어쓰기)를 모두 잡아냈다 |
| 추가한 단위 테스트 3개 | `npx jest src/usage-session/usage-session.service.spec.ts` | pass | |
| 정지 E2E 파일 안정성 | `ticket-pause.e2e-spec.ts` 단독 5회 | pass | 5회 모두 `14 passed` |
| 단위 회귀 | `npm run test` | pass | 23 suites, 163 passed |
| E2E 회귀 | `npm run test:e2e` 반복 | 간헐 실패 | 아래 표. 실패는 모두 seat-type 파일의 테스트이고, 이번에 추가한 테스트는 실패하지 않았다 |
| 타입 검사 | `npx tsc --noEmit -p tsconfig.json` | pass | |
| 린트 (바꾼 파일) | `npx eslint src/usage-session/ src/ticket/ticket-pause/ test/ticket-pause.e2e-spec.ts` | pass | 전체 린트는 기존 121건이 남아 있어(기존 버그 8번) 쓰지 않음 |
| 스키마 | `npx prisma validate` | pass | 주석만 바뀜 |

## E2E 반복 실행 결과 (외부 API 스텁 변경 후: 대기 100ms, 실패 확률 0.1)

| 실행 | 횟수 | 실패한 실행 | 실패한 테스트 (모두 seat-type 파일) |
|---|---|---|---|
| E2E 전체 병렬 (`npm run test:e2e`) | 20회 | 4회 | QS-6 `got 403`, QS-24 `got 401`, QS-9 `got 401`, QS-10 `got 400` |
| E2E 전체 순차 (`--runInBand`) | 5회 | 2회 | QS-16a, QS-23 (메시지 미수집) |
| `ticket-pause.e2e-spec.ts` 단독 | 5회 | 0회 | |

- **이번에 추가한 E2E 4개(E1~E4)는 위 30회에서 한 번도 실패하지 않았다.**
- **이력 E2E 2개(E5·E6) 추가 후**: `ticket-pause.e2e-spec.ts` 단독 3회는 모두 `16 passed`였다. E2E 전체 병렬은 28회 실행했다.
  - 이력 테스트(E5)가 1회 실패했지만 그 실패의 메시지는 남기지 못했다. 이후 25회에서는 재현되지 않아 원인을 모른다.
  - 나머지 실패는 seat-type 테스트였다(QS-8, QS-25 2회, QS-20 `got 403`, QS-19 `got 401`).
- **실패 확률 0% 실험**: 사용자가 스텁 실패 확률을 잠시 `0.0`으로 바꿨을 때 E2E 전체 병렬 15회, 순차 5회가 모두 통과했다. 그래서 seat-type의 간헐 실패는 스텁의 무작위 실패와 관련이 있어 보인다. 다만 어떤 경로로 401·403이 되는지는 확인하지 못했다. 확인 뒤 실패 확률은 `0.1`로 되돌렸다.
- 스텁을 바꾸기 전에는 재개 테스트가 1회 실패했다. 입실 API의 외부 API 스텁이 4번 연속 실패해 `POST /usage-sessions`가 500을 낸 것이다. 사용자가 실패 확률을 0.3에서 0.1로 줄여, 이 실패 확률은 입실 한 번에 약 0.81%에서 0.01%로 낮아졌다. 0은 아니다.
- **seat-type 실패에 대해 알아본 것**:
  - 401은 JWT 전략(`jwt.strategy.ts`)에서 Redis의 세션 취소 시각(`sessionRevoked`)보다 먼저 발급된 토큰일 때 난다.
  - 실패 지점은 주문·결제·인증 경로이고, 이번 수정 경로(입실 시 이용권 상태 변경, 정지·재개)와 겹치지 않는다.
  - 순차 실행에서도 실패하므로 병렬 간섭만의 문제는 아니다.
  - 원인은 조사하지 않았다(버그 범위 밖).
- **수정 전 기준선**: `main`(스텁 변경 전 값)에서 seat-type 파일 단독 10회 중 1회 실패(QS-13)를 이미 관찰했다. 다만 스텁 변경 후 값으로 `main`을 다시 돌려 보지는 않았다. 그래서 위 401·403 실패가 수정 전부터 있었는지는 확인하지 못했다.

## Output Excerpts

```
# 재현 테스트 (수정 전 코드)
RED 400 {"code":"DomainBadRequestError","message":"정지할 수 없는 상태의 티켓입니다 (현재: UNUSED)"} ticket={"status":"UNUSED",...}

# 정지 E2E 파일 (수정 후)
ticket-pause #1 Tests: 14 passed, 14 total
... (5회 모두 동일)

# 단위 회귀
Test Suites: 23 passed, 23 total
Tests:       163 passed, 163 total

# E2E 전체 병렬 15회 (스텁 변경 후 두 번째 묶음)
#1 실패: 고정석 상품 주문 후 결제가 성공하면 이용권에 고정석과 선택 좌석이 조회된다 (QS-6)  expected 201 "Created", got 403 "Forbidden"
#9 실패: 고정석 주문을 취소하면 그 좌석이 즉시 선택 가능해진다 (QS-24)  expected 200 "OK", got 401 "Unauthorized"
#13 실패: 결제 실패 후 같은 좌석으로 새 주문이 성공한다 (QS-9)  expected 201 "Created", got 401 "Unauthorized"
#15 실패: 자유석 상품을 좌석 없이 주문·결제하면 이용권이 자유석이고 배정 좌석이 없다 (QS-10)  expected 201 "Created", got 400 "Bad Request"
E2E 전체 병렬 15회: 통과 11, 실패 4
```

## Residual Risks

- **seat-type E2E의 간헐 실패(401·403·400·404)**: 원인을 모른다. 이번 수정과 경로가 겹치지 않지만, 수정 전부터 있었다는 증거는 스텁 변경 전 값의 QS-13 실패 1건뿐이다.
- **외부 API 스텁의 무작위 실패**: 실패 확률을 낮췄을 뿐 남아 있다. 입실하는 E2E는 드물게 500으로 실패할 수 있다. 근본 해결(외부 장치 API를 provider로 분리하고 테스트에서 `overrideProvider`)은 별도 작업이다.
- **입실 외부 API 실패 시 이용권 상태**: 외부 API가 끝내 실패해 세션이 실패 처리돼도, `UNUSED → ACTIVE` 변경은 이미 세션 생성 트랜잭션에서 커밋돼 있다. 그래서 이용권은 `ACTIVE`로 남는다. 기간권은 수정 전부터 같은 구조였고, 이번에 시간권도 같아졌다. 정책상 받아들일 수 있는지는 확인하지 않았다.
- 실제 운영 환경(실제 PG·문열림 장치)에서는 검증하지 않았다. 검증은 로컬 DB·Redis와 테스트 스텁 기준이다.

## Recommendation

이 버그는 자기 범위 안에서 검증됐다. 실제 API 흐름에서 정지·재개·고정석 재배정 결과 상태를 확인했고, 수정 전 코드에서 같은 테스트가 노린 이유로 실패했다. 추가 테스트는 반복 실행에서 안정적이었다. 남은 `partial` 사유는 seat-type E2E의 원인 미상 간헐 실패다. 다음을 권한다.
1. 이 실패를 `docs/기존_버그.md`에 별도 항목으로 기록한다.
2. 이 버그는 그 기록을 전제로 닫는다.
3. 기록 전에 수정 전 기준선(`main` + 같은 스텁 값)으로 seat-type E2E를 반복 실행하면, 이번 수정과 관계없다는 것을 확정할 수 있다.
