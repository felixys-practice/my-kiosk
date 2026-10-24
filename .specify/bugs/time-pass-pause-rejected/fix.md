# Bug Fix: 시간권은 입실해도 ACTIVE가 되지 않아 일시정지가 거부된다

- **Slug**: time-pass-pause-rejected
- **Fixed**: 2026-10-24 (테스트 재작성 2026-10-25)
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

이제 시간권도 첫 입실 때 세션 생성과 같은 트랜잭션에서 `UNUSED → ACTIVE`로 바뀌고, `activatedAt`(첫 입실 시각)이 기록된다. 그래서 입실한 시간권도 일시정지·재개할 수 있다. 정지하면 `resumedAt = null`인 `TicketPause`가 생기고, 재개하면 정지 기간만큼 `minuteExpireDeadline`이 늘어난다. assessment의 A안이며 Decisions 1·2(ACTIVE = 첫 입실 이후, 시간권에도 `activatedAt` 기록)를 따랐다.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src/usage-session/usage-session.service.ts` | modified | `createSession`: 이용권 종류와 관계없이 `UNUSED`이면 이용권에 기록할 값(`activatedAt`, 기간권은 `expiresAt`까지)을 만든다. 두 번 있던 기간권 `UNUSED` 처리 블록을 하나로 합쳤다. 별도로 **사용자 변경**: `mockExternalApi` 기본 대기 1000ms → 100ms, 실패 확률 `0.3` → `0.1` |
| `src/usage-session/usage-session.repository.ts` | modified | 인자 `updatePeriodTicketData` → `firstEntryUpdate`. Step 2는 첫 입실이면 이용권을 `UNUSED → ACTIVE`로 바꾸며, `expiresAt`은 넘어온 경우에만 설정한다. `status = UNUSED` 조건부 update는 그대로다 |
| `src/usage-session/usage-session.types.ts` | modified | 공용 타입 `FirstEntryTicketUpdate`(첫 입실 때 이용권에 기록할 값) 추가(service·repository가 함께 사용) |
| `src/ticket/ticket-pause/ticket-pause.service.ts` | modified | 정지 가능 상태 검사의 틀린 주석을 고쳤다(기존 버그 7번). 검사 로직은 바꾸지 않았다 |
| `prisma/schema.prisma` | modified | `TicketStatus.ACTIVE` 주석: "사용 중 (정기권 활성화됨)" → "이용 시작됨 (첫 입실 이후, 시간권·정기권 공통)". 주석만 바뀌어 마이그레이션은 없다 |
| `src/usage-session/usage-session.service.spec.ts` | added test | 단위 테스트 3개. 기존 주석 "외부 API 스텁(30% 실패)"을 "외부 API 스텁(무작위 실패)"으로 고침 |
| `test/ticket-pause.e2e-spec.ts` | added test | 실제 흐름 헬퍼(주문 → 결제 요청 → PG 승인 콜백 → 입실, 정지·재개 요청)와 E2E 6개. `afterAll` 정리 대상에 좌석 배정, 일반 사용자 정지 기록, 결제, 상품 이력을 추가했다 |
| `docs/기존_버그.md` | modified | 고친 1번·7번 항목을 지웠다(문서 머리말 규칙). 다른 번호는 그대로 둔다(다른 문서가 번호로 참조함) |
| `.specify/bugs/time-pass-pause-rejected/cycle-log.md` | added | 실패 확인·의도적 변형 기록(헌법 III) |

## Diff Highlights

`usage-session.service.ts` `createSession`:

```ts
// 미사용(UNUSED) 이용권으로 첫 입실하면 이용권에 기록할 값을 만든다(ACTIVE = 첫 입실 이후)
// - 기간권: activatedAt과 함께 expiresAt(첫 입실 시각 + 구매 일수)을 기록한다
// - 시간권: activatedAt만 기록한다(기한은 결제 때 정한 minuteExpireDeadline을 그대로 쓴다)
let firstEntryUpdate: FirstEntryTicketUpdate | undefined;
if (ticket.status === 'UNUSED') {
  const now = new Date();
  firstEntryUpdate = { activatedAt: now };
  if (ticket.type === 'PERIOD') {
    firstEntryUpdate.expiresAt = addDays(
      now,
      ticket.purchasedDurationDays!,
    );
    ticket.expiresAt = firstEntryUpdate.expiresAt;
  }
}
```

`usage-session.repository.ts` Step 2:

```ts
// Step 2. 첫 입실이면 이용권을 UNUSED → ACTIVE로 바꾼다 (UNUSED 조건부 — 이미 ACTIVE면 P2025로 덮어쓰지 않는다)
if (firstEntryUpdate) {
  await tx.ticket.update({
    where: {
      id: ticketId,
      status: TicketStatus.UNUSED,
    },
    data: {
      status: TicketStatus.ACTIVE,
      activatedAt: firstEntryUpdate.activatedAt,
      // 시간권은 만료 시각이 없으므로 넘어온 경우에만 설정한다
      ...(firstEntryUpdate.expiresAt && {
        expiresAt: firstEntryUpdate.expiresAt,
      }),
    },
  });
}
```

## Tests Added or Updated

단위 (`src/usage-session/usage-session.service.spec.ts` › `createSession`):
- "미사용 기간권으로 처음 입실하면 activatedAt과 expiresAt을 함께 넘긴다": 기존 기간권 동작을 고정하는 특성 테스트다. `activatedAt` + 30일 = `expiresAt`인지 확인한다.
- "미사용 시간권으로 처음 입실하면 activatedAt만 넘기고 expiresAt은 넘기지 않는다": 구현 전 실패를 확인했다.
- "이미 ACTIVE인 시간권으로 다시 입실하면 7번째 인자를 넘기지 않는다": 첫 입실 시각을 덮어쓰지 않는다. 의도적 변형으로 확인했다.

E2E (`test/ticket-pause.e2e-spec.ts` › "결제·입실한 시간권 정지·재개 (bug: time-pass-pause-rejected)"). 모두 주문 → 결제 → 입실을 API로 거친다:
- "결제 후 입실한 시간권을 일시정지할 수 있다": 버그를 고정하는 핵심 테스트다. 정지 결과 상태(`resumedAt = null`인 `TicketPause` 1개, `pausedBy`·`pausedReason`, `Ticket.status = ACTIVE`)를 확인하고, 부수 효과(세션 `ENDED`, `remainingMinutes` 감소)는 따로 확인한다. 수정 전 코드에서 `400 (현재: UNUSED)`로 실패하는 것을 확인했다.
- "결제 후 입실해 정지한 시간권을 재개하면 정지 기간만큼 minuteExpireDeadline이 늘어난다": `resumedAt`·`resumedBy` 기록, 활성 정지 0개, `minuteExpireDeadline` 증가분 = `resumedAt − pausedAt`. 연장 계산을 0으로 바꾼 의도적 변형도 잡아냈다.
- "결제 후 입실한 고정석 시간권을 정지하면 배정이 해제되고, 재개할 때 고른 좌석에 다시 배정된다 (FR-018)": 배정 해제 제거, 재배정 제거 두 변형을 모두 잡아냈다.
- "시간권은 첫 입실 때 ACTIVE가 되고 activatedAt이 퇴실 후 재입실해도 바뀌지 않는다": 수정 전 코드에서 `Received: "UNUSED"`로 실패하는 것을 확인했다.
- "시간권을 정지했다가 재개해도 누가·언제·왜 정지하고 재개했는지가 한 기록에 모두 남는다": 검수용 이력이다. 재개 후 같은 `TicketPause`에 `pausedAt`·`pausedBy`·`pausedReason`과 `resumedAt`·`resumedBy`·`resumedReason`이 모두 남는지 확인한다. 재개 시 정지 사유를 지우는 변형, 재개 사유를 저장하지 않는 변형을 잡아냈다.
- "시간권을 정지·재개를 두 번 반복하면 이력이 2건 차례로 쌓인다": 재정지할 때 기존 행을 고쳐 쓰는 변형을 잡아냈다.

## Local Verification

- 사이클별 실패·통과 출력: `cycle-log.md`
- `npx tsc --noEmit -p tsconfig.json`: 오류 0
- `npx eslint src/usage-session/ src/ticket/ticket-pause/ test/ticket-pause.e2e-spec.ts`: 0건(exit 0)
- `npx prisma validate`: 통과
- `npm run test`: 23 suites, **163 passed** (수정 전 기준선 160 + 3)
- `ticket-pause.e2e-spec.ts` 단독 3회: 모두 **16 passed** (기존 10 + 6)
- E2E 전체 반복 결과와 남은 간헐 실패: `test.md`

## Deviations from Assessment

- **E2E를 처음에는 잘못 작성했다가 다시 썼다**: 처음에는 `test/seat-type.e2e-spec.ts`(좌석 타입 기능 E2E)에 넣었고, 핵심 테스트가 정지 성공을 "200 + 진행 중 세션 종료"로 확인했다. 세션 종료는 정지의 부수 효과라 정지 자체를 검증하지 못했고, 재개는 실제 흐름으로 검증하지 않았다. 원인은 assessment의 성공 기준을 잘못 정한 것, 그리고 기존 정지 E2E의 단언(정지 성공 = `TicketPause` 생성)을 읽지 않은 것이다. assessment 기준을 바로잡고, 테스트를 `test/ticket-pause.e2e-spec.ts`로 옮겨 다시 썼다. seat-type 파일은 커밋된 상태로 되돌렸다.
- **검수용 정지·재개 이력 테스트를 처음에 빠뜨렸다**: 정지·재개 상태만 확인하고, 재개 후에도 누가·언제·왜 정지·재개했는지가 남는지는 확인하지 않았다. 사용자 지적으로 E2E 2개를 추가했다.
- **E2E 실패 확인 방법**: 테스트를 다시 쓴 시점에 수정 코드가 이미 있었다. 그래서 수정 코드 3개 파일을 잠시 `main` 버전으로 되돌린 상태에서 실패를 확인하고 복원했다(`cycle-log.md`).
- **`createActiveTimeTicket` 픽스처는 바꾸지 않았다**: 기존 테스트 10개는 "ACTIVE 이용권의 정지 로직"을 검증한다. 수정 후에는 `ACTIVE` 시간권이 실제로 만들어지는 상태라 그대로 두고, 실제 흐름 E2E를 같은 파일에 따로 추가했다.
- **"입실하지 않은 시간권은 400" 테스트는 새로 추가하지 않았다**: 기존 "ACTIVE가 아닌 티켓을 정지하면 400 반환"이 `UNUSED` 시간권(결제 직후와 같은 상태)으로 이미 검증한다.
- **실패 기록 위치**: 헌법 III은 `specs/<기능>/tdd/cycle-log.md`를 정하지만 이 작업은 spec 기능이 아니라 `.specify/bugs/time-pass-pause-rejected/cycle-log.md`에 기록했다.
- **기간권 `expiresAt` 계산 시각 통일(아주 작은 동작 차이)**: 수정 전에는 `plannedEndAt` 계산용 `expiresAt`과 DB에 저장하는 `expiresAt`을 서로 다른 `new Date()`로 계산해 몇 ms 차이가 날 수 있었다. 블록을 합치면서 같은 값이 됐다.
- **외부 API 스텁 변경(사용자 변경, 범위 확장)**: E2E 불안정성 때문에 사용자가 `mockExternalApi`의 대기 시간과 실패 확률을 줄였다. 운영 코드(`src`)의 동작이 바뀌므로 커밋을 분리할지 정해야 한다(Follow-ups).

## Follow-ups

- **커밋**: 아직 커밋하지 않았다. 나눠야 할 것은 ① 테스트 + 최소 구현(동작 변경) ② 블록 통합·이름 변경·주석(refactoring) ③ 외부 API 스텁 변경(사용자 변경) ④ `docs/기존_버그.md`·bug 보고서다. ①②③은 같은 파일(`usage-session.service.ts`)에 섞여 있어서, hunk 단위로 스테이징할지 정해야 한다.
- **같은 작업 트리의 다른 변경**: bug 확장 설치 파일, `.vscode/settings.json`, 정책 파일 이동, `TEMP.md`는 이 수정 커밋에 넣지 않는다.
- **E2E의 남은 간헐 실패**: seat-type 파일의 테스트가 가끔 401·403·400·404로 실패한다(`test.md`). 이번 수정 경로와 겹치지 않아 원인을 조사하지 않았다. `docs/기존_버그.md`에 기록할 것을 권한다.
- **외부 API 스텁의 근본 해결**: 운영 코드 안의 무작위 스텁 대신 외부 장치 API를 provider로 분리하고, 테스트에서는 `overrideProvider`로 바꾸는 것이 표준이다. 별도 작업으로 다룬다.
- **001 spec 링크**: `specs/001-seat-type/spec.md:230`의 "기존 버그 1번" 링크는 지워진 항목을 가리킨다.
- **시간권 조회 응답의 `activatedAt`**: 응답에 넣을지는 이번 범위 밖이다.
