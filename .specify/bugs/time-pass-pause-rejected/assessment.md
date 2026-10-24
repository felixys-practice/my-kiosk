# Bug Assessment: 시간권은 입실해도 ACTIVE가 되지 않아 일시정지가 거부된다

- **Slug**: time-pass-pause-rejected
- **Created**: 2026-10-24
- **Source**: pasted text (같은 내용이 [docs/기존_버그.md](../../../docs/기존_버그.md) 1번, 관련 항목 7번에 기록되어 있음)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> 시간권은 입실해도 이용권 상태가 ACTIVE가 되지 않아 일시정지가 거부된다

`docs/기존_버그.md` 1번 요약: 결제 후 입실한 시간권도 상태가 `UNUSED`로 남는다. 일시정지는 `ACTIVE`만 허용하므로 400("정지할 수 없는 상태의 티켓입니다 (현재: UNUSED)")으로 거부된다. 발견 경위는 001-seat-type research R10.

## Symptom

- **실제**: 시간권은 결제부터 소진까지 상태가 `UNUSED` → `EXHAUSTED`로만 바뀐다. 입실해도 `ACTIVE`가 되지 않아 일시정지 요청이 항상 400으로 거부된다.
- **기대**: 입실(이용 시작)한 시간권은 일시정지·재개할 수 있어야 한다. `pauseTicket` JSDoc도 "시간권: 세션 종료 시 소비 시간을 차감"이라고 적혀 있어, 시간권 정지를 전제로 설계됐다.
  - **정지 성공의 결과 상태**: 그 이용권에 `resumedAt = null`인 `TicketPause` 행이 1개 생기고, `Ticket.status`는 `ACTIVE`로 유지된다(PAUSED 상태는 `TicketPause`를 조인해 판단, `schema.prisma` `TicketStatus` 주석). 기존 정지 E2E도 정지 성공을 `TicketPause` 생성으로 확인한다.
  - **정지의 부수 효과**(성공 기준이 아님): 진행 중 세션이 있으면 `ENDED`가 되고, 이용한 시간만큼 `remainingMinutes`가 줄어든다. 고정석이면 배정이 해제된다.
  - **재개 성공의 결과 상태**: 그 `TicketPause`에 `resumedAt`이 기록되고, 시간권의 `minuteExpireDeadline`이 정지 기간만큼 늘어난다. 고정석이면 재개할 때 고른 좌석으로 다시 배정된다.

## Reproduction

1. 시간권 상품을 주문하고 결제한다. 이용권이 `status = UNUSED`로 생성된다.
2. 그 이용권으로 입실한다(`createSession`). 세션은 생기지만 이용권 상태는 `UNUSED` 그대로다.
3. `PATCH /tickets/:ticketId/pause`를 호출한다.
4. 400 "정지할 수 없는 상태의 티켓입니다 (현재: UNUSED)"가 반환된다.

이번 진단에서는 API를 실제로 호출해 재현하지 않았다. 아래 코드 경로를 읽어 확정했다.

## Suspected Code Paths

- `src/usage-session/usage-session.service.ts:createSession()` (124-131행 부근): 이용권을 활성화하는 조건이 `ticket.status === 'UNUSED' && ticket.type === 'PERIOD'`뿐이다. 시간권이면 `updateTicketData`가 만들어지지 않는다.
- `src/usage-session/usage-session.repository.ts:createSession()` Step 2 (65-78행): "미사용 기간권 업데이트"만 있다. `UNUSED → ACTIVE` 전이를 하는 곳이 이곳 하나뿐이다.
- `src/ticket/ticket-pause/ticket-pause.service.ts:pauseTicket()` (54행): `ticket.status !== TicketStatus.ACTIVE`이면 400. 이 검사 때문에 시간권 정지가 거부된다.
- `src/ticket/ticket-pause/ticket-pause.service.ts:pauseTicket()` 53행 주석: "UNUSED 상태에서는 `minuteExpireDeadline`도 … 설정되지 않으므로"라고 적혀 있다. 하지만 시간권은 결제 시 `minuteExpireDeadline`이 설정된다(`src/payment/payment.service.ts:234`). 기존 버그 7번에 해당한다.
- `src/session-lifecycle/session-lifecycle.service.ts:endSession()` (86-96행): 소진 시 `CASE … THEN EXHAUSTED ELSE status`로 바꾼다. 그래서 시간권은 `UNUSED → EXHAUSTED`로 바로 넘어간다.
- `prisma/schema.prisma:204`: `ACTIVE // 사용 중 (정기권 활성화됨)`. 시간권에서 ACTIVE가 무엇을 뜻하는지 정의되어 있지 않다.
- `test/ticket-pause.e2e-spec.ts:145-175` `createActiveTimeTicket`: 시간권을 DB에 직접 `status: ACTIVE`로 넣고 시작한다. 실제 흐름에서는 만들어지지 않는 상태라서, E2E가 통과해도 이 버그가 가려진다.

## Root Cause Hypothesis

이용권 상태 전이를 정할 때 "첫 입실 시 활성화"를 기간권에만 적용했다. 기간권은 첫 입실 때 `expiresAt`을 계산해야 해서 활성화 단계가 꼭 필요했지만, 시간권은 결제 시 기한(`minuteExpireDeadline`)이 정해지므로 활성화 단계를 빠뜨린 것으로 보인다. 그런데 일시정지·재개는 "ACTIVE = 이용을 시작한 이용권"이라는 전제로 만들어졌다. 그 결과 시간권은 정지 대상에 한 번도 들어가지 못한다. 테스트는 ACTIVE 시간권을 DB에 직접 만들어서 이 불일치를 드러내지 못했다. 확신도: **high** (전이 지점이 한 곳뿐이라는 것을 코드 검색으로 확인).

## Proposed Remediation

**Preferred (A안): 시간권도 첫 입실 시 `UNUSED → ACTIVE`로 전이한다**

`createSession`에서 이용권 종류와 관계없이 `UNUSED`이면 같은 트랜잭션에서 `ACTIVE`로 바꾼다. 시간권은 `status`와 `activatedAt`을 설정하고, 기간권은 지금처럼 여기에 `expiresAt`도 함께 설정한다. repository Step 2의 조건부 update(`where: { id, status: UNUSED }`)를 시간권에도 적용하면 동시 입실 시에도 한 번만 전이된다. 이렇게 하면 ACTIVE는 "이용을 시작한 이용권"이라는 하나의 의미가 되고, 정지 서비스의 `ACTIVE`만 허용하는 검사는 고치지 않아도 된다.

영향 확인 결과:
- 환불의 미사용 판정(`refund.service.ts:isUnusedTicket`)은 상태가 아니라 `remainingMinutes === purchasedMinutes`로 판단하므로 영향이 없다.
- 소진 전이(`endSession`의 `ELSE status`)는 `ACTIVE → EXHAUSTED`로도 그대로 동작한다.
- 좌석 배정 정책(`seat-assignment.policy.ts:31-32`)은 `UNUSED`와 `ACTIVE`를 모두 허용하므로 영향이 없다.

**Alternatives**:
- **B안: 정지 검사를 완화한다.** 시간권은 `UNUSED`도 정지할 수 있게 한다. 변경은 작지만 시간권 상태가 영원히 `UNUSED`라 "사용 중"을 상태로 구분할 수 없는 문제가 남는다. 미사용 시간권 정지를 허용할지라는 비즈니스 결정도 새로 필요하다. 상태 의미가 계속 이용권 종류마다 달라지므로 권장하지 않는다.
- **C안: 첫 결제 시 시간권을 바로 `ACTIVE`로 만든다.** 결제 시 기한이 시작되므로 일리가 있다. 하지만 `UNUSED`(미사용)를 쓰는 화면, 통계, 정책 용어와 어긋나고, 입실하지 않은 이용권도 정지할 수 있게 된다. A안보다 바뀌는 범위가 넓다.

**Files likely to change**:
- `src/usage-session/usage-session.service.ts`: 활성화 조건을 시간권까지 넓힌다. 같은 함수에 기간권 활성화 블록이 두 번 있으니(96-100행, 124-131행) 하나로 합친다.
- `src/usage-session/usage-session.repository.ts`: Step 2를 "미사용 이용권 활성화"로 일반화한다.
- `src/ticket/ticket-pause/ticket-pause.service.ts`: 53행 주석을 바로잡는다(기존 버그 7번).
- `prisma/schema.prisma`: `ACTIVE` 주석을 "이용 시작됨(첫 입실 이후)"으로 고친다. 주석만 바뀌므로 마이그레이션은 필요 없다.
- `test/ticket-pause.e2e-spec.ts`: 정지 E2E가 실제 흐름(결제 → 입실 → 정지)으로 ACTIVE 시간권을 만들게 바꾼다.
- `docs/기존_버그.md`: 고친 뒤 1번과 7번 항목을 지운다(문서 머리말 규칙).
- 데이터 마이그레이션: 하지 않는다(Decisions 3).

**Tests to add or update**:
- 단위: `createSession`에 `UNUSED` 시간권을 넣으면 repository `createSession`의 7번째 인자로 `{ activatedAt }`(`expiresAt` 없음)이 전달된다. 이미 `ACTIVE`인 시간권은 다시 전이하지 않아 `activatedAt`이 첫 입실 시각으로 유지된다.
- E2E: 시간권 첫 입실 후 DB의 `status = ACTIVE`, `activatedAt`이 입실 시각으로 기록된다. 두 번째 입실 후에도 `activatedAt`이 바뀌지 않는다.
- E2E(외부 루프): 시간권 결제 → 입실 → `PATCH /tickets/:id/pause`가 200이고, 그 이용권에 `resumedAt = null`인 `TicketPause`가 생기며 `Ticket.status`는 `ACTIVE`로 유지된다. 부수 효과로 진행 중 세션은 `ENDED`, `remainingMinutes`는 감소한다. 이 버그를 고정하는 핵심 테스트이며, DB 직접 삽입이 아니라 실제 API 흐름으로 만든다. 위치는 정지·재개 E2E인 `test/ticket-pause.e2e-spec.ts`.
- E2E: 시간권 결제 → 입실 → 정지 → `PATCH /tickets/:id/resume`가 200이고, `TicketPause.resumedAt`이 기록되며, `minuteExpireDeadline`이 정지 기간만큼 늘어난다.
- E2E: 고정석 시간권 결제 → 입실 → 정지하면 배정이 해제되고, 재개할 때 `seatId`를 주면 그 좌석으로 다시 배정된다(FR-018 전체가 시간권에서도 실행되는지).
- E2E(검수용 이력): 정지 → 재개 후에도 같은 `TicketPause`에 `pausedAt`·`pausedBy`·`pausedReason`과 `resumedAt`·`resumedBy`·`resumedReason`이 모두 남는다. 정지·재개를 반복하면 이력이 건별로 쌓인다.
- E2E: 입실하지 않은 시간권은 여전히 400으로 정지가 거부된다. A안에서 의도한 경계다.

## Risks & Considerations

- **기존 데이터**: 운영 데이터가 없어서 보정하지 않는다(Decisions 3). 로컬 DB에 이미 입실한 `UNUSED` 시간권이 남아 있으면 그 이용권은 계속 정지할 수 없으니 시드를 다시 넣는다.
- **상태를 기준으로 쓰는 다른 곳**: 이번에 확인한 범위(환불, 소진, 좌석 배정, 정지·재개)에서는 시간권이 `ACTIVE`가 되어도 문제가 없다. 다만 대시보드나 조회 필터 중에 "시간권 = `UNUSED`"를 전제로 집계하는 곳이 있다면 결과가 달라진다. 수정 때 `TicketStatus.UNUSED` 사용처를 다시 확인한다.
- **동시 입실**: 활성화 update는 반드시 `status = UNUSED` 조건부로 하고, 세션 생성과 같은 트랜잭션에서 해야 한다. 현재 기간권 경로와 같은 방식이다.
- **테스트가 가린 버그**: E2E 픽스처가 실제로 만들어지지 않는 상태(`ACTIVE` 시간권)를 직접 넣고 있었다. 다른 E2E에도 같은 방식의 픽스처가 있는지 수정 때 함께 본다.

## Decisions (2026-10-24, 사용자 결정)

1. **시간권의 `ACTIVE` = 첫 입실 이후.** 기간권과 같은 의미로 통일한다. A안을 채택한다.
2. **시간권에도 `activatedAt`(첫 입실 시각)을 기록한다.** `Ticket.activatedAt`은 이미 nullable 컬럼(`prisma/schema.prisma:263`)이므로 스키마 변경은 없다. 첫 입실 때 이용권에 기록할 값은 `activatedAt`이 공통이고, 기간권만 `expiresAt`을 더한다. repository 인자 `updatePeriodTicketData`도 이용권 종류와 무관한 이름으로 바꾼다.
3. **데이터 마이그레이션은 하지 않는다.** 보정할 운영 데이터가 없다.

결정 2에 따른 영향 확인:
- 환불의 미사용 판정(`refund.service.ts:isUnusedTicket`)에서 `activatedAt === null`을 보는 것은 기간권 분기뿐이다. 시간권 분기는 분 비교만 하므로 영향이 없다.
- 시간권 조회 응답(`ticket.service.ts`의 TIME 변환)에는 `activatedAt`이 들어 있지 않다. 응답에 노출할지는 이 버그 범위 밖이므로 이번에는 바꾸지 않는다.

## Open Questions

- 없음 (위 Decisions로 해소)
