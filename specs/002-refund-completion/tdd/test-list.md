---
feature: 002-refund-completion
loop: outside-in
profile: .specify/memory/tdd-profile.md
spec_criteria: 92
planned_at: 0f6338f
updated_at: 0f6338f
suite_baseline: green
---

# 테스트 목록: 환불 기능 완료

이 문서는 `spec.md`·`plan.md`·`contracts/rest-api.md`·`data-model.md`에서 도출한 동작 목록이다. 테스트나 소스 코드는 아직 없다. 동작 하나가 TDD 사이클 하나이며, `/speckit-tdd-run`이 위에서부터 차례로 처리한다.

- **추적(traces) 표기**: `QS-스토리-시나리오`는 `spec.md` 해당 사용자 스토리의 인수 시나리오 번호다(예: `QS-1-1a`는 사용자 스토리 1의 시나리오 1a). quickstart·tasks의 E2E 테스트 이름 끝에 붙는 번호와 같다. `FR-`는 `spec.md`의 기능 요구사항, `INV-`는 아래 "불변식"에 근거와 함께 적은 항목이다.
- **상태**: 모든 동작은 `PENDING`(테스트 미작성)이다. 기준선은 2026-10-27 커밋 `0f6338f`에서 통과(단위 163개, E2E 57개)로 기록했다(`cycle-log.md`).

## 외부 루프: 인수 동작

`spec.md`의 인수 시나리오마다 하나다. 동작 문장은 명세의 Given/When/Then 원문을 그대로 옮겼다. 실제 진입점(HTTP API)으로 호출해 확인하며, 기능이 끝까지 동작할 때까지 실패 상태로 남는다.

| 사용자 스토리 | E2E 파일 | 인수 동작 |
|---|---|---|
| 1 | `test/refund-customer.e2e-spec.ts` | A1~A10 |
| 2 | `test/refund-store.e2e-spec.ts` | A11~A26 |
| 3 | `test/refund-entry.e2e-spec.ts` | A27~A29 |
| 4 | `test/refund-ledger.e2e-spec.ts` | A30~A33 |
| 5 | `test/refund-recovery.e2e-spec.ts` | A34~A55 |
| 6 | `test/refund-payment-mismatch.e2e-spec.ts` | A56~A59 |
| 10 | `test/refund-operations.e2e-spec.ts` | A77~A92 |
| 7 | `test/refund-callback-auth.e2e-spec.ts` | A60~A63 |
| 8 | `test/refund-history.e2e-spec.ts` | A64~A68 |
| 9 | `test/refund-notifications.e2e-spec.ts` | A69~A76 |

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| A1 | Given 고객이 결제를 마친 미사용 이용권을 이용 기한 안에 가지고 있을 때, When 환불을 신청하면, | QS-1-1 | example | DONE | `test/refund-customer.e2e-spec.ts` |
| A2 | Given 환불 가능한 이용권이 있을 때, When 이용 종료와 환불 금액에 대한 명시적 동의 없이 신청하면, Then 동의가 필요하다는 오류로 거절되고 이용권·좌석·환불 기록에는 변화가 없다. | QS-1-1a | example | DONE | `test/refund-customer.e2e-spec.ts` |
| A3 | Given 다른 고객의 이용권일 때, When 환불을 신청하면, | QS-1-2 | example | DONE | `test/refund-customer.e2e-spec.ts` |
| A4 | Given 이용권 주문의 결제가 성공 상태가 아닐 때, When 환불을 신청하면, Then `PAYMENT_NOT_COMPLETED`로 거절된다. | QS-1-3 | example | DONE | `test/refund-customer.e2e-spec.ts` |
| A5 | Given 환불이 확정되고 지급까지 완료된 이용권일 때, When 환불을 신청하면, Then `ALREADY_REFUNDED`로 거절된다. | QS-1-4 | example | DONE | `test/refund-customer.e2e-spec.ts` |
| A6 | Given 같은 이용권에 확정됐지만 지급이 끝나지 않은 환불이 있을 때, When 환불을 신청하면, Then `REFUND_IN_PROGRESS`로 거절된다. | QS-1-5 | example | DONE | `test/refund-customer.e2e-spec.ts` |
| A7 | Given 사용 이력이 있는 이용권일 때, When 환불을 신청하면, | QS-1-6 | example | DONE | `test/refund-customer.e2e-spec.ts` |
| A8 | Given 지금 이용 중인 이용권일 때, When 환불을 신청하면, Then `USED_TICKET`으로 거절된다. | QS-1-7 | example | DONE | `test/refund-customer.e2e-spec.ts` |
| A9 | Given 이용 기한(정기권은 활성화 기한, 시간권은 소진 기한)이 지난 미사용 이용권일 때, When 환불을 신청하면, | QS-1-8 | example | DONE | `test/refund-customer.e2e-spec.ts` |
| A10 | Given 확정된 미지급 환불과 사용 이력이 함께 있는 이용권일 때, When 환불을 신청하면, | QS-1-9 | example | DONE | `test/refund-customer.e2e-spec.ts` |
| A11 | Given 사용 이력이 있는 이용권이 있을 때, When 그 매장 점주가 0원보다 크고 실결제액 이하인 금액과 사유를 입력해 환불하면, | QS-2-1 | example | DONE | `test/refund-store.e2e-spec.ts` |
| A12 | Given 1번으로 이용은 종료됐고 환불금 지급 처리 중일 때, When PG가 확정된 환불 금액의 취소를 확정하면, Then 환불금 지급 완료로 바뀌며 이용 종료·좌석 해제는 반복하지 않는다. | QS-2-2 | example | DONE | `test/refund-store.e2e-spec.ts` |
| A13 | Given 이용 기한이 지난 미사용 이용권이 있을 때, When 그 매장 점주가 0원부터 실결제액까지의 금액과 사유를 입력하고 이용 종료에 동의해 환불하면, | QS-2-3 | example | DONE | `test/refund-store.e2e-spec.ts` |
| A14 | Given 시간을 다 써서 소진된 시간권이 있을 때, When 점주가 금액과 사유를 입력해 매장 환불을 하면, Then 양수 금액은 1번, 0원은 4번과 같이 처리된다. | QS-2-3a | example | DONE | `test/refund-store.e2e-spec.ts` |
| A15 | Given 사용 이력이 있는 이용권이 있을 때, When 점주가 금액 0원과 사유로 환불하면, | QS-2-4 | example | DONE | `test/refund-store.e2e-spec.ts` |
| A16 | Given 사용 이력이 있는 이용권이 있을 때, When 점주가 실결제액보다 큰 금액을 입력하면, | QS-2-5 | example | DONE | `test/refund-store.e2e-spec.ts` |
| A17 | Given 사용 이력이 있는 이용권이 있을 때, When 점주가 사유 없이 환불하면, Then 환불이 거부된다. | QS-2-6 | example | DONE | `test/refund-store.e2e-spec.ts` |
| A18 | Given 다른 매장의 이용권일 때, When 점주가 자기 매장에서 그 이용권을 매장 환불하려 하면, | QS-2-7 | example | DONE | `test/refund-store.e2e-spec.ts` |
| A19 | Given 사용 이력이 있는 이용권이 있을 때, When 고객지원 계정이 매장 환불을 하면, Then 권한이 없어 거부된다. | QS-2-7a | example | DONE | `test/refund-store.e2e-spec.ts` |
| A20 | Given 어긴 규칙이 없는 이용권(이용 기한 안의 미사용 이용권)일 때, When 점주가 실결제액 전액으로 매장 환불을 하면, | QS-2-8 | example | DONE | `test/refund-store.e2e-spec.ts` |
| A21 | Given 어긴 규칙이 없는 이용권일 때, When 점주가 실결제액과 다른 금액으로 매장 환불을 하면, | QS-2-8a | example | DONE | `test/refund-store.e2e-spec.ts` |
| A22 | Given 환불금 지급 완료됐거나 확정된 미지급 환불이 있는 이용권일 때, When 점주가 매장 환불을 하면, | QS-2-9 | example | DONE | `test/refund-store.e2e-spec.ts` |
| A23 | Given 고객이 그 이용권으로 지금 이용 중일 때, When 점주가 퇴실 동의 없이 매장 환불을 하면, | QS-2-10 | example | DONE | `test/refund-store.e2e-spec.ts` |
| A24 | Given 고객이 그 이용권으로 지금 이용 중일 때, When 점주가 퇴실 동의를 담아 다시 요청하면, | QS-2-11 | example | DONE | `test/refund-store.e2e-spec.ts` |
| A25 | Given 고객이 이용 중일 때, When 점주가 퇴실 동의를 담았지만 실결제액보다 큰 금액으로 요청하면, | QS-2-12 | example | DONE | `test/refund-store.e2e-spec.ts` |
| A26 | Given 11번으로 이용 종료·환불이 확정된 뒤 환불금 지급 처리 중일 때, When PG가 취소 실패를 확정하면, | QS-2-13 | example | DONE | `test/refund-store.e2e-spec.ts` |
| A27 | Given 환불 확정으로 이용이 종료됐고 지급도 완료된 이용권일 때, When 입실하려 하면, Then 이용 종료 오류로 거부된다. | QS-3-1 | example | DONE | `test/refund-entry.e2e-spec.ts` |
| A28 | Given 환불 확정으로 이용이 종료됐고 환불금 지급 처리 중이거나 PG 취소 결과 확인 실패인 이용권일 때, When 입실하려 하면, Then 환불금 지급 완료 여부와 관계없이 이용 종료 오류로 거부된다. | QS-3-2 | example | DONE | `test/refund-entry.e2e-spec.ts` |
| A29 | Given 환불 확정 후 PG 취소 요청이 실패한 이용권일 때, When 입실하려 하면, Then 이용 종료 오류로 거부된다. 환불금 지급 실패를 이유로 이용권·고정석을 복구하지 않는다. | QS-3-3 | example | DONE | `test/refund-entry.e2e-spec.ts` |
| A30 | Given 환불금 지급 처리 중인 환불이 있을 때, When PG가 취소를 확정하면, | QS-4-1 | example | DONE | `test/refund-ledger.e2e-spec.ts` |
| A31 | Given 1번으로 실제 지급과 원장 기록이 반영됐을 때, When 같은 지급 확정 통보가 다시 오거나 거래조회로 다시 반영을 시도하면, | QS-4-2 | example | DONE | `test/refund-ledger.e2e-spec.ts` |
| A32 | Given 환불금 지급 처리 중인 환불이 있을 때, When PG가 PG 취소 요청 실패를 확정하면, Then 원장에는 아무 기록도 생기지 않는다. | QS-4-3 | example | DONE | `test/refund-ledger.e2e-spec.ts` |
| A33 | Given 환불금 지급 처리 중이거나 PG 취소 결과 확인 실패인 환불이 있을 때, When 아직 확정되지 않았으면, Then 원장에는 아무 기록도 없다. | QS-4-4 | example | DONE | `test/refund-ledger.e2e-spec.ts` |
| A34 | Given 이용 종료·환불 금액이 확정됐을 때, When PG 취소 요청이 보내기 전에 실패하면, Then PG 취소 요청 실패·환불금 지급 조치 필요를 기록하고 운영자에게 알린다. 접수된 환불과 이용 종료는 유지하며 응답에서도 이용 종료 완료와 미지급 상태를 구분한다. | QS-5-1 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A35 | Given 응답 없음으로 환불금 지급 처리 중일 때, When 정해진 시간이 지나고 거래조회 결과가 확정된 환불 금액의 취소 완료이면, Then 환불금 지급 완료와 실제 금액의 원장 기록을 함께 반영한다. 이용 종료·좌석 해제는 반복하지 않는다. | QS-5-2 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A36 | Given 2번과 같을 때, When 거래조회 결과가 PG 거절이면, Then PG 취소 요청 실패와 환불금 지급 조치 필요를 기록하고 알린다. 확정된 환불 금액과 이용 종료는 유지한다. | QS-5-3 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A37 | Given 고객 환불이나 매장 환불의 PG 응답이 없을 때, When 거래조회로 PG 미접수가 확인되고 재전송 한도가 남아 있으면, Then 같은 환불 건에서 같은 금액으로 다시 보내고 환불금 지급 처리 중으로 둔다. | QS-5-4 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A38 | Given 시스템 자동 취소의 PG 응답이 없을 때, When 거래조회로 PG 미접수가 확인되고 재전송 한도가 남아 있으면, Then 4번과 같은 규칙으로 같은 금액을 다시 보낸다. | QS-5-5 | example | DONE | `test/refund-recovery.e2e-spec.ts` › … (QS-5-5) |
| A39 | Given 어느 경로든 자동 재전송 한도를 모두 소진했을 때, When 한도 횟수까지 보낸 취소 요청이 PG에 접수되지 않았음을 거래조회로 확인하면, Then 해당 PG 취소 요청을 실패로 종료해 자동 조회·재전송 대상에서 제외하고, 운영자의 지급 재처리가 필요한 환불로 남겨 알린다. 환불 금액과 이용 종료는 유지한다. 조회가 실패하거나 PG가 처리 중이면 시도 실패로 종료하지 않는다. | QS-5-6 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A40 | Given PG 결제 취소 결과가 미확정일 때, When 거래조회 자체가 실패하면, Then 환불금 지급 성공·실패로 단정하지 않고 정해진 간격으로 다시 조회한다. 다른 PG 취소 요청과 별도 환불금 지급은 허용하지 않는다. | QS-5-7 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A41 | Given 거래조회가 연속 실패했을 때, When 정해진 횟수에 도달하면, Then PG 취소 결과 확인 실패로 표시하고 운영자에게 알린다. 환불금은 미지급·결과 확인 중으로 남고 이용 종료는 유지된다. | QS-5-8 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A42 | Given PG 취소 결과 확인 실패 건이 여러 건 쌓였을 때, When 자동 재확인 시점이 되면, Then 가장 오래된 1건만 PG 거래조회한다. 쌓인 건수와 관계없이 해당 시점의 자동 조회는 1번이다. | QS-5-9 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A43 | Given 9번의 1건 조회가 진행 중일 때, When PG에서 정상 응답을 받으면, Then 그 결과를 반영하고 나머지를 정해진 건수씩 나눠 조회한다. 완료·거절·미접수는 각 규칙을 따르고, PG 처리 중·조회 장애는 지급을 확정하지 않고 재확인한다. | QS-5-10 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A44 | Given PG 취소 결과 확인 실패 건이 쌓였을 때, When 운영자가 전체 재확인을 실행하면, Then 자동 재확인 예정 시각을 기다리지 않고 PG 취소 결과 확인 실패 건을 정해진 건수씩 묶어 조회한다. 재조회 실행은 환불 확정이나 환불금 지급 완료를 뜻하지 않는다. | QS-5-10a | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A45 | Given PG 취소 결과 확인 실패 건이 있을 때, When 고객지원 계정이 아닌 사용자가 전체 재확인을 실행하면, Then 권한 오류로 거부된다. | QS-5-10b | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A46 | Given 확정된 환불 금액의 PG 취소 요청이 있을 때, When PG가 다른 금액의 취소 완료를 알리면, Then 실제 환불금 지급액과 원장을 함께 기록하고 확정된 환불 금액은 바꾸지 않는다. 부족액·초과액을 구분해 환불금 지급 조치 필요로 두고 운영자에게 알린다. | QS-5-11 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A47 | Given 시스템 자동 취소 건일 때, When 환불금 지급 결과를 받지 못하면, Then 2~11번의 같은 조회·재전송·미지급 관리 규칙을 적용한다. 승인 금액 불일치 건은 이용권을 만들지 않는다. | QS-5-12 | example | DONE | `test/refund-recovery.e2e-spec.ts` › … (QS-5-12) |
| A48 | Given 해당 매장 점주 또는 운영자가 조회할 수 있는 환불에 미확정 PG 취소 요청이 있고 최근 조회나 진행 중 작업이 없을 때, When 그 환불의 PG 처리 결과 확인을 실행하고 PG가 확정된 환불 금액의 취소 완료를 응답하면, Then 자동 조회 예정 시각 전이라도 해당 시도 한 건만 즉시 조회하고, 환불금 지급 완료·실제액·원장을 한 번 반영해 결과를 보여준다. | QS-5-13 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A49 | Given 결과가 미확정인 PG 취소 요청의 개별 확인을 실행했을 때, When PG가 아직 처리 중이라고 응답하거나 거래조회가 실패하면, Then 각각 처리 중 또는 결과 확인 불가로 안내하고 지급을 확정하지 않는다. 기존 조회 일정·오류 처리 규칙으로 다시 확인하며 다른 환불금 지급 차단을 유지한다. | QS-5-14 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A50 | Given 그 PG 취소 요청을 전송·조회하는 자동 작업이나 다른 개별 확인이 진행 중일 때, When 점주 또는 운영자가 같은 환불의 PG 확인을 실행하면, Then 진행 중인 작업과 현재 저장 상태를 안내하고 PG를 중복 호출하지 않는다. 이후 환불 상세에서 반영 결과를 확인할 수 있다. | QS-5-15 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A51 | Given PG 취소 결과 확인 실패 환불이 여러 건 쌓여 있을 때, When 점주 또는 운영자가 그중 한 건만 개별 확인하면, Then 지정한 환불만 확인한다. 정상 응답을 받아도 나머지 건의 일괄 조회를 시작하거나 전체 장애 복구 모드·예정 시각을 바꾸지 않는다. | QS-5-16 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A52 | Given 다른 매장 점주·일반 고객·미로그인 사용자가 있을 때, When 개별 PG 확인을 실행하면, Then 다른 매장 점주는 찾을 수 없음, 일반 고객은 권한 오류, 미로그인은 인증 오류로 거부한다. 거부한 요청은 PG를 호출하거나 환불 상태를 바꾸지 않는다. | QS-5-17 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A53 | Given 환불금 지급 완료·0원 환불·별도 환불금 지급 예약·금액 불일치 검토 등으로 개별 PG 조회 대상이 아닌 환불이 있을 때, When 점주 또는 운영자가 개별 PG 확인을 실행하면, Then PG를 호출하지 않고 저장된 상태를 보여준다. 별도 환불금 지급 예약과 기존 실패 이력은 바꾸지 않는다. 최근 시도가 한도 소진·전송 전 실패·PG 거절로 실패한 환불은 개별 조회 대상이므로 19번·스토리 10의 1a번으로 처리한다. | QS-5-18 | example | DONE | `test/refund-recovery.e2e-spec.ts` › … (QS-5-18) 2개(7a 저장 상태, 실패 시도 경로·예약) |
| A54 | Given 점주 또는 운영자가 권한 범위 안 환불을 개별 확인할 때, When 미확정 시도의 PG 미접수 또는 이미 실패가 확정된 시도의 미접수·거절 확정이 확인되면, Then 자동 재전송 횟수와 관계없이 확정된 환불 금액으로 즉시 다시 보낸다. 미확정 시도는 기존 PG 취소 요청 식별자로 보내고, 최근 시도가 한도 소진·전송 전 실패·PG 거절로 이미 실패한 경우는 FR-057의 조건을 확인한 뒤 실패 이력을 보존한 채 같은 환불 아래 새 식별자를 발급한 PG 취소 요청을 기록해 보낸다. 별도 버튼·추가 대기·반복 조회를 요구하지 않는다. 실제 지급액·다른 미확정 지급·지급 방식·활성 예약·작업 담당을 확인해 중복 지급을 막고 결과와 실행자를 기록한다. 조회 오류이면 보내지 않으며, 실패 확정 건에서 처리 중·취소 성공 등 모순 결과가 오면 운영자 확인 대상으로 남기고 추가 지급을 차단한다. 미확정 요청의 조회에서 거절이 새로 확인되면 실패·조치 필요만 기록하고 같은 실행에서 새 요청을 만들지 않는다. | QS-5-19 | example | DONE | `test/refund-recovery.e2e-spec.ts` › … (QS-5-19) 2개(7a 미확정 시도, 실패 시도 새 요청·새로 확인한 거절) |
| A55 | Given 같은 시도의 직전 조회가 끝났고 그 조회 시작 시각부터 정해진 간격이 아직 지나지 않았을 때, When 점주 또는 운영자가 개별 PG 확인을 반복 실행하면, Then 최근 조회 시각과 저장된 상태를 보여주고 PG를 추가 호출하지 않는다. 점주·운영자·자동 작업의 조회 시각을 같은 시도 기준으로 공유한다. | QS-5-20 | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| A56 | Given 결제를 요청한 주문이 있을 때, When PG가 결제 금액과 다른 금액으로 승인했다고 알리면, | QS-6-1 | example | DONE | `test/refund-payment-mismatch.e2e-spec.ts` › … (QS-6-1) |
| A57 | Given 1번의 자동 취소 환불이 확정됐을 때, When PG가 확정된 환불 금액의 취소를 확정하면, Then 환불금 지급 완료로 바뀌고 실패 결제는 성공으로 복구하지 않는다. | QS-6-2 | example | DONE | `test/refund-payment-mismatch.e2e-spec.ts` › … (QS-6-2) |
| A58 | Given 1번의 자동 취소가 응답 없음일 때, When 정해진 시간이 지나면, Then 사용자 스토리 5와 같이 처리된다. | QS-6-3 | example | DONE | `test/refund-payment-mismatch.e2e-spec.ts` › … (QS-6-3) |
| A59 | Given 결제 금액과 같은 금액으로 승인됐을 때, When 승인 결과를 받으면, Then 기존처럼 이용권이 발행된다. | QS-6-4 | example | DONE | `test/refund-payment-mismatch.e2e-spec.ts` › … (QS-6-4) |
| A60 | Given 환불금 지급 처리 중인 환불이 있을 때, When 올바른 서명을 담은 환불 결과 콜백이 로그인 없이 오면, Then 결과가 반영된다. | QS-7-1 | example | DONE | `test/refund-callback-auth.e2e-spec.ts` › … (QS-7-1) |
| A61 | Given 환불금 지급 처리 중인 환불이 있을 때, When 서명이 없거나 틀린 환불 결과 콜백이 오면, Then 거부되고 환불금 지급 상태는 바뀌지 않는다. | QS-7-2 | example | DONE | `test/refund-callback-auth.e2e-spec.ts` › … (QS-7-2) |
| A62 | Given 환불금 지급 처리 중인 환불이 있을 때, When 로그인한 사용자가 서명 없이 콜백을 보내면, Then 거부된다. | QS-7-3 | example | DONE | `test/refund-callback-auth.e2e-spec.ts` › … (QS-7-3) |
| A63 | Given 결제를 요청한 주문이 있을 때, When 결제 결과 콜백에 1~3번과 같은 조건으로 요청이 오면, Then 1~3번과 같이 처리된다. | QS-7-4 | example | DONE | `test/refund-callback-auth.e2e-spec.ts` › … (QS-7-4) |
| A64 | Given 점주가 매장을 소유하고 있을 때, When 자기 매장의 환불 내역을 조회하면, Then 조회된다. | QS-8-1 | example | DONE | `test/refund-history.e2e-spec.ts` / QS-8-1 |
| A65 | Given 점주가 있을 때, When 자기 소유가 아닌 매장의 환불 내역을 조회하면, | QS-8-2 | example | DONE | `test/refund-history.e2e-spec.ts` / A65 |
| A66 | Given 고객이 있을 때, When 자기 환불 내역을 조회하면, Then 조회된다. | QS-8-3 | example | DONE | `test/refund-history.e2e-spec.ts` / A66 |
| A67 | Given 고객이 있을 때, When 환불 내역을 조회하면, Then 자기 환불 내역만 보인다. 다른 고객을 지정해 조회할 방법은 없다. | QS-8-4 | example | PENDING | |
| A68 | Given 고객지원 계정이 있을 때, When 어느 매장이나 사용자의 환불 내역을 조회하면, Then 조회된다. | QS-8-5 | example | PENDING | |
| A69 | Given 환불 가능한 이용권이 있을 때, When 고객 환불이나 매장 환불을 요청하면, | QS-9-1 | example | PENDING | |
| A70 | Given 환불 건이 있을 때, When 점주나 고객이 환불 내역을 조회하면, | QS-9-2 | example | PENDING | |
| A71 | Given 환불금 지급 처리 중인 고객 환불이 있을 때, When PG 취소 요청이 실패로 확정되면, Then 신청한 고객·그 매장 점주·운영자에게 미지급 알림이 남는다. | QS-9-3 | example | PENDING | |
| A72 | Given 환불금 지급 처리 중인 매장 환불이 있을 때, When PG 취소 요청이 실패로 확정되면, Then 그 매장 점주와 운영자에게 미지급 알림이 남는다. | QS-9-3a | example | PENDING | |
| A73 | Given 알림이 있을 때, When 점주가 자기 알림을 조회하면, Then 자기 매장의 알림만 보인다. | QS-9-4 | example | PENDING | |
| A74 | Given 알림이 있을 때, When 고객이 자기 알림을 조회하면, Then 자기 환불의 알림만 보인다. | QS-9-4a | example | PENDING | |
| A75 | Given 안 읽은 알림이 있을 때, When 받은 사람이 그 알림을 읽음 처리하면, | QS-9-4b | example | PENDING | |
| A76 | Given PG 취소 결과 확인 실패·환불 금액 불일치·시스템 자동 취소 실패가 생겼을 때, When 운영자가 알림을 조회하면, Then 그 알림이 보인다. | QS-9-5 | example | PENDING | |
| A77 | Given PG 취소 요청의 실패가 확정됐고 실제 환불금 지급액이 0원이며 다른 환불금 지급이 없을 때, When 운영자가 원인을 해결하고 재시도를 요청하면, Then 서버가 확정된 환불 금액의 취소 요청을 새 PG 취소 요청 식별자로 기록하고 PG에 보낸다. 실행자·사유를 기록하고 이용권·좌석은 복구하지 않는다. | QS-10-1 | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-1) |
| A78 | Given 자기 매장 환불의 최근 PG 취소 요청이 한도 소진·전송 전 실패·PG 거절로 이미 실패했고 실제 환불금 지급액이 0원이고 다른 미확정 지급이 없으며 지급 방식이 PG이고 활성 별도 지급 예약이 없을 때, When 점주가 PG 처리 결과를 개별 확인해 미접수 또는 거절 확정이 확인되면, Then 서버가 별도 버튼이나 사유 입력 없이 확정된 환불 금액의 취소 요청을 새 PG 취소 요청 식별자로 기록해 즉시 보낸다. 이전 실패 기록과 이용 종료는 유지하고 점주·시각·개별 확인에 따른 재시도임을 기록한다. 조회 오류이면 보내지 않고 기존 실패를 보존한다. 처리 중·취소 성공처럼 기존 실패와 모순되면 운영자에게 알리고 추가 지급을 차단한다. | QS-10-1a | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-1a) |
| A79 | Given 점주 또는 운영자의 개별 확인으로 1a번처럼 PG에 취소 요청을 새 PG 취소 요청 식별자로 보냈을 때, When 그 요청의 응답이 없고 이후 자동 조회에서 PG 미접수가 확인되면, Then 자동 작업은 새 PG 취소 요청 식별자로 보낸 취소 요청을 정해진 횟수까지만 다시 보낸다. 이전에 실패한 요청의 상태·재전송 횟수는 바꾸지 않는다. 재전송 한도를 소진한 뒤에도 PG 미접수가 확인되면 자동 처리를 멈춘다. 점주 또는 운영자는 개별 확인을 다시 실행할 수 있다. | QS-10-1b | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-1b) |
| A80 | Given 운영자가 요청 키 K1로 환불 R에 대해 직접 재시도를 실행해 PG 취소 요청 A를 생성했고 최초 202 응답이 저장됐으며 A의 결과가 미확정일 때, When 그 운영자가 환불 R에 대해 K1 또는 다른 키 K2로 다시 요청하면, Then K1은 환불 대상과 입력 사유를 첫 요청과 비교해 내용이 같으면 최초 응답과 PG 취소 요청 식별자 A를 반환하고, 내용이 바뀌었으면 IDEMPOTENCY_KEY_REUSED로 거절한다. K2는 환불 R을 잠근 뒤 A가 미확정임을 확인해 REFUND_PAYOUT_UNRESOLVED로 거절한다. 반복·동시 요청으로 취소 요청 기록을 추가하거나 PG에 취소를 추가 요청하지 않는다. | QS-10-1c | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-1c) |
| A81 | Given PG 취소 직접 재시도 요청이 들어올 때, When 고객이나 점주가 실행하면, Then 역할 제한으로 REFUND_FORBIDDEN(403)을 반환한다. 운영자의 같은 키·같은 내용 반복은 현재 상태와 관계없이 최초 응답을 반환한다. 새 실행 요청의 지급 완료 등 재처리 불가 상태는 REFUND_PAYOUT_NOT_ACTIONABLE(409), 결과 미확정·활성 별도 지급 예약은 REFUND_PAYOUT_UNRESOLVED(409), 미지급액이 남은 일부 지급은 REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL(409)로 거절한다. 거절하거나 최초 응답을 반환한 요청은 PG 취소 요청 기록과 호출을 추가하지 않는다. | QS-10-1d | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-1d) |
| A82 | Given PG 취소 요청이 처리 중이거나 조회 결과를 확인하지 못했을 때, When 새 식별자를 발급한 PG 취소 요청 또는 별도 환불금 지급을 요청하면, Then 환불금 지급 결과 미확정 오류로 거부한다. | QS-10-2 | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-2) |
| A83 | Given 모든 PG 취소 요청의 결과가 확정됐고 환불금 지급 조치 필요·미지급액이 남아 있을 때, When 운영자가 별도 환불금 지급을 예약하면, Then 미지급액과 같은 금액을 예약하고 다른 PG 취소 요청·별도 환불금 지급을 차단한다. 예약은 환불금 지급 완료가 아니다. | QS-10-3 | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-3) |
| A84 | Given 운영자가 예약한 별도 환불금 지급이 있을 때, When 실제 지급 뒤 거래 식별자·환불금 지급 시각·예약과 같은 금액·증빙을 제출하면, Then 별도 환불금 지급과 실제 금액의 원장을 함께 한 번만 기록한다. 합계가 확정된 환불 금액에 이르고 검토 사항이 없으면 환불금 지급 완료가 된다. | QS-10-4 | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-4) |
| A85 | Given 별도 환불금 지급이 예약됐지만 실제 환불금 지급 여부를 확인하지 못했을 때, When 확인 지연 알림 기준에 도달하거나 담당자가 바뀌면, Then 예약을 유지하고 운영자에게 확인을 요구한다. 시간 초과만으로 예약을 풀거나 다른 환불금 지급을 허용하지 않는다. | QS-10-5 | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-5) |
| A86 | Given 별도 환불금 지급이 이미 기록됐을 때, When 같은 지급 확정 요청이 반복되면, Then 기존 결과를 반환하고 환불금 지급액·원장을 더하지 않는다. 다른 환불에서 같은 지급 거래 식별자를 쓰면 거부한다. | QS-10-6 | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-6) |
| A87 | Given PG가 확정된 환불 금액보다 적게 취소했고 실제 금액이 확인됐을 때, When 운영자가 별도 환불금 지급을 예약하면, Then 확정된 환불 금액에서 실제 환불금 지급액을 뺀 부족액만 예약·지급할 수 있다. 같은 환불의 PG 결제 취소와 부족액 지급은 각각 실제 금액으로 원장에 기록한다. 부족액의 실제 환불금 지급 증빙을 확정할 때 부족 지급 검토도 함께 마치고 전체 환불금 지급 완료로 바꾼다. | QS-10-7 | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-7) |
| A88 | Given PG가 확정된 환불 금액보다 많이 취소했을 때, When 운영자가 증빙과 사유로 불일치 검토를 마치면, Then 실제액·초과액·검토 기록을 유지하고 환불금 지급 완료로 표시한다. 추가 환불금 지급이나 확정된 환불 금액 덮어쓰기는 하지 않으며 초과액 회수는 후속 범위다. | QS-10-8 | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-8) |
| A89 | Given 고객이나 점주 계정일 때, When PG 외 수단으로 지급할 환불금의 예약을 요청하면, Then 권한 오류로 거부된다. | QS-10-9 | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-9) |
| A90 | Given 고객이나 점주 계정일 때, When PG 외 수단으로 실제 지급한 환불금의 증빙 등록이나 미지급 확인을 요청하면, Then 권한 오류로 거부된다. | QS-10-9a | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-9a) |
| A91 | Given 고객이나 점주 계정일 때, When PG 초과 취소에 대한 운영자 검토 결과 등록을 요청하면, Then 권한 오류로 거부된다. | QS-10-9b | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-9b) |
| A92 | Given 별도 환불금 지급이 예약됐을 때, When 운영자가 실제로 지급하지 않았음을 증빙과 사유로 확인하면, Then 해당 예약을 실패로 종료하고 환불금 지급 조치 필요로 남긴다. 환불금 지급 여부가 불명확하면 예약을 종료할 수 없다. | QS-10-10 | example | DONE | `test/refund-operations.e2e-spec.ts` › … (QS-10-10) |

## 내부 루프: 단위 동작

`plan.md`와 `tasks.md`의 담당 파일별로 묶었다. 한 줄이 관찰 가능한 결과 하나다. 경계값은 양쪽을 모두 적었다. 속성 기반 테스트 도구가 없으므로(프로필 `property: null`) 불변식은 경계 예시로 표본 검증한다.

### `src/config/validation.schema.ts, src/config/configuration.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U1 | PG_CALLBACK_SECRET 외 13개 환불 설정을 생략하면 API 계약 §8 표의 기본값(60·5·15·10·30·15·300·5·900·20·3·3600·300)으로 읽힌다 | FR-022, FR-055 | example | DONE | `src/config/configuration.spec.ts` › refund·pgCallback 섹션 › PG_CALLBACK_SECRET 외 13개 환불 설정을 생략하면 API 계약 §8의 기본값으로 읽힌다 |
| U2 | PG_CALLBACK_SECRET이 없으면 설정 검증이 실패한다 | FR-032 | example | DONE | `src/config/validation.schema.spec.ts` › PG 콜백 서명 비밀값(PG_CALLBACK_SECRET) › PG_CALLBACK_SECRET이 없으면 필수값 누락으로 검증이 실패한다 |
| U3 | PG_CALLBACK_SECRET이 31자이면 설정 검증이 실패한다 | FR-032 | example | DONE | `src/config/validation.schema.spec.ts` › PG 콜백 서명 비밀값(PG_CALLBACK_SECRET) › PG_CALLBACK_SECRET이 31자이면 검증이 실패한다 |
| U4 | PG_CALLBACK_SECRET이 32자이면 설정 검증을 통과한다 | FR-032 | example | DONE | `src/config/validation.schema.spec.ts` › PG 콜백 서명 비밀값(PG_CALLBACK_SECRET) › PG_CALLBACK_SECRET이 32자이면 검증을 통과한다 |
| U5 | REFUND_RESEND_LIMIT=0이면 설정 검증을 통과한다 | FR-024 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › REFUND_RESEND_LIMIT=0이면 검증을 통과한다 |
| U6 | REFUND_RESEND_LIMIT=-1이면 설정 검증이 실패한다 | FR-024 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › REFUND_RESEND_LIMIT=-1이면 검증이 실패한다 |
| U7 | 시간·횟수 설정(표본: REFUND_QUERY_INTERVAL_SECONDS)이 0이면 설정 검증이 실패한다 | FR-055 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › %s=0이면 검증이 실패한다 (12개 설정) |
| U8 | 1이 허용되는 시간·횟수 설정(처리 기한·정상 재조회 간격 제외, 조회 간격 상한은 첫 간격도 1)이 1이면 설정 검증을 통과한다. 2026-10-27 정정: 처음 표본으로 적은 REFUND_QUERY_INTERVAL_SECONDS는 탐색 주기+응답 제한(최소 2) 이상이어야 해 1이 될 수 없다 | FR-055 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › %s=1이면 검증을 통과한다 (10개 설정) |
| U9 | 같은 설정이 소수 1.5이면 설정 검증이 실패한다 | FR-055 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › %s가 소수 1.5이면 검증이 실패한다 (13개 설정) |
| U10 | REFUND_WORK_LEASE_SECONDS가 REFUND_PG_TIMEOUT_SECONDS와 같으면 설정 검증이 실패한다 | FR-055 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › REFUND_WORK_LEASE_SECONDS가 REFUND_PG_TIMEOUT_SECONDS와 같으면 검증이 실패한다 |
| U11 | REFUND_WORK_LEASE_SECONDS가 REFUND_PG_TIMEOUT_SECONDS보다 1 크면 설정 검증을 통과한다 | FR-055 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › REFUND_WORK_LEASE_SECONDS가 REFUND_PG_TIMEOUT_SECONDS보다 1 크면 검증을 통과한다 |
| U12 | REFUND_QUERY_INTERVAL_SECONDS가 SWEEP+TIMEOUT과 같으면 설정 검증을 통과한다 | FR-055 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › REFUND_QUERY_INTERVAL_SECONDS가 SWEEP+TIMEOUT과 같으면 검증을 통과한다 |
| U13 | REFUND_QUERY_INTERVAL_SECONDS가 SWEEP+TIMEOUT보다 1 작으면 설정 검증이 실패한다 | FR-055 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › REFUND_QUERY_INTERVAL_SECONDS가 SWEEP+TIMEOUT보다 1 작으면 검증이 실패한다 |
| U14 | REFUND_QUERY_BACKOFF_MAX_SECONDS가 REFUND_QUERY_BACKOFF_SECONDS와 같으면 설정 검증을 통과한다 | FR-025 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › REFUND_QUERY_BACKOFF_MAX_SECONDS가 REFUND_QUERY_BACKOFF_SECONDS와 같으면 검증을 통과한다 |
| U15 | REFUND_QUERY_BACKOFF_MAX_SECONDS가 REFUND_QUERY_BACKOFF_SECONDS보다 1 작으면 설정 검증이 실패한다 | FR-025 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › REFUND_QUERY_BACKOFF_MAX_SECONDS가 REFUND_QUERY_BACKOFF_SECONDS보다 1 작으면 검증이 실패한다 |
| U267 | REFUND_PG_TIMEOUT_SECONDS를 생략하고 REFUND_WORK_LEASE_SECONDS=11만 설정하면 기본 응답 제한 10과 비교해 설정 검증을 통과한다 | FR-055 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › REFUND_PG_TIMEOUT_SECONDS를 생략하고 REFUND_WORK_LEASE_SECONDS=11만 설정하면 기본 응답 제한 10과 비교해 통과한다 |
| U268 | REFUND_SWEEP_INTERVAL_SECONDS·REFUND_PG_TIMEOUT_SECONDS를 생략하고 REFUND_QUERY_INTERVAL_SECONDS=15만 설정하면 기본값 합 15와 비교해 설정 검증을 통과한다 | FR-055 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › SWEEP·TIMEOUT을 생략하고 REFUND_QUERY_INTERVAL_SECONDS=15만 설정하면 기본값 합 15와 비교해 통과한다 |
| U269 | REFUND_QUERY_BACKOFF_SECONDS를 생략하고 REFUND_QUERY_BACKOFF_MAX_SECONDS=15만 설정하면 기본 첫 간격 15와 비교해 설정 검증을 통과한다 | FR-025 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › REFUND_QUERY_BACKOFF_SECONDS를 생략하고 REFUND_QUERY_BACKOFF_MAX_SECONDS=15만 설정하면 기본 첫 간격 15와 비교해 통과한다 |
| U270 | REFUND_WORK_LEASE_SECONDS=3e1이면 설정 검증과 같은 숫자 해석으로 처리 기한 30초로 읽힌다 (Phase 1 Codex 검수 P2) | FR-055 | example | DONE | `src/config/configuration.spec.ts` › refund·pgCallback 섹션 › REFUND_WORK_LEASE_SECONDS=3e1이면 설정 검증과 같은 숫자 해석으로 30초로 읽힌다 |
| U271 | REFUND_PG_TIMEOUT_SECONDS=40만 설정하면 기본 처리 기한 30과 비교해 설정 검증이 실패한다 (Phase 1 Codex 검수 P1) | FR-055 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › REFUND_PG_TIMEOUT_SECONDS=40만 설정하면 기본 처리 기한 30과 비교해 검증이 실패한다 |
| U272 | REFUND_SWEEP_INTERVAL_SECONDS=20만 설정하면 기본 재조회 간격 15가 20+10보다 작아 설정 검증이 실패한다 (Phase 1 Codex 검수 P1) | FR-055 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › REFUND_SWEEP_INTERVAL_SECONDS=20만 설정하면 기본 재조회 간격 15가 20+10보다 작아 검증이 실패한다 |
| U273 | REFUND_QUERY_BACKOFF_SECONDS=500만 설정하면 기본 간격 상한 300이 500보다 작아 설정 검증이 실패한다 (Phase 1 Codex 검수 P1) | FR-025 | example | DONE | `src/config/validation.schema.spec.ts` › 환불 PG 처리 설정(REFUND_*) › REFUND_QUERY_BACKOFF_SECONDS=500만 설정하면 기본 간격 상한 300이 500보다 작아 검증이 실패한다 |

### prisma/schema.prisma (검증용 DB 제약, src/prisma/refund-constraints.integration.spec.ts)

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U16 | 같은 주문 항목에 decisionStatus=ACCEPTED·targetKind=ORDER_ITEM 환불을 두 번째로 저장하면 unique 위반으로 실패한다 | FR-041, FR-029 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U17 | 같은 주문 항목이라도 decisionStatus=LEGACY_REJECTED 환불은 ACCEPTED 환불과 함께 저장된다 | FR-007a | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U18 | 같은 결제에 decisionStatus=ACCEPTED·targetKind=PAYMENT 환불을 두 번째로 저장하면 실패한다 | FR-030 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U19 | Refund.amount가 -1이면 저장이 실패한다 | FR-012 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U20 | Refund.amount가 0이면 저장된다 | FR-016a | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U21 | 한 환불에 status가 REQUESTED 또는 QUERY_FAILED인 PG 취소 요청을 두 번째로 저장하면 실패한다 | FR-043 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U22 | 한 환불에 FAILED PG 취소 요청이 있어도 REQUESTED PG 취소 요청 하나는 저장된다 | FR-057 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U23 | 같은 (refundId, attemptNumber) PG 취소 요청을 두 번째로 저장하면 실패한다 | FR-057 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U24 | 같은 pgTransactionId를 가진 PG 취소 요청을 두 번째로 저장하면 실패한다 | FR-019 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U25 | PaymentCancel.actualAmount가 -1이면 저장이 실패한다 | FR-027 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U26 | 한 환불에 status=RESERVED 별도 환불금 지급을 두 번째로 저장하면 실패한다 | FR-043 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U27 | 다른 환불에서 같은 externalTransactionId로 별도 환불금 지급을 저장하면 실패한다 | FR-046 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U28 | 같은 paymentCancelId를 가진 원장을 두 번째로 저장하면 실패한다 | FR-019 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U29 | 같은 manualRefundPayoutId를 가진 원장을 두 번째로 저장하면 실패한다 | FR-019 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U30 | paymentCancelId와 manualRefundPayoutId를 둘 다 가진 원장은 저장이 실패한다 | FR-019 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U31 | 같은 환불의 0원 원장(두 지급 ID 모두 null)을 두 번째로 저장하면 실패한다 | FR-016a | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U32 | 같은 (notificationId, userId) 읽음 기록을 두 번째로 저장하면 실패한다 | FR-039 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U33 | 같은 eventKey·audience·recipient 알림을 두 번째로 저장하면 recipient가 null이어도 실패한다 | FR-037 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U34 | 같은 (requesterId, operation, key) 멱등 요청 기록을 두 번째로 저장하면 실패한다 | FR-041 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U274 | Refund.paidAmount가 -1이면 저장이 실패한다 | INV-2 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U275 | decisionStatus=ACCEPTED 환불의 payoutStatus가 NOT_APPLICABLE이면 저장이 실패한다 | INV-2 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U276 | targetKind=ORDER_ITEM 환불의 orderItemId가 null이면 저장이 실패한다 | INV-2 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U277 | targetKind=PAYMENT 환불에 orderItemId가 있으면 저장이 실패한다 | INV-2 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U278 | targetKind=PAYMENT 환불의 source가 SYSTEM이 아니면 저장이 실패한다 | INV-2 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U279 | decisionStatus=ACCEPTED·source=CUSTOMER 환불의 requestedById가 null이면 저장이 실패한다 | INV-2 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U280 | decisionStatus=ACCEPTED·source=STORE 환불의 terminationConsentedAt이 null이면 저장이 실패한다 | INV-2 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U281 | decisionStatus=ACCEPTED 환불의 acceptedAt이 null이면 저장이 실패한다 | INV-2 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U282 | PG 취소 요청의 횟수 필드(resendCount·manualResendCount·inquiryCount·inquiryFailureCount·sendAttemptCount)가 -1이면 저장이 실패한다 | INV-2 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U283 | 별도 환불금 지급 금액이 0이면 저장이 실패한다(양수만 허용) | INV-2 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U284 | PG 조회의 성공 응답에 거래 ID와 실제 취소액이 있으면 SUCCEEDED{pgTransactionId, cancelledAmount}로 분류된다 | FR-027 | example | DONE | `src/pg/pg.service.spec.ts` |
| U285 | PG 조회의 실패 확정 응답은 FAILED{reason}로 분류된다 | FR-024 | example | DONE | `src/pg/pg.service.spec.ts` |
| U286 | PG 조회의 처리 중 응답은 IN_PROGRESS로 분류된다 | FR-025 | example | DONE | `src/pg/pg.service.spec.ts` |
| U287 | PG 취소 전송의 접수 응답은 ACCEPTED로 분류된다 | FR-021 | example | DONE | `src/pg/pg.service.spec.ts` |
| U288 | PG 취소 전송의 즉시 성공 응답은 SUCCEEDED{pgTransactionId, cancelledAmount}로 분류된다 | FR-021 | example | DONE | `src/pg/pg.service.spec.ts` |
| U289 | PG 취소 전송의 거절 응답은 REJECTED{reason}로 분류된다 | FR-021 | example | DONE | `src/pg/pg.service.spec.ts` |
| U290 | PG 취소 송신 중 전송 계층이 예외(비동기 거부·동기 throw)를 내면 보내졌는지 모르므로 UNKNOWN이다 (Phase 2 검수 R1) | FR-022 | example | DONE | `src/pg/pg.service.spec.ts` |
| U291 | PG 취소 조회 중 전송 계층이 예외(비동기 거부·동기 throw)를 내면 QUERY_ERROR다 (Phase 2 검수 R1) | FR-025 | example | DONE | `src/pg/pg.service.spec.ts` |
| U292 | 중단 신호에 반응해 거부하는 전송 계층이라도 송신 시간 초과는 UNKNOWN이다 (Phase 2 검수 R1) | FR-022 | example | DONE | `src/pg/pg.service.spec.ts` |
| U293 | 중단 신호에 반응해 거부하는 전송 계층이라도 조회 시간 초과는 QUERY_ERROR다 (Phase 2 검수 R1) | FR-025 | example | DONE | `src/pg/pg.service.spec.ts` |
| U294 | PG 취소 송신의 비정상 HTTP 상태(예: 401) 응답은 본문이 ACCEPTED·SUCCEEDED여도 UNKNOWN이다 (Phase 2 검수 R2) | FR-021 | example | DONE | `src/pg/pg.service.spec.ts` |
| U295 | 같은 멱등 키 기록 생성이 실패한 뒤 기록이 사라져 있으면(최초 요청 거절로 삭제) 다시 기록을 만들어 처리한다 (Phase 2 검수 R3) | FR-041 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U296 | 환불에 연결되고 두 지급 ID가 모두 null인 원장의 amount가 0이 아니면 저장이 실패한다 (Phase 2 검수 R5) | FR-016a | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U297 | PaymentCancel의 실패가 아닌 갱신(담당 토큰 등)은 failedAt을 바꾸지 않는다 (Phase 2 검수 의견) | FR-021 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` |
| U298 | 최초 응답 저장이 실패하면 같은 트랜잭션의 처리(환불 확정)도 커밋되지 않고, 같은 키의 다음 요청이 처리될 수 있다 (Phase 2 검수 R4) | FR-041 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U299 | 처리 기한이 지난 처리 중 기록은 같은 본문의 다음 요청이 이어받아 처리한다(처리와 응답 저장이 한 트랜잭션이라 이전 처리가 커밋되지 않았음이 보장됨) (Phase 2 검수 R4) | FR-041 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U300 | 처리에 성공하면 최초 응답과 만든 환불이 처리와 같은 트랜잭션에서 기록된다 (Phase 2 검수 R4) | FR-041 | example | DROPPED | U298 테스트가 같은 내용(성공 시 환불·응답 함께 커밋, 실패 시 함께 미커밋)을 확인 |
| U301 | 처리 트랜잭션을 시작하기 전에 멈췄던 요청 A의 기록을 기한 경과 후 B가 이어받아 성공하면, 늦게 재개한 A의 처리는 커밋되지 않고 B의 완료 기록과 최초 응답이 보존된다(같은 키 C는 B 응답을 재생) (Phase 2 재검수 P1) | FR-041 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U302 | 처리 트랜잭션 안에서 처리 중인 요청의 기록은 기한이 지나도 다른 요청이 이어받지 못한다(기한 경과를 이전 작업 종료의 증거로 쓰지 않음) (Phase 2 재검수 P1) | FR-041 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U303 | 기한이 지난 같은 기록을 두 요청이 동시에 이어받으려 하면 하나만 처리한다 (Phase 2 재검수 P1) | FR-041 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U304 | (실제 DB) 담당 토큰이 다른 완료·정리는 기록을 바꾸거나 지우지 못하고, 처리 트랜잭션이 잡은 기록의 이어받기는 그 트랜잭션이 끝날 때까지 기다린 뒤 실패한다 (Phase 2 재검수 P1) | FR-041 | example | DONE | `src/refund/refund-idempotency.repository.integration.spec.ts` |
| U305 | 고객 환불 판정 거절은 계약 코드의 도메인 오류로 거절되고(TICKET_NOT_FOUND 404, PAYMENT_NOT_COMPLETED·ALREADY_REFUNDED·REFUND_IN_PROGRESS·USED_TICKET·EXPIRED_TICKET 409) 아무것도 저장하지 않는다 | FR-001, FR-005 | example | DONE | `src/refund/refund-acceptance.service.spec.ts` |
| U306 | 도메인 오류에 details가 있으면 응답 error.details로 그대로 나간다(USED_TICKET의 violations·action 안내) | FR-005 | example | DONE | `src/common/filters/http-exception.filter.spec.ts` |
| U307 | 고객 환불 신청을 USER가 아닌 역할(OWNER·MANAGER)이 하면 아무것도 저장하지 않고 REFUND_FORBIDDEN(403)으로 거절된다 (Phase 3 검수 1) | FR-001 | example | DONE | `src/refund/refund-acceptance.service.spec.ts` |
| U308 | 같은 멱등 키 재응답도 현재 역할이 USER가 아니면 REFUND_FORBIDDEN으로 거절된다 (Phase 3 검수 1) | FR-041 | example | DONE | `src/refund/refund-acceptance.service.spec.ts` |
| U309 | 실결제액 0원 고객 환불은 PG 취소 요청 없이 이용 종료·Refund PAID·0원 원장을 함께 저장하고 PG를 호출하지 않는다 (Phase 3 검수 2) | FR-016a | example | DONE | `src/refund/refund-acceptance.integration.spec.ts`(실제 DB) |
| U310 | 0원 고객 환불 응답은 200과 지급 완료(PAID)다 (Phase 3 검수 2) | FR-016a | example | DONE | `src/refund/refund-acceptance.service.spec.ts` |
| U311 | 환불로 닫힌 정지 기록(closedAt)은 이용권·주문 조회에서 진행 중 정지로 보이지 않는다 (Phase 3 검수 3) | FR-042 | example | DONE | `test/refund-customer.e2e-spec.ts` |
| U312 | 이미 성공으로 확정된 PG 취소 요청에 실제액이 다른 성공 통보가 오면 기존 실제액·원장을 유지하고 PG_RESULT_CONFLICT·운영자 알림을 남긴다 (Phase 6 검수 1) | FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U313 | 이미 성공으로 확정된 PG 취소 요청에 거래 ID가 다른 성공 통보가 오면 PG_RESULT_CONFLICT·운영자 알림을 남긴다 (Phase 6 검수 1) | FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U314 | 지급 완료(PAID)된 환불에 모순 통보가 오면 환불은 ACTION_REQUIRED·reviewRequired·PG_RESULT_CONFLICT가 된다 (Phase 6 검수 2, 사용자 결정) | FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U315 | 이미 검토 필요인 환불은 확정 금액과 같은 성공 결과가 와도 PAID가 되지 않는다 (Phase 6 검수 2) | FR-023 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U316 | 고객 환불의 PG 거절은 고객·점주·운영자 알림을 같은 트랜잭션에 저장한다 (Phase 6 검수 3) | FR-037 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U317 | 매장 환불의 PG 거절은 점주·운영자에게 알리고 고객에게는 알리지 않는다 (Phase 6 검수 3) | FR-037 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U318 | PG 실제액 불일치는 운영자 알림을 저장한다 (Phase 6 검수 3) | FR-027 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U319 | PG 거절·금액 불일치·모순 결과는 거래 로그에 기록된다 (Phase 6 검수 3) | FR-037 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U320 | 환불 콜백의 amount가 정수가 아니면 400을 받는다 (Phase 6 검수 4) | FR-032 | example | DONE | `src/refund/dto/pg-refund-callback.dto.spec.ts` |
| U321 | 환불 콜백의 orderItemId는 null(PAYMENT 대상)을 형식상 허용한다 (Phase 6 검수 4) | FR-032 | example | DONE | `src/refund/dto/pg-refund-callback.dto.spec.ts` |
| U322 | 환불 콜백의 PG 취소 거래 ID가 원승인 거래 ID와 같으면 PG_CALLBACK_TARGET_MISMATCH(409)로 거절된다 (Phase 6 검수 4) | FR-032 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U323 | 환불 콜백의 PG 취소 거래 ID가 다른 PG 취소 요청에 이미 쓰였으면 PG_CALLBACK_TARGET_MISMATCH(409)로 거절된다 (Phase 6 검수 4) | FR-032 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U324 | 환불 콜백 결과 저장이 실패하면 503 REFUND_STORAGE_UNAVAILABLE을 받는다 (Phase 6 검수 5) | FR-032 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U325 | 기존 경로가 만든 PG 취소 요청에 orderItemId null 콜백이 오면 PG_CALLBACK_TARGET_MISMATCH(409)로 거절된다 (Phase 6 검수 4 진행 중 발견) | FR-032 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U326 | 일시적 처리 불가 도메인 오류(DomainServiceUnavailableError)는 503과 지정한 code로 응답한다 (Phase 6 검수 5, U324의 선행) | FR-032 | example | DONE | `src/common/filters/http-exception.filter.spec.ts` |
| U327 | 콜백 대상 오류(PG_CALLBACK_TARGET_NOT_FOUND)는 저장 실패로 바뀌지 않고 그대로 전달된다 (U324 과대 변환 방지) | FR-032 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U328 | (E2E) orderItemId를 생략한 콜백도 상품 대상 환불이면 PG_CALLBACK_TARGET_MISMATCH(409)로 거절되고 반영하지 않는다 (Phase 6 재검수 P1) | FR-032 | example | DONE | `test/refund-ledger.e2e-spec.ts` |
| U329 | 다른 요청과 같은 PG 취소 거래 ID가 동시에 저장돼 DB unique 위반이 나면 503이 아니라 PG_CALLBACK_TARGET_MISMATCH(409)로 거절된다 (Phase 6 재검수 P2) | FR-032 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U330 | 모순 결과 처리의 반환 상태는 처리 후 저장된 환불 상태(ACTION_REQUIRED)와 같다 (Phase 6 재검수 P2) | FR-032 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U331 | 모순 결과의 거래 로그에는 기존 결과와 새 통보의 종류·실제액·거래 ID가 함께 남는다 (Phase 6 재검수 권고) | FR-032 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U332 | 매장 환불 판정: 매장 범위에서 찾지 못한 이용권(null)은 TICKET_NOT_FOUND다 (US2 진행 중 추가, A18 단위) | FR-011 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U333 | 매장 환불 판정: 지급 완료된 확정 환불이 있으면 ALREADY_REFUNDED다 (US2 진행 중 추가, A22 단위) | FR-029 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U334 | 매장 환불 판정: 지급이 끝나지 않은 확정 환불이 있으면 REFUND_IN_PROGRESS다 (US2 진행 중 추가, A22 단위) | FR-029 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U335 | 매장 환불 판정: 결제가 SUCCESS가 아니면 PAYMENT_NOT_COMPLETED다 (US2 진행 중 추가, 고객 판정과 같은 대상 여부 규칙) | FR-011 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U336 | 다른 매장 이용권을 자기 매장 환불로 요청하면 TICKET_NOT_FOUND(404)로 거절되고 아무것도 저장하지 않는다 (US2 진행 중 추가, A18 단위) | FR-011 | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |
| U337 | 요청 매장의 현재 점주가 아닌 OWNER는 SHOP_NOT_FOUND(404)로 거절된다 (US2 진행 중 추가, 계약 §2 현재 소유 매장) | FR-050 | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |
| U338 | 매장 환불 판정 거절은 계약 오류로 응답한다: 금액 상한·전액 원칙·사유 누락은 400, 대상 여부 규칙은 409 (US2 진행 중 추가) | FR-012 | example | DONE | `src/refund/refund-store.service.spec.ts` |
| U339 | (실제 DB) 환불이 이용권을 먼저 잠근 상태에서 일반 퇴실(endSession)이 같은 세션을 종료해도 교착 없이 둘 다 끝난다: 퇴실도 Ticket → UsageSession 순서로 잠근다 (Phase 4 검수 1 P2) | 계약 §6 | example | DONE | `src/session-lifecycle/session-lifecycle.integration.spec.ts`(실제 DB) |
| U340 | 매장 환불 요청에 공백만 있는 사유를 보내면 형식 오류(400)다: 제공한 사유는 trim 후 1~500자 (Phase 4 검수 1 P2) | 계약 §4 | example | DONE | `src/refund/dto/store-refund.dto.spec.ts` |
| U341 | (실제 DB) 입실 후속 실패 처리(failSession)는 이미 종료된(환불 퇴실) 세션을 덮어쓰지 않는다 (Phase 5 검수 1 P2) | FR-042 | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |
| U342 | PG 전송 결과가 NOT_SENT이면 그 시도는 FAILED/SEND_FAILED, 환불은 ACTION_REQUIRED가 되고 알림이 저장된다 (US5 진행 중 추가, A34 단위) | FR-021 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U343 | PG 전송 결과가 즉시 REJECTED이면 그 시도는 FAILED/PG_REJECTED, 환불은 ACTION_REQUIRED다 (US5 진행 중 추가, 계약 §8) | FR-020 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U344 | PG 전송 결과가 즉시 SUCCEEDED이면 공통 결과 처리로 실제액·원장을 반영한다 (US5 진행 중 추가, 계약 §8) | FR-018 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U345 | 환불 접수 응답과 같은 키 재응답은 PG 전송 결과(예: ACTION_REQUIRED)를 반영한 같은 응답이다 (US5 진행 중 추가, 계약 §4) | FR-035 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts`(실제 DB) |
| U346 | 지급 처리 중(PENDING)·PG 방식이 아닌 환불(예: 조치 필요)의 미확정 시도는 정기 탐색에서 조회하지 않는다 (US5 진행 중 추가, 계약 §8 자동 대상) | FR-022 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U347 | 결과 확인 실패(QUERY_FAILED) 건이 PG 처리 중 응답을 받으면 일반 조회 일정(REQUESTED)으로 돌아간다 (US5 진행 중 추가, 계약 §8 정상 응답) | FR-026 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U348 | REFUND_RECOVERY_WORKER_ENABLED를 생략하면 true, 'false'면 false로 읽힌다 (US5 진행 중 추가, 사용자 결정: 테스트 환경에서 자동 작업자 끄기) | 계약 §8 운영 설정 | example | DONE | `src/config/configuration.spec.ts` |
| U349 | 자동 작업자 설정이 꺼져 있으면 기동 시 정기 탐색 스케줄을 등록하지 않는다 (US5 진행 중 추가) | FR-022 | example | DONE | `src/refund/refund-recovery.scheduler.spec.ts` |
| U350 | 정기 탐색 작업은 일반 탐색과 장애 복구 확인을 실행하고(U362에서 단언을 '복구 시각 ≥ 탐색 시각'으로 변경, 사용자 결정), 작업자 설정이 꺼져 있으면 아무것도 하지 않는다 (US5 진행 중 추가) | FR-022 | example | DONE | `src/refund/refund-recovery.processor.spec.ts` |
| U351 | 장애 복구 확인은 실행 동안 복구 제어 담당을 잡고, 다른 작업자가 처리 기한 안에서 맡고 있으면 건너뛰며, 끝나면 담당을 내려놓는다 (US5 진행 중 추가, T100 중복 실행 방지) | FR-026a | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U352 | (E2E) GET /refund/recovery/status는 MANAGER에게 {mode,running,requestedCount,queryFailedCount,actionRequiredCount,reservedManualCount,oldestQueryFailedAt,nextProbeAt}를 주고 다른 역할은 403이다 (US5 진행 중 추가, 계약 §8) | FR-026a | example | DONE | `test/refund-recovery.e2e-spec.ts` |
| U353 | 결과 확인 실패 건이 미접수 확인 뒤 재전송이 접수되면 연속 오류를 지우고 일반 조회 일정(REQUESTED)으로 복귀한다 (Phase 7a 검수 3) | FR-026 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 결과 확인 실패 건이 미접수 확인 뒤 재전송이 접수되면 연속 오류를 지우고 일반 조회 일정으로 복귀한다 |
| U354 | 개별 확인은 잠금 안에서 최근 조회 간격을 다시 확인해, 먼저 읽은 기록이 오래됐어도 간격 안이면 PG를 부르지 않는다 (Phase 7a 검수 4) | FR-055 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 개별 확인은 잠금 안에서 최근 조회 간격을 다시 확인해… |
| U355 | (실제 DB) 복구 제어 상태 변경은 현재 담당 토큰일 때만 반영된다 (Phase 7a 검수 2) | FR-026 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 복구 제어 상태 변경은 현재 담당 토큰일 때만 반영된다 |
| U356 | BATCH의 뒤쪽 건은 경과 시간을 반영한 시각으로 조회 담당을 정한다 (Phase 7a 검수 2) | FR-026 | example | DONE | `src/refund/refund-result.integration.spec.ts` › BATCH의 뒤쪽 건은 앞 건 조회에 걸린 시간을 반영한 시각으로 조회 담당을 정한다 |
| U357 | 개별 확인 재전송은 실행자·시각·개별 확인 재전송임을 거래 로그에 남긴다 (Phase 7a 검수 5) | FR-054 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 개별 확인 재전송은 실행자·시각·개별 확인 재전송임을 거래 로그에 남긴다 |
| U358 | 환불 접수 멱등 기록은 PG 전송 결과 반영 뒤 최종 응답으로 완료하고, 전송 중 같은 키는 IDEMPOTENCY_REQUEST_IN_PROGRESS, 중단 뒤에는 저장된 환불로 응답을 만든다 (Phase 7a 검수 1, 사용자 결정 A) | FR-035 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts` › PG 전송 중에 같은 키로…, 확정은 커밋됐지만 PG 전송 단계 전에 중단되면… |
| U359 | 커밋 뒤 단계가 있는 처리를 이어받으면, 이어받기 전에 읽은 기록이 아니라 이어받은 뒤의 최신 기록으로 처리 커밋 여부를 판단한다(이어받기가 기다리는 동안 처리가 커밋된 경우 재처리하지 않음) (Phase 7a 검수 2차 1) | FR-035 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` › 커밋 뒤 단계가 있는 처리 › 이어받기가 기다리는 동안 처리가 커밋됐으면… |
| U360 | 담당을 잃은 요청은 자기 최종 응답을 확정하지 않고, 이어받은 요청이 저장한 최초 응답을 돌려준다 (Phase 7a 검수 2차 2) | FR-035 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts` › PG 전송이 처리 기한을 넘겨 다른 요청이 이어받아 완료했으면… |
| U361 | 일반 정기 탐색은 건마다 경과 시간을 반영한 시각으로 조회 담당을 정한다 (Phase 7a 검수 2차 3) | FR-022 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 일반 정기 탐색의 뒤쪽 건은 앞 건 조회에 걸린 시간을 반영한 시각으로 조회 담당을 정한다 |
| U362 | 정기 탐색 작업은 장애 복구 확인을 탐색이 끝난 뒤의 현재 시각으로 시작한다 (Phase 7a 검수 2차 3, U361에서 분리) | FR-026 | example | DONE | `src/refund/refund-recovery.processor.spec.ts` › 장애 복구 확인은 탐색이 끝난 뒤의 현재 시각으로 시작한다 |
| U363 | PG 재시도는 환불이 조치 필요(ACTION_REQUIRED)일 때만 허용하고, 그 밖의 상태는 미확정 판정 뒤 REFUND_PAYOUT_NOT_ACTIONABLE로 거절한다 (US10 재요청 검수 1) | FR-044 | example | DONE | `src/refund/refund-retry.policy.spec.ts` › 조치 필요가 아닌 환불(…)은 REFUND_PAYOUT_NOT_ACTIONABLE로 거절한다 |
| U364 | PG 재시도는 SUCCEEDED·FAILED가 아닌 시도(PENDING_APPROVAL 포함)가 있으면 REFUND_PAYOUT_UNRESOLVED로 거절한다 (US10 재요청 검수 2) | FR-043 | example | DONE | `src/refund/refund-retry.policy.spec.ts` › 최종 결과가 아닌 과거 승인 대기(PENDING_APPROVAL) 시도가 있으면… |
| U365 | (실제 DB) 결제 전체 대상 환불(PAYMENT) 아래 PG 취소 요청은 주문 항목 없이 저장된다 (US6 전 사용자 결정: nullable 전환) | FR-030 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` › PaymentCancel › 결제 전체 대상 환불 아래 PG 취소 요청은 주문 항목 없이 저장된다 |
| U366 | (실제 DB) 환불에 연결된 PG 취소 요청의 주문 항목이 환불의 주문 항목과 다르면 저장이 실패한다 (data-model §4 '새 행의 연결은 Refund와 같아야 한다', 사용자 결정) | FR-030 | example | DONE | `src/prisma/refund-constraints.integration.spec.ts` › PaymentCancel › 환불에 연결된 PG 취소 요청의 주문 항목이 환불의 주문 항목과 다르면 저장이 실패한다 |
| U367 | 결제 전체 대상 환불(PAYMENT)도 MANAGER 재시도로 대상 상품 없는 새 PG 취소 요청을 만든다 (U365 결정에 따른 재시도 경로 정리) | FR-044 | example | DONE | `src/refund/refund-result.integration.spec.ts` › MANAGER의 PG 직접 재시도 › 결제 전체 대상 환불도 재시도하면 대상 상품 없는 새 PG 취소 요청을 만든다 |
| U368 | 승인 금액 불일치 콜백은 예외 없이 수신 확인(200)으로 끝난다 (계약 §7 '콜백은 200 수신 확인', 기존 payment spec 단언 변경 — 사용자 결정) | FR-030 | example | DONE | `src/payment/payment.service.spec.ts` › 승인 금액이 다르면 선점을 PAYMENT_FAILED로 해제하고 콜백은 수신 확인으로 끝난다 |
| U369 | 시스템 자동 취소(SYSTEM) 환불의 PG 취소 요청 실패·조치 필요 알림은 운영자(MANAGER)에게만 저장한다 (계약 §9, US6 검수 2) | FR-028 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 시스템 자동 취소 환불의 PG 거절은 운영자에게만 알린다; QS-5-12 수신자 확인 |
| U370 | 결제 승인 콜백의 금액이 원 단위 정수가 아니면 형식 오류(400)다 (US6 검수 3) | FR-030 | example | DONE | `src/payment/dto/pg-callback.dto.spec.ts` › 승인 금액이 원 단위 정수가 아니면(1000.5) 형식 오류(400)다 |
| U371 | 결제 승인 콜백은 200으로 수신 확인한다 (계약 §2·§7, US6 검수 1, 기존 E2E 기대값 변경 — 사용자 결정) | FR-030 | example | DONE | `test/refund-payment-mismatch.e2e-spec.ts` 등 결제 콜백 `.expect(200)` |
| U372 | 환불에 속하지 않는 별도 지급 예약 ID로 결과 등록·미지급 확인을 요청하면 404 MANUAL_PAYOUT_NOT_FOUND다 (계약 §10, US10 진행 중 추가) | FR-046 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 환불에 속하지 않는 별도 지급 예약 ID로 결과를 등록하면… |
| U373 | 이미 실패로 종료된 예약의 결과 등록은 409 MANUAL_PAYOUT_STATE_CONFLICT다 (계약 §10, US10 진행 중 추가) | FR-046 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 이미 실패로 종료된 예약의 결과 등록은… |
| U374 | 결과 등록 금액이 예약 금액과 다르면 400 REFUND_OUTSTANDING_AMOUNT_MISMATCH다 (계약 §5 '예약과 같은 금액', US10 진행 중 추가) | FR-046 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 결과 등록 금액이 예약 금액과 다르면… |
| U375 | 예약 뒤 PG 결과 모순(PG_RESULT_CONFLICT)이 생긴 환불은 별도 지급 결과를 등록해도 지급액·원장만 반영하고 모순 표시·검토 필요·조치 필요를 유지한다 (US10 외부 지급 검수 1) | FR-046 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 예약 뒤 PG 결과 모순이 생긴 환불은… |
| U376 | 별도 지급 결과 등록의 지급 시각이 ISO 시각 문자열이 아니면(숫자·불리언) 형식 오류(400)다 (US10 외부 지급 검수 2) | FR-046 | example | DONE | `src/refund/dto/confirm-manual-refund-payout.dto.spec.ts` › 실제 지급 시각이 ISO 시각 문자열이 아니면(0/false)… |
| U377 | 장기 미확인 알림은 저장 직전에 예약을 잠그고 다시 확인해 이미 지급 결과가 등록된 예약에는 알리지 않는다 (US10 외부 지급 검수 3) | FR-037 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 장기 미확인 알림을 저장하기 직전에 지급 결과가 등록됐으면… |
| U378 | 새 장기 미확인 알림이 저장되면 거래 로그도 한 번 남긴다 (FR-037, US10 외부 지급 검수 4) | FR-037 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 새 장기 미확인 알림을 저장하면 거래 로그를 한 번 남기고… |
| U379 | 별도 지급 결과 등록의 지급 시각은 날짜·시각·명시적 시간대가 모두 있어야 하며 날짜만 있거나 시간대가 없으면 형식 오류(400)다 (계약 'UTC ISO 시각', US10 외부 지급 검수 2차) | FR-046 | example | DONE | `src/refund/dto/confirm-manual-refund-payout.dto.spec.ts` › 실제 지급 시각에 시각이나 시간대가 없으면…, 시간대가 붙은 지급 시각(+09:00)은… |
| U380 | 서명 시각이 십진 Unix 초가 아니면(그 값으로 서명했더라도) PG_CALLBACK_UNAUTHORIZED로 거절된다 (계약 §7 '십진 Unix 초'·'잘못된 형식은 인증 실패', US7 진행 중 추가) | FR-032 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › 서명 시각이 십진 Unix 초가 아니면… |
| U381 | Content-Type이 application/json이 아닌 콜백은 서명이 맞아도 PG_CALLBACK_FORMAT_INVALID로 거절된다(charset 매개변수는 허용) (계약 §7, US7 검수 1) | FR-032 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › Content-Type이 application/json이 아니면… |

### `src/refund/refund-idempotency.service.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U35 | 같은 Idempotency-Key·같은 본문의 재요청은 최초 응답을 그대로 받는다 | FR-041, QS-10-1c | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U36 | 같은 키·다른 본문의 요청은 409 IDEMPOTENCY_KEY_REUSED로 거절된다 | QS-10-1c | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U37 | 최초 요청이 처리 중일 때 같은 키 요청은 409 IDEMPOTENCY_REQUEST_IN_PROGRESS로 거절된다 | FR-041 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U38 | 같은 키 재요청 시점에 권한이 없으면 최초 응답 대신 403 REFUND_FORBIDDEN을 받는다 | QS-10-1d | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U39 | Redis의 키가 만료된 뒤에도 같은 키 재요청은 DB 기록의 최초 응답을 받는다 | FR-041 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U40 | 동의 누락으로 거절된 요청의 키는 동의를 포함한 이후 요청의 처리를 막지 않는다 | FR-040 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U41 | 128자 ASCII 키는 허용된다 | FR-041 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U42 | 129자 키는 거절된다 | FR-041 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U43 | 공백이 들어간 키는 거절된다 | FR-041 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |
| U44 | 사유의 앞뒤 공백만 다른 본문은 같은 본문으로 판단되어 최초 응답을 받는다 | FR-041 | example | DONE | `src/refund/refund-idempotency.service.spec.ts` |

### `src/common/filters/http-exception.filter.ts, src/refund/refund-access.service.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U45 | 도메인 오류에 지정한 code가 응답 error.code로 그대로 나간다 | FR-005 | example | DONE | `src/common/filters/http-exception.filter.spec.ts` |
| U46 | code가 없는 도메인 오류는 오류 클래스 이름이 error.code로 나간다 | FR-005 | example | DONE | `src/common/filters/http-exception.filter.spec.ts` |
| U47 | 고객 역할이 점주 전용 경로를 호출하면 403 REFUND_FORBIDDEN을 받는다 | QS-2-7a | example | DONE | `src/refund/refund-access.service.spec.ts` |
| U48 | 점주가 소유하지 않은 매장 범위를 조회하면 404를 받는다 | FR-011, FR-033 | example | DONE | `src/refund/refund-access.service.spec.ts` |
| U49 | 점주 관계가 해제된 뒤 같은 매장 범위를 조회하면 404를 받는다 | FR-033 | example | DONE | `src/refund/refund-access.service.spec.ts` |

### `src/pg/pg.service.ts, src/pg/pg.types.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U50 | (현재 동작 기록) PG 거래조회는 지금 어떤 입력이든 NOT_FOUND를 반환한다 | FR-024 | characterization | BASELINE | `src/pg/pg.service.spec.ts` › 현재 동작 기록(특성화) |
| U51 | 일반 HTTP 404 응답은 NOT_FOUND가 아니라 QUERY_ERROR로 분류된다 | FR-024 | example | DONE | `src/pg/pg.service.spec.ts` |
| U52 | authoritative=true인 미접수 응답만 NOT_FOUND로 분류된다 | FR-024 | example | DONE | `src/pg/pg.service.spec.ts` |
| U53 | 조회 응답이 제한 시간을 넘으면 QUERY_ERROR로 분류된다 | FR-025 | example | DONE | `src/pg/pg.service.spec.ts` |
| U54 | PG 인증 오류 응답은 QUERY_ERROR로 분류된다 | FR-025 | example | DONE | `src/pg/pg.service.spec.ts` |
| U55 | 성공 응답에 실제 취소 금액이 없으면 QUERY_ERROR로 분류된다 | FR-027 | example | DONE | `src/pg/pg.service.spec.ts` |
| U56 | PG 미연동 상태의 취소 전송 결과는 NOT_SENT다 | FR-021 | example | DONE | `src/pg/pg.service.spec.ts` |
| U57 | PG 미연동 상태의 조회 결과는 QUERY_ERROR다 | FR-025 | example | DONE | `src/pg/pg.service.spec.ts` |
| U58 | 취소 전송 응답이 제한 시간을 넘으면 UNKNOWN이다 | FR-022 | example | DONE | `src/pg/pg.service.spec.ts` |

### `src/refund/refund-locking.repository.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U59 | 환불 확정 잠금은 Payment → Ticket → TicketPause → UsageSession → SeatAssignment 순서로 실행된다 | FR-041 | example | DONE | `src/refund/refund-locking.repository.spec.ts` |
| U60 | 같은 종류의 행 여러 개는 ID 오름차순으로 잠긴다 | FR-041 | example | DONE | `src/refund/refund-locking.repository.spec.ts` |
| U61 | 지급 경로 잠금은 Refund → PaymentCancel → ManualRefundPayout 순서로 실행된다 | FR-043 | example | DONE | `src/refund/refund-locking.repository.spec.ts` |

### `src/refund/refund-policy.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U62 | 본인 소유 범위 밖 이용권은 TICKET_NOT_FOUND로 판정된다 | FR-001 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U63 | 결제가 SUCCESS가 아니면 PAYMENT_NOT_COMPLETED로 판정된다 | FR-001 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U64 | 결제 미완료와 사용 이력이 함께 있으면 PAYMENT_NOT_COMPLETED가 먼저 판정된다 | FR-001 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U65 | 지급 완료(PAID) 환불이 있으면 ALREADY_REFUNDED로 판정된다 | FR-002 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U66 | 확정됐지만 미지급인 환불이 있으면 REFUND_IN_PROGRESS로 판정된다 | FR-002 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U67 | 미지급 확정 환불과 사용 이력이 함께 있으면 REFUND_IN_PROGRESS가 먼저 판정된다 | FR-001, QS-1-9 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U68 | 이용 중인 이용권은 USED_TICKET으로 판정된다 | FR-003 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U69 | 활성화 전 정기권은 미사용으로 판정된다 | FR-003 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U70 | 활성화된 정기권은 USED_TICKET으로 판정된다 | FR-003 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U71 | 남은 시간이 구매 시간과 같은 시간권은 미사용으로 판정된다 | FR-003 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U72 | 남은 시간이 구매 시간보다 1분 적은 시간권은 USED_TICKET으로 판정된다 | FR-003 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U73 | 사용 이력과 기한 초과가 함께 있으면 USED_TICKET이 먼저 판정된다 | FR-001 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U74 | 신청 시각이 정기권 활성화 기한과 같으면 기한 안으로 허용된다 | FR-004 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U75 | 신청 시각이 정기권 활성화 기한보다 1ms 늦으면 EXPIRED_TICKET으로 판정된다 | FR-004 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U76 | 신청 시각이 시간권 소진 기한과 같으면 기한 안으로 허용된다 | FR-004 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U77 | 신청 시각이 시간권 소진 기한보다 1ms 늦으면 EXPIRED_TICKET으로 판정된다 | FR-004 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U78 | 가능 조건 거절 결과에 매장 문의 안내(CONTACT_SHOP)와 위반 사유 목록이 담긴다 | FR-005 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U79 | 미사용·기한 안 이용권의 고객 환불 금액은 실결제액 전액으로 정해진다 | FR-006 | example | DONE | `src/refund/refund-policy.spec.ts` |

### `src/refund/dto/refund.dto.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U80 | ticketId가 UUID 형식이 아니면 400을 받는다 | FR-001 | example | DONE | `src/refund/dto/refund.dto.spec.ts` |
| U81 | 본문에 amount를 넣으면 미허용 필드로 400을 받는다 | FR-006 | example | DONE | `src/refund/dto/refund.dto.spec.ts` |
| U82 | 본문에 userId를 넣으면 미허용 필드로 400을 받는다 | FR-001 | example | DONE | `src/refund/dto/refund.dto.spec.ts` |
| U83 | 본문에 shopId를 넣으면 미허용 필드로 400을 받는다 | FR-001 | example | DONE | `src/refund/dto/refund.dto.spec.ts` |
| U84 | 종료 동의가 false이면 REFUND_TERMINATION_CONSENT_REQUIRED로 거절된다 | FR-040 | example | DONE | `src/refund/refund-acceptance.service.spec.ts` |
| U85 | 종료 동의 필드가 없으면 REFUND_TERMINATION_CONSENT_REQUIRED로 거절된다 | FR-040 | example | DONE | `src/refund/refund-acceptance.service.spec.ts` |
| U86 | 종료 동의가 문자열 "true"이면 형식 오류 400을 받는다 | FR-040 | example | DONE | `src/refund/dto/refund.dto.spec.ts` |

### `src/refund/refund-acceptance.service.ts, src/refund/refund.service.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U87 | 환불 확정 뒤 이용권 상태가 REVOKED로 저장된다 | FR-041 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts`(실제 DB) |
| U88 | 환불 확정 뒤 고정석 배정이 해제된다 | FR-041 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts`(실제 DB) |
| U89 | 환불 확정 뒤 진행 중이던 정지 기록이 closeReason=REFUND_TERMINATED로 닫히고 재개되지 않는다 | FR-042 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts`(실제 DB) |
| U90 | 환불 확정 뒤 정기권 만료 시각이 늘어나지 않는다 | FR-042 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts`(실제 DB) |
| U91 | 환불 확정 시 Refund ACCEPTED와 확정된 환불 금액의 최초 PG 취소 요청 REQUESTED가 저장된다 | FR-041 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts`(실제 DB) |
| U92 | 저장 마지막 단계가 실패하면 이용권·좌석·정지·환불·PG 취소 요청이 모두 저장 전 상태로 남는다 | FR-041 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts`(실제 DB) |
| U93 | PG 전송은 확정 트랜잭션이 커밋된 뒤에만 호출된다 | FR-041 | example | DONE | `src/refund/refund-acceptance.service.spec.ts` |
| U94 | 확정 트랜잭션 커밋이 실패하면 PG가 호출되지 않는다 | FR-041 | example | DONE | `src/refund/refund-acceptance.service.spec.ts` |
| U95 | 같은 이용권의 동시 신청 두 건 중 한 건만 확정되고 다른 한 건은 REFUND_IN_PROGRESS를 받는다 | FR-029 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts`(실제 DB) |
| U96 | PG 전송 결과가 NOT_SENT여도 이용권은 REVOKED로 남는다 | FR-016 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts`(실제 DB) |
| U97 | 양수 금액 접수 응답은 202와 환불 식별자·이용 종료 완료·지급 처리 중 상태를 담는다 | FR-035 | example | DONE | `src/refund/refund-acceptance.service.spec.ts` |

### `src/refund/refund-store.service.ts, src/refund/dto/store-refund.dto.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U98 | 사용 이력이 있는 이용권의 매장 환불 금액 0원은 허용된다 | FR-012 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U99 | 사용 이력이 있는 이용권의 매장 환불 금액이 실결제액과 같으면 허용된다 | FR-012 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U100 | 매장 환불 금액이 실결제액보다 1원 많으면 REFUND_AMOUNT_EXCEEDED로 거절된다 | FR-012 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U101 | 매장 환불 금액이 -1이면 400을 받는다 | FR-012 | example | DONE | `src/refund/dto/store-refund.dto.spec.ts` |
| U102 | 매장 환불 금액이 소수이면 400을 받는다 | FR-012 | example | DONE | `src/refund/dto/store-refund.dto.spec.ts` |
| U103 | 사용 이력이 있는 이용권에 사유가 없으면 REFUND_REASON_REQUIRED로 거절된다 | FR-012 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U104 | 공백만 있는 사유는 사유 누락으로 처리된다 | FR-012 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U105 | trim 후 500자 사유는 허용된다 | FR-013 | example | DONE | `src/refund/dto/store-refund.dto.spec.ts` |
| U106 | trim 후 501자 사유는 400을 받는다 | FR-013 | example | DONE | `src/refund/dto/store-refund.dto.spec.ts` |
| U107 | 기한 안 미사용 이용권에 실결제액보다 1원 적은 금액이면 UNUSED_TICKET_FULL_REFUND_REQUIRED로 거절된다 | FR-010 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U108 | 기한 안 미사용 이용권은 전액·사유 없음으로 확정된다 | FR-010 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U109 | 기한이 지난 미사용 이용권에 사유가 없으면 REFUND_REASON_REQUIRED로 거절된다 | FR-012 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U110 | 기한이 지난 미사용 이용권은 실결제액보다 적은 입력 금액으로 확정된다 | FR-012 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U111 | 남은 시간이 0인 시간권도 매장 환불로 확정된다 | FR-008 | example | DONE | `src/refund/refund-policy.spec.ts` |
| U112 | 이용 중인 이용권에 퇴실 동의가 없으면 TICKET_IN_USE로 거절된다 | FR-014 | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |
| U113 | 금액 오류로 거절되면 이용 중 세션은 퇴실되지 않은 채 남는다 | FR-015 | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |
| U114 | MANAGER가 새 매장 환불을 요청하면 REFUND_FORBIDDEN으로 거절된다 | FR-050 | example | DONE | `src/refund/refund-store.service.spec.ts` |
| U115 | 매장 환불 확정 시 점주·확정 시각·사유·금액·동의가 저장된다 | FR-013 | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |
| U116 | 0원 매장 환불은 PG 취소 요청 기록을 만들지 않는다 | FR-016a | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |
| U117 | 0원 매장 환불은 Refund PAID와 0원 원장 1건을 같은 트랜잭션에 저장한다 | FR-016a | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |
| U118 | 0원 매장 환불 응답은 200과 지급 완료 상태다 | FR-035 | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |

### `src/session-lifecycle/session-lifecycle.service.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U119 | 이용 중 시간권을 매장 환불하면 퇴실 시각까지의 사용 시간만 차감된다 | FR-015 | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |
| U120 | 동의 사이에 이미 퇴실한 세션은 사용 시간을 다시 차감하지 않는다 | FR-015 | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |
| U121 | 커밋 뒤 세션 종료 작업 제거가 실패해도 이용권·좌석 배정이 복구되지 않는다 | FR-016 | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |

### `src/usage-session/usage-session.service.ts, src/ticket/ticket-pause/ticket-pause.service.ts, src/ticket/ticket-seat/ticket-seat.service.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U122 | REVOKED 이용권의 입실은 TICKET_TERMINATED로 거절된다 | FR-017 | example | DONE | `src/usage-session/usage-session.service.spec.ts` |
| U123 | 지급 상태가 ACTION_REQUIRED인 REVOKED 이용권의 입실도 TICKET_TERMINATED로 거절된다 | FR-017 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts`(실제 DB) |
| U124 | REVOKED 이용권의 정지 재개는 TICKET_TERMINATED로 거절된다 | FR-017 | example | DONE | `src/ticket/ticket-pause/ticket-pause.service.spec.ts` |
| U125 | REVOKED 이용권의 좌석 타입 변경은 TICKET_TERMINATED로 거절된다 | FR-017 | example | DONE | `src/ticket/ticket-seat/ticket-seat.service.spec.ts` |
| U126 | 입실이 먼저 이용권 잠금을 얻으면 뒤이은 고객 환불은 USED_TICKET으로 거절된다 | FR-003 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts`(실제 DB) |
| U127 | 환불 뒤 도착한 자동 종료 작업은 세션 종료 상태를 덮어쓰지 않는다 | FR-042 | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |
| U128 | 환불 뒤 도착한 자동 종료 작업은 사용 시간을 다시 차감하지 않는다 | FR-042 | example | DONE | `src/refund/refund-store.integration.spec.ts`(실제 DB) |

### `src/refund/refund-result.service.ts, src/ledger/refund-ledger.repository.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U129 | PG 성공 실제액이 확정된 환불 금액과 같으면 Refund가 PAID가 된다 | FR-023 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U130 | PG 성공 시 실제액의 음수 원장 1건이 원래 shopId·orderId·RELEASABLE로 같은 트랜잭션에 저장된다 | FR-018 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U131 | PG 실제액이 확정 금액보다 적으면 ACTION_REQUIRED와 부족액이 기록되고 확정 금액은 그대로다 | FR-027 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U132 | PG 실제액이 확정 금액보다 많으면 ACTION_REQUIRED와 초과액이 기록되고 확정 금액은 그대로다 | FR-027 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U133 | PG 거절이면 그 PG 취소 요청은 FAILED, Refund는 ACTION_REQUIRED가 되고 원장은 생기지 않는다 | FR-023, FR-020 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U134 | 같은 성공 결과를 두 번 반영해도 원장과 paidAmount는 한 번만 늘어난다 | FR-019 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U135 | 이미 FAILED인 PG 취소 요청에 성공 통보가 오면 검토 필요와 운영자 알림을 기록하고 지급액을 더하지 않는다 | FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U136 | 담당 토큰이 바뀐 작업의 결과 저장은 지급액을 더하지 않고 저장된 상태를 반환한다 | FR-055 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U137 | 결과 저장 중 중단되면 PAID·원장 어느 것도 저장되지 않는다 | FR-018 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U138 | 콜백의 PG 취소 요청이 없으면 404 PG_CALLBACK_TARGET_NOT_FOUND를 받는다 | FR-032 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U139 | 콜백의 PG 취소 요청이 다른 환불에 속하면 409 PG_CALLBACK_TARGET_MISMATCH를 받는다 | FR-032 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |

### `src/refund/refund-dispatch.service.ts, src/refund/refund-sweep.service.ts, src/refund/refund-recovery.service.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U140 | 응답 없는 PG 취소 요청은 전송 60초 뒤 첫 조회가 예정된다 | FR-022 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U141 | 전송 59초 시점에는 조회하지 않는다 | FR-022 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U142 | authoritative NOT_FOUND이고 자동 재전송 횟수가 한도보다 1 적으면 같은 ID·금액으로 재전송하고 횟수가 1 늘어난다 | FR-024 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U143 | 자동 재전송 횟수가 한도와 같고 NOT_FOUND이면 FAILED/RETRY_EXHAUSTED·ACTION_REQUIRED·운영자 알림이 함께 기록된다 | FR-024 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U144 | 한도 소진 뒤 IN_PROGRESS이면 실패로 끝내지 않고 다시 조회가 예정된다 | FR-024 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U145 | 한도 소진 뒤 QUERY_ERROR이면 실패로 끝내지 않고 다시 조회가 예정된다 | FR-024 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U146 | 최초 전송과 개별 확인 재전송은 자동 재전송 횟수에 더해지지 않는다 | FR-024 | example | DONE | `src/refund/refund-acceptance.integration.spec.ts`(실제 DB) |
| U147 | FAILED PG 취소 요청은 자동 조회·재전송 대상에서 빠지고 예정 시각과 담당이 지워진다 | FR-024 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U148 | 활성 별도 지급 예약이 있는 환불은 자동 조회·재전송 대상에서 빠진다 | FR-043 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U149 | 첫 조회 오류 뒤 다음 조회 간격은 15초다 | FR-025 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U150 | 계산 간격이 상한을 넘으면 상한 간격으로 조회가 예정된다 | FR-025 | example | DONE | `src/refund/refund-recovery.policy.spec.ts` |
| U151 | 연속 조회 오류 4회에서는 REQUESTED가 유지된다 | FR-025 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U152 | 연속 조회 오류 5회에서 QUERY_FAILED와 운영자 알림이 기록된다 | FR-025 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U153 | IN_PROGRESS 응답은 연속 조회 오류 횟수를 0으로 되돌린다 | FR-025 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U154 | PROBE 모드는 900초마다 가장 오래된 QUERY_FAILED 1건만 조회한다 | FR-026 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U155 | PROBE 조회가 정상 응답이면 BATCH 모드로 바뀌어 20건씩 조회한다 | FR-026 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U156 | BATCH 조회 중 오류가 다시 나면 PROBE 모드로 돌아간다 | FR-026 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U157 | 서버 기동 시 DB의 다음 조회 예정 시각으로 조회 일정이 복원된다 | FR-022 | example | DONE | `src/refund/refund-recovery.scheduler.spec.ts` |
| U158 | 커밋 뒤 전송 전 중단된 PG 취소 요청은 재기동 후 전송이 아니라 조회부터 처리된다 | FR-022 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U159 | 전체 재확인 요청은 실행 중이면 ALREADY_RUNNING을 받는다 | FR-026a | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U160 | 전체 재확인 요청은 대상이 없으면 NO_WORK를 받는다 | FR-026a | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U161 | 전체 재확인 요청은 대상이 있으면 202 SCHEDULED를 받는다 | FR-026a | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |

### `src/refund/refund-pg-check.service.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U162 | 같은 환불의 유효한 담당이 있으면 ALREADY_RUNNING을 받고 PG는 호출되지 않는다 | FR-055 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U163 | 최근 조회 후 14초에 요청하면 RECENT_RESULT를 받고 PG는 호출되지 않는다 | FR-055 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U164 | 최근 조회 후 15초에 요청하면 PG 조회가 실행된다 | FR-055 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U165 | 지급 완료·0원·활성 예약·금액 검토·MANUAL 환불은 NO_PENDING_ATTEMPT를 받고 PG는 호출되지 않는다 | FR-056 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U166 | 자동 재전송 한도를 소진한 미확정 요청도 NOT_FOUND이면 기존 ID·금액으로 즉시 재전송된다 | FR-054 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U167 | 개별 확인 재전송은 manualResendCount만 늘리고 resendCount는 그대로 둔다 | FR-054 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U168 | 미확정 요청 조회가 IN_PROGRESS 또는 QUERY_ERROR이면 재전송하지 않는다 | FR-054 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U169 | 미확정 요청 조회에서 새로 확인한 거절은 실패·조치 필요만 기록하고 새 PG 취소 요청을 만들지 않는다 | FR-054 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U170 | 개별 확인은 다른 환불의 상태와 RefundRecoveryControl을 바꾸지 않는다 | FR-054 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U171 | PG_RESULT_CONFLICT가 기록된 환불은 재전송 없이 저장 상태를 받는다 | FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts`(실제 DB) |
| U172 | pg-check 본문에 금액 필드가 있으면 400을 받는다 | FR-052 | example | DONE | `test/refund-recovery.e2e-spec.ts` |

### `src/payment/payment.service.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U173 | 승인 금액이 요청 금액과 다르면 결제가 FAILED가 된다 | FR-030 | example | DONE | `src/payment/payment.service.spec.ts` › 승인 금액이 다르면 같은 트랜잭션에서 실제 승인액을 보존하고…(failApprovalMismatch) 및 `test/refund-payment-mismatch.e2e-spec.ts` › … (QS-6-1) 결제 FAILED |
| U174 | 승인 금액이 요청 금액과 다르면 이용권이 발행되지 않는다 | FR-030 | example | DONE | `src/payment/payment.service.spec.ts` › 승인 금액이 다르면 이용권을 발행하지 않는다 |
| U175 | 승인 금액이 요청 금액과 다르면 좌석 선점이 해제된다 | FR-030 | example | DONE | `src/payment/payment.service.spec.ts` › 승인 금액이 다르면 선점을 PAYMENT_FAILED로 해제하고 콜백은 수신 확인으로 끝난다 |
| U176 | 승인 금액 불일치 시 approvedAmount와 승인액 전액의 SYSTEM·PAYMENT 대상 환불·최초 PG 취소 요청이 저장된다 | FR-030 | example | DONE | `src/payment/payment.service.spec.ts` › 승인 금액이 다르면 같은 트랜잭션에서 실제 승인액을 보존하고…(저장 결과는 QS-6-1 E2E) |
| U177 | 승인 금액이 요청 금액과 같으면 기존대로 이용권이 발행된다 | QS-6-4 | example | DONE | `src/payment/payment.service.spec.ts` › 승인 성공 시 이용권 좌석 타입은 주문 항목 스냅샷을 따른다 등 기존 승인 테스트(기존 발행 흐름 유지) |
| U178 | 같은 승인 불일치 콜백이 반복돼도 SYSTEM 환불은 1건이다 | FR-030 | example | DONE | `src/payment/payment.service.spec.ts` › 이미 반영한 같은 승인 금액 불일치 콜백이 다시 오면 예외 없이 끝나고 시스템 환불을 다시 만들지 않는다(동시 콜백은 결제 잠금 뒤 재확인) |
| U179 | 좌석 배정 실패 결제는 주문 항목 대상 SYSTEM 환불로 지급을 시작한다 | FR-028 | example | DONE | `src/payment/payment.service.spec.ts` › 좌석을 확정하지 못한 이용권은 승인과 같은 트랜잭션에서 상품 대상 시스템 환불로 확정하고…, 좌석 배정 실패 환불의 PG 전송이 커밋 뒤 예외를 던져도…; `test/seat-type.e2e-spec.ts` QS-31(새 계약 단언, 사용자 결정) |
| U180 | 자동 취소 PG 성공 뒤에도 결제는 FAILED로 남는다 | FR-030 | example | DONE | `test/refund-payment-mismatch.e2e-spec.ts` › … (QS-6-2) 결제 FAILED 유지 |
| U181 | 자동 취소 저장 중 중단되면 결제·이용권·환불 어느 것도 바뀌지 않는다 | FR-030 | example | DONE | `test/refund-payment-mismatch.e2e-spec.ts` › 자동 취소 환불 저장 중 오류로 중단되면 결제·좌석 선점·환불 어느 것도 바뀌지 않는다 |

### `src/refund/refund-retry.service.ts, src/refund/refund-operations.service.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U182 | MANAGER 재시도는 확정 실패·실제 지급액 0원·다른 지급 없음이면 같은 금액의 새 PG 취소 요청을 만들고 이전 FAILED 기록을 그대로 둔다 | FR-044 | example | DONE | `src/refund/refund-result.integration.spec.ts` › MANAGER의 PG 직접 재시도 › 확정 실패·지급액 0원이면 같은 금액의 새 PG 취소 요청을 만들어 보내고… |
| U183 | 재시도로 만든 새 PG 취소 요청의 자동 재전송 횟수는 0이다 | FR-044, FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts` › MANAGER의 PG 직접 재시도 › 한도를 소진해 실패한 요청을 재시도한 새 요청의 자동 재전송 횟수는 0이고… |
| U184 | 미확정 PG 취소 요청이 있으면 재시도는 REFUND_PAYOUT_UNRESOLVED로 거절된다 | FR-043 | example | DONE | `src/refund/refund-retry.policy.spec.ts` › 미확정 PG 취소 요청이 있으면 REFUND_PAYOUT_UNRESOLVED로 거절한다 |
| U185 | 활성 별도 지급 예약이 있으면 재시도는 REFUND_PAYOUT_UNRESOLVED로 거절된다 | FR-043 | example | DONE | `src/refund/refund-retry.policy.spec.ts` › 활성 별도 환불금 지급 예약이 있으면 REFUND_PAYOUT_UNRESOLVED로 거절한다 |
| U186 | 유효한 개별 조회 담당이 있으면 재시도는 REFUND_PAYOUT_UNRESOLVED로 거절된다 | FR-055 | example | DONE | `src/refund/refund-retry.policy.spec.ts` › 실패한 요청에 유효한 개별 조회 담당이 있으면… |
| U187 | PG_RESULT_CONFLICT가 있으면 재시도는 REFUND_PAYOUT_UNRESOLVED로 거절된다 | FR-057 | example | DONE | `src/refund/refund-retry.policy.spec.ts` › PG 결과 모순(PG_RESULT_CONFLICT)이 기록돼 있으면… |
| U188 | 실제 지급액이 있고 미지급액이 남으면 재시도는 REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL로 거절된다 | FR-048 | example | DONE | `src/refund/refund-retry.policy.spec.ts` › 실제 지급액이 있고 미지급액이 남으면… |
| U189 | 지급 완료 환불의 재시도는 REFUND_PAYOUT_NOT_ACTIONABLE로 거절된다 | FR-044 | example | DONE | `src/refund/refund-retry.policy.spec.ts` › 지급 완료 환불은 REFUND_PAYOUT_NOT_ACTIONABLE로 거절한다 외 1 |
| U190 | 재시도 사유가 trim 후 0자이면 400을 받는다 | FR-044 | example | DONE | `src/refund/dto/retry-refund.dto.spec.ts` › 앞뒤 공백을 지운 재시도 사유가 0자이면 형식 오류(400)다 |
| U191 | 재시도 사유가 trim 후 500자이면 허용된다 | FR-044 | example | DONE | `src/refund/dto/retry-refund.dto.spec.ts` › 앞뒤 공백을 지운 재시도 사유가 500자이면 허용된다 |
| U192 | 재시도 사유가 trim 후 501자이면 400을 받는다 | FR-044 | example | DONE | `src/refund/dto/retry-refund.dto.spec.ts` › 앞뒤 공백을 지운 재시도 사유가 501자이면 형식 오류(400)다 |
| U193 | 재시도에 Idempotency-Key가 없으면 IDEMPOTENCY_KEY_REQUIRED로 거절된다 | FR-044 | example | DONE | `test/refund-operations.e2e-spec.ts` › 운영자의 PG 직접 재시도에 Idempotency-Key가 없으면 400… |
| U194 | OWNER의 재시도는 403 REFUND_FORBIDDEN으로 거절된다 | FR-050 | example | DONE | `test/refund-operations.e2e-spec.ts` › 점주의 PG 직접 재시도는 403 REFUND_FORBIDDEN으로… |
| U195 | RETRY_EXHAUSTED로 FAILED인 요청을 개별 확인해 NOT_FOUND이면 새 PG 취소 요청을 즉시 보낸다 | FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 실패가 확정된 요청의 개별 확인 › 한도 소진으로 실패한 요청을 개별 확인해 PG 미접수가 확인되면… |
| U196 | SEND_FAILED로 FAILED인 요청을 개별 확인해 NOT_FOUND이면 새 PG 취소 요청을 즉시 보낸다 | FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 실패가 확정된 요청의 개별 확인 › 전송 전 실패로 실패한 요청을 개별 확인해 PG 미접수가 확인되면… |
| U197 | PG_REJECTED로 FAILED인 요청을 개별 확인해 거절 확정이면 새 PG 취소 요청을 즉시 보낸다 | FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 실패가 확정된 요청의 개별 확인 › PG 거절로 실패한 요청을 개별 확인해 거절 확정이면… |
| U198 | 세 사유 외의 확정 실패는 NO_PENDING_ATTEMPT를 받고 PG는 호출되지 않는다 | FR-056 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 실패가 확정된 요청의 개별 확인 › 세 사유 외의 확정 실패(과거 구현의 PG 미도달)는 NO_PENDING_ATTEMPT… |
| U199 | FAILED 요청 재조회가 QUERY_ERROR이면 새 요청을 만들지 않고 기존 실패 이력을 유지한다 | FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 실패가 확정된 요청의 개별 확인 › 실패한 요청의 재조회가 조회 오류이면… |
| U200 | FAILED 요청 재조회가 SUCCEEDED이면 PG_RESULT_CONFLICT와 운영자 알림을 기록하고 새 요청을 만들지 않는다 | FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 실패가 확정된 요청의 개별 확인 › 실패한 요청의 재조회가 취소 성공이면… |
| U201 | FAILED 요청 재조회가 IN_PROGRESS이면 PG_RESULT_CONFLICT와 운영자 알림을 기록하고 새 요청을 만들지 않는다 | FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 실패가 확정된 요청의 개별 확인 › 실패한 요청의 재조회가 처리 중이면… |
| U202 | 오류 문자열만 있어 실행 여부가 불명확한 거절은 거절 확정으로 보지 않아 새 요청을 만들지 않는다 | FR-057 | example | DONE | `src/pg/pg.service.spec.ts` › 실패 상태 없이 오류 문자열만 있는 조회 응답은 거절 확정이 아니라 QUERY_ERROR로 분류된다 (서비스 처리는 U199) |
| U203 | 지급 방식이 MANUAL인 환불은 개별 확인으로 새 요청을 만들지 않는다 | FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 실패가 확정된 요청의 개별 확인 › 지급 방식이 별도 지급(MANUAL)인 환불은… |
| U204 | 개별 확인으로 만든 새 요청은 lastInquiryAt을 승계하고 개별 확인 재시도임을 기록한다 | FR-057 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 실패가 확정된 요청의 개별 확인 › 개별 확인으로 만든 새 요청은 실패한 요청의 최근 조회 시각을 승계하고… |
| U205 | 별도 지급 예약은 미지급액과 같은 금액을 RESERVED·MANUAL로 저장한다 | FR-045 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 별도 지급 예약은 미지급액과 같은 금액을 RESERVED로 저장하고… |
| U206 | 예약 금액이 미지급액과 다르면 REFUND_OUTSTANDING_AMOUNT_MISMATCH로 거절된다 | FR-045 | example | DONE | `src/refund/refund-manual-payout.policy.spec.ts` › 예약 금액이 미지급액과 다르면 REFUND_OUTSTANDING_AMOUNT_MISMATCH로 거절한다 |
| U207 | 미확정 PG 취소 요청이 있으면 별도 지급 예약은 REFUND_PAYOUT_UNRESOLVED로 거절된다 | FR-043 | example | DONE | `src/refund/refund-manual-payout.policy.spec.ts` › 결과가 확정되지 않은 PG 취소 요청이 있으면 REFUND_PAYOUT_UNRESOLVED로 거절한다 |
| U208 | 지급 결과 등록은 예약과 같은 금액·거래 ID·증빙이 있으면 SUCCEEDED·paidAmount·원장을 함께 저장한다 | FR-046 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 지급 결과 등록은 예약과 같은 금액·거래 ID·증빙이 있으면… |
| U209 | 지급 결과 등록의 지급 시각이 미래이면 400을 받는다 | FR-046 | example | DONE | `src/refund/dto/confirm-manual-refund-payout.dto.spec.ts` › 실제 지급 시각이 미래이면 형식 오류(400)다 |
| U210 | 외부 거래 ID 200자는 허용된다 | FR-046 | example | DONE | `src/refund/dto/confirm-manual-refund-payout.dto.spec.ts` › 실제 지급 거래 식별자 200자는 허용된다 |
| U211 | 외부 거래 ID 201자는 400을 받는다 | FR-046 | example | DONE | `src/refund/dto/confirm-manual-refund-payout.dto.spec.ts` › 실제 지급 거래 식별자 201자는 형식 오류(400)다 |
| U212 | 증빙이 없으면 MANUAL_PAYOUT_EVIDENCE_REQUIRED로 거절된다 | FR-046 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 지급 증빙이 없으면 MANUAL_PAYOUT_EVIDENCE_REQUIRED로… |
| U213 | 같은 지급 결과를 다시 등록하면 최초 결과를 받고 원장은 1건이다 | FR-046 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 같은 지급 결과를 다른 멱등 키로 다시 등록하면… |
| U214 | 다른 환불의 외부 거래 ID를 쓰면 MANUAL_PAYOUT_REFERENCE_REUSED로 거절된다 | FR-046 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 다른 환불의 별도 지급에서 이미 쓴 거래 ID로 등록하면… |
| U215 | 부족액 지급 결과 등록 시 부족 지급 검토가 완료되고 Refund가 PAID가 된다 | FR-048 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › PG가 적게 취소한 환불의 부족액 지급 결과를 등록하면… |
| U216 | 미지급 확인은 증빙·사유가 있으면 예약을 FAILED로, Refund를 ACTION_REQUIRED로 바꾼다 | FR-047 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 미지급 확인은 증빙·사유가 있으면… |
| U217 | 미지급 확인에 증빙이 없으면 MANUAL_PAYOUT_EVIDENCE_REQUIRED로 거절되고 예약은 유지된다 | FR-047 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 미지급 확인에 증빙이 없으면… |
| U218 | 시간이 지나도 예약 상태는 바뀌지 않는다 | FR-047 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 별도 지급 예약 후 3600초가 지나면…·정기 탐색이 기준 시간 뒤 반복돼도…(예약 RESERVED 유지 단언) |
| U219 | 초과 취소 검토 등록은 미지급액 0이면 Refund를 PAID로 바꾸고 확정 금액·실제액·원장은 그대로 둔다 | FR-049 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 초과 취소 검토 등록은 미지급액이 0이면… |
| U220 | 부족액이 남은 환불의 검토 등록은 REFUND_AMOUNT_REVIEW_INCOMPLETE로 거절된다 | FR-049 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 부족액이 남은 환불의 검토 등록은… |
| U221 | 예약 후 3600초가 지나면 미확인 알림 1건이 생긴다 | FR-037 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 별도 지급 예약 후 3600초가 지나면 운영자에게 미확인 알림 1건을… |
| U222 | 예약 후 3599초에는 미확인 알림이 생기지 않는다 | FR-037 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 별도 지급 예약 후 3599초에는 미확인 알림을 남기지 않는다 |
| U223 | 알림 생성 뒤 탐색이 반복돼도 미확인 알림은 늘지 않는다 | FR-037 | example | DONE | `src/refund/refund-result.integration.spec.ts` › 별도 환불금 지급 › 정기 탐색이 기준 시간 뒤 반복돼도 별도 지급 미확인 알림은 1건이고… |
| U224 | 고객·점주의 예약·결과 등록·미지급 확인·검토 요청은 403 REFUND_FORBIDDEN으로 거절된다 | FR-050 | example | DONE | `test/refund-operations.e2e-spec.ts` › 고객·점주의 별도 지급 예약·결과 등록·미지급 확인·초과 취소 검토 요청은 403… |

### `src/pg/guards/pg-signature.guard.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U225 | 올바른 서명과 현재 시각의 콜백은 로그인 없이 통과한다 | FR-031 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › 올바른 서명과 현재 시각의 콜백은 로그인 없이 통과한다 |
| U226 | 본문 바이트가 1개 바뀌면 PG_CALLBACK_UNAUTHORIZED로 거절된다 | FR-032 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › 본문 바이트가 1개 바뀌면… |
| U227 | 키 순서·공백만 다른 본문도 원문 바이트가 다르면 PG_CALLBACK_UNAUTHORIZED로 거절된다 | FR-032 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › 키 순서·공백만 다른 본문도… |
| U228 | 서명 헤더가 없으면 PG_CALLBACK_UNAUTHORIZED로 거절된다 | FR-032 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › 서명 헤더가 없으면… |
| U229 | 서명 헤더가 두 번 오면 PG_CALLBACK_UNAUTHORIZED로 거절된다 | FR-032 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › 서명 헤더가 두 번 오면… |
| U230 | 서명 hex가 63자리이면 PG_CALLBACK_UNAUTHORIZED로 거절된다 | FR-032 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › 서명 hex가 63자리이면… |
| U231 | 서명 hex가 대문자이면 PG_CALLBACK_UNAUTHORIZED로 거절된다 | FR-032 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › 서명 hex가 대문자이면… |
| U232 | 서명 시각이 300초 전이면 통과한다 | FR-032 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › 서명 시각이 300초 전이면 통과한다 |
| U233 | 서명 시각이 301초 전이면 PG_CALLBACK_EXPIRED로 거절된다 | FR-032 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › 서명 시각이 301초 전이면… |
| U234 | 서명 시각이 301초 뒤이면 PG_CALLBACK_EXPIRED로 거절된다 | FR-032 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › 서명 시각이 301초 뒤이면… |
| U235 | 압축된 본문은 PG_CALLBACK_FORMAT_INVALID로 거절된다 | FR-032 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › 압축된 본문(Content-Encoding)은… |
| U236 | query string이 붙은 콜백은 PG_CALLBACK_FORMAT_INVALID로 거절된다 | FR-032 | example | DONE | `src/pg/guards/pg-signature.guard.spec.ts` › query string이 붙은 콜백은… |
| U237 | 사용자 JWT만 있고 서명이 없는 콜백은 PG_CALLBACK_UNAUTHORIZED로 거절된다 | FR-032 | example | DONE | `test/refund-callback-auth.e2e-spec.ts` › … (QS-7-3) |
| U238 | 비밀값과 서명 값은 거래 로그에 남지 않는다 | FR-032 | example | DONE | `test/refund-callback-auth.e2e-spec.ts` › 서명 비밀값과 서명 값은 거래 로그에 남지 않는다 |

### `src/refund/refund-query.service.ts, src/refund/dto/get-refund-query.dto.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U239 | 목록은 requestedAt 내림차순, 같으면 id 내림차순으로 정렬된다 | FR-036 | example | PENDING | |
| U240 | page·limit을 생략하면 page=1·limit=20으로 조회된다 | FR-036 | example | DONE | `src/refund/dto/get-refund-query.dto.spec.ts` / U240 |
| U241 | limit=100은 허용된다 | FR-036 | example | DONE | `src/refund/dto/get-refund-query.dto.spec.ts` / U241 |
| U242 | limit=101은 400을 받는다 | FR-036 | example | DONE | `src/refund/dto/get-refund-query.dto.spec.ts` / U242 |
| U243 | limit=0은 400을 받는다 | FR-036 | example | DONE | `src/refund/dto/get-refund-query.dto.spec.ts` / U243 |
| U244 | 권한 범위 안에 환불이 없으면 200과 빈 목록을 받는다 | FR-033 | example | PENDING | |
| U245 | 고객이 userId를 지정하면 미허용 필드로 400을 받는다 | FR-034 | example | PENDING | |
| U246 | 미지급액은 확정 금액에서 실제 지급액을 뺀 값으로 표시된다 | FR-036 | example | PENDING | |
| U247 | 운영 오류 원문과 증빙은 MANAGER 응답에만 담긴다 | FR-036 | example | PENDING | |
| U248 | 과거 승인 대기 이관 이력은 신규 이용 종료와 구분되는 LEGACY 상태로 표시된다 | FR-007a | example | PENDING | |
| U249 | actionRequiredOnly 필터는 FAILED 시도의 미지급 환불을 계속 포함한다 | FR-051 | example | PENDING | |

### `src/refund/refund-notification.service.ts, src/refund/refund-event.repository.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U250 | 고객 환불의 지급 실패 알림은 고객·현재 점주·운영자에게 생긴다 | FR-037 | example | PENDING | |
| U251 | 매장 환불의 지급 실패 알림은 점주·운영자에게 생긴다 | FR-037 | example | PENDING | |
| U252 | 시스템 자동 취소의 지급 실패 알림은 운영자에게만 생긴다 | FR-037 | example | PENDING | |
| U253 | QUERY_FAILED 전환 알림은 운영자에게 생긴다 | FR-037 | example | PENDING | |
| U254 | 금액 불일치 알림은 운영자에게 생긴다 | FR-037 | example | PENDING | |
| U255 | 같은 사건을 두 번 처리해도 알림은 1건이다 | FR-037 | example | PENDING | |
| U256 | 상태 전이가 롤백되면 알림도 남지 않는다 | FR-037 | example | PENDING | |
| U257 | 공동 점주 한 명의 읽음 처리는 다른 점주의 읽음 상태를 바꾸지 않는다 | FR-039 | example | PENDING | |
| U258 | 이미 읽은 알림을 다시 읽음 처리해도 최초 readAt이 유지된다 | FR-039 | example | PENDING | |
| U259 | unreadOnly=true 조회는 안 읽은 알림만 돌려준다 | FR-039 | example | PENDING | |
| U260 | 받을 수 없는 알림의 읽음 처리는 404 NOTIFICATION_NOT_FOUND로 거절된다 | FR-039 | example | PENDING | |
| U261 | PG 실패가 있어도 접수 응답은 502가 아니라 202와 ACCEPTED·ACTION_REQUIRED 상태다 | FR-035 | example | PENDING | |

### `scripts/refund/check-legacy-refunds.ts, scripts/refund/migrate-legacy-refunds.ts`

| id | behavior | traces | kind | state | test |
|---|---|---|---|---|---|
| U262 | 이관 사전 점검은 결과가 미확정인 과거 PG 취소 요청이 남아 있으면 전환 차단 결과를 낸다 | INV-1 | example | PENDING | |
| U263 | 이관 사전 점검은 DB에 아무것도 쓰지 않는다 | INV-1 | example | PENDING | |
| U264 | 과거 승인 대기 환불은 LEGACY_REJECTED·NOT_APPLICABLE과 사유 LEGACY_STORE_REFUND_REQUIRED로 이관되고 이용권은 바뀌지 않는다 | FR-007a | example | PENDING | |
| U265 | 성공 증거가 있는 과거 환불만 ACCEPTED·PAID로 이관된다 | INV-1 | example | PENDING | |
| U266 | 누락 원장 보충을 두 번 실행해도 원장은 지급마다 1건이다 | FR-019 | example | PENDING | |

## 불변식

- **INV-1**: 데이터 전환은 결과가 미확정이거나 증거가 없는 과거 환불·PG 취소 요청의 결과를 추측해 바꾸지 않는다. 근거: `plan.md` 6절 "미확정 기존 PG 취소 요청이 있으면 전환을 멈추고 조회로 정리한다. 증거 있는 성공만 PAID로 이관한다", `data-model.md` 10절.
- **INV-2**: 환불 저장 모델은 data-model §3·§6이 정한 값 제약(금액·합계 음수 금지, 별도 환불금 지급액 양수, 대상 종류별 상품 ID 규칙, 신규 확정 환불의 실행자·종료 동의·확정 시각 필수, NOT_APPLICABLE은 과거 거절만)을 서비스 검증과 별개로 DB에서도 거부한다. 근거: `data-model.md` §3 필드 표, §6 "amount·actualAmount·paidAmount·횟수는 음수 금지. ORDER_ITEM은 상품 필수, PAYMENT는 상품 null·SYSTEM만. 신규 CUSTOMER/STORE는 실행자·종료 동의 필수다", `tasks.md` T007. 2026-10-28 Phase 2 진행 중 테스트 목록에 빠진 제약을 발견해 추가했다.

## 아직 담당 파일을 정하지 않은 동작

아래 동작은 여러 컴포넌트에 걸친 통합 검증이다. 해당 작업을 시작할 때 위 표에 번호를 붙여 옮기거나, 이유와 함께 제외한다.

- 고객·점주 동시 접수, 입실과 환불, 콜백과 조회, 자동·개별 조회, 재시도와 별도 지급 예약이 경쟁해도 확정 환불·활성 PG 취소 요청·활성 예약·지급별 원장이 각각 1건을 넘지 않는다 (FR-029, FR-041, FR-043, FR-019 / `tasks.md` T172).
- 커밋 전후·PG 전송 전후·성공 후 저장 실패·작업자 중단 뒤 재시작해도 이용 종료·확정된 환불 금액·별도 지급 예약이 보존되고 조회부터 재개된다 (FR-016, FR-022 / T173).
- 자동 처리 최종 결과 정상·적체 없음 조건에서 시도 결과 판명이 기본 설정으로 75초 안이다 (SC-004 / T175).

## 범위 밖

`spec.md` "범위 밖" 절의 항목이며 이 목록에 테스트를 두지 않는다.

- 결제 성공 시 매출 원장 기록, 정산 배치·이월, 매장 송금
- 실제 PG·은행 연동과 송금 실행(별도 환불금 지급의 예약·증빙 기록은 포함)
- 점주 화면의 참고 환불액 제안
- 분할결제
- 메일·메신저 등 외부 알림 발송
- 이용권 강제 폐기(환불 없이 소멸)와 REF-T04 판정
- PG 일별 거래 내역 대사, PG 결과·원장 수동 덮어쓰기, 초과 지급 회수

## 검증 명령

`.specify/memory/tdd-profile.md`에서 그대로 옮겼다.

- 단일 테스트(단위): `bash -c 'out=$(npx jest "$0" -t "$1" 2>&1); code=$?; printf "%s\n" "$out"; printf "%s\n" "$out" | grep -qE "^Tests:.* [1-9][0-9]* (passed|failed)" || { echo "선택된 테스트 0개"; exit 2; }; exit $code' {file} "{name}"`
- 단일 테스트(E2E): `bash -c 'out=$(npx jest --config ./test/jest-e2e.json "$0" -t "$1" 2>&1); code=$?; printf "%s\n" "$out"; printf "%s\n" "$out" | grep -qE "^Tests:.* [1-9][0-9]* (passed|failed)" || { echo "선택된 테스트 0개"; exit 2; }; exit $code' {file} "{name}"`
- 파일 단위: `npx jest {file}`
- 전체: `npm run test && npm run test:e2e`
- 커버리지: `npm run test:cov`
- 뮤테이션: 도구 없음(`mutation: null`). 헌법 III에 따라 주요 동작의 구현을 일부러 깨뜨려 테스트가 실패하는지 확인한다.
