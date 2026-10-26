# 조사와 설계 결정: 이용 종료와 환불금 지급 분리

**갱신일**: 2026-10-26 · **기준**: [기능 명세](spec.md), 환불 비즈니스 정책 v0.3

이 문서는 구현 예정 설계다. v0.2의 PG 성공 시 이용권 소멸·PG 실패 시 이용 가능 복귀 설계는 아래 결정으로 대체한다.

## R1. 업무 결정과 PG 취소 요청 분리

- 검증과 명시적 동의 후 `Refund`에 이용 종료와 합의 금액을 저장한다. 같은 트랜잭션에서 퇴실·사용량 차감·Ticket REVOKED·고정석 해제·기존 정지 기록 종료를 수행한다.
- `PaymentCancel`은 PG에 보내는 취소 요청의 번호·금액·처리 결과를 보관한다. 새 식별자를 발급한 PG 취소 요청은 실패한 요청을 대신해 새 PG 취소 요청 식별자로 보내는 요청이다. 기존 환불(`Refund`)과 확정 금액은 유지하고, 이전 실패 기록을 보존한 채 `PaymentCancel` 기록을 하나 추가한다. 처리 결과가 미확정인 취소 요청은 환불당 동시에 1건만 허용하며, 그 요청을 기존 PG 취소 요청 식별자로 재전송할 때는 행을 추가하지 않는다.
- PG 실패는 `Refund`를 철회하지 않는다. 환불금 지급 조치 필요로 남기며 이용권·기간·좌석을 복구하지 않는다. 고객과 점주는 금액·종료 시점·이 결과를 안내받고 동의해야 한다.
- 기존 일반 정지를 환불에 호출하지 않는다. 종료 확정 후 정기권 이용 기간이나 시간권 기한을 보전할 재개가 없으므로, 정지 기간 연장·고정석 재선택·좌석 유형 가격 변경을 환불 복구에 넣지 않는다.
- 이 선택은 서비스 업무 정책이다. 고정석 업계의 공통 표준이라고 주장하지 않는다. 구독 종료와 환불을 별도로 선택하는 [Stripe 문서](https://docs.stripe.com/billing/subscriptions/cancel)와 환불금 지급 실패 시 대체 환불을 안내하는 [Stripe 문서](https://docs.stripe.com/refunds#handle-failed-refunds)를 참고했다.

## R2. 판정·권한·중복 신청

- 고객은 본인 이용권, 점주는 현재 `ShopOwner`로 연결된 매장 안에서만 조회한다. 범위 밖은 존재를 드러내지 않는 404다.
- 순서는 범위 내 존재 → 결제 성공 → 환불금 지급 완료 환불 → 확정 미지급 환불 → 가능 조건이다. Ticket REVOKED만으로 환불금 지급 완료를 추정하지 않는다.
- `USED_TICKET`·`EXPIRED_TICKET`은 기존 고객 자동 환불 거절 사유다. 매장 환불은 소진·만료·기존 정지에도 가능하며, 미사용 기한 안 이용권은 전액만 허용한다.
- 거절·동의 누락은 `Refund`·`PaymentCancel`·이용 종료를 만들지 않는다. 확정한 환불은 상품당 1건이며, PG 취소 요청 실패 후 새 환불을 신청해도 기존 미지급 건을 안내한다.
- 고객지원 계정(MANAGER)은 새 매장 환불 금액을 정하지 않는다. 기존 환불의 조회·재확인·PG 취소 재요청·별도 환불금 지급 증빙·금액 불일치 검토를 맡는다.

## R3. 환불금 지급 결과와 미지급 금액

- `Refund.amount`는 불변 합의 금액이다. 실제 환불금 지급 합계 `paidAmount`, `outstandingAmount=max(amount-paidAmount,0)`, `overpaidAmount=max(paidAmount-amount,0)`를 구분한다.
- PG 성공은 해당 `PaymentCancel`의 SUCCEEDED다. 정상 금액이면 `Refund.payoutStatus=PAID`, 실제액 불일치면 ACTION_REQUIRED다. PG 취소 요청 성공과 환불금 전액 지급 완료를 같은 상태로 취급하지 않는다.
- PG 실제액이 부족하면 그 부족액만 환불금을 별도로 지급한다. 부족액 실제 환불금 지급 증빙 확정 시 검토 기록과 reviewRequired 해제를 함께 반영해 PAID로 마무리한다. 원래 금액 전액을 다시 PG에 보내지 않는다. 초과면 추가 환불금 지급을 막고 운영자가 증빙·사유로 검토를 마친 뒤 PAID로 정리한다. 초과액 회수·PG 실제액 덮어쓰기는 범위 밖이다.
- 0원은 PG 취소 요청을 생성하지 않고 이용 종료·좌석 해제·Refund PAID·원장 0원 1건을 함께 저장한다.

## R4. 전송·조회·재전송

- `PaymentCancel`은 전송 전에 DB에 저장한다. 확실한 NOT_SENT는 시도 FAILED, 환불 ACTION_REQUIRED다. 운영자가 원인을 해결한 뒤 같은 환불에서 재시도할 수 있다.
- UNKNOWN·ACCEPTED는 REQUESTED로 조회한다. DNS·접속 오류도 어떤 요청 바이트도 보내지 않았다고 어댑터가 보장할 때만 NOT_SENT다.
- 조회 결과는 SUCCEEDED(실제액·취소 거래 ID 필수), FAILED(확정 거절), IN_PROGRESS, NOT_FOUND(authoritative=true), QUERY_ERROR로 나눈다. 조회 반영 지연·일반 HTTP 404·인증·네트워크 오류를 NOT_FOUND로 바꾸지 않는다.
- 백그라운드 자동 작업은 PG가 미접수를 확실히 확인한 경우 모든 경로에서 같은 시도 ID·금액·PG 멱등 키로 최대 3회 재전송한다. 기존 SYSTEM 전용 한도는 `REFUND_RESEND_LIMIT`로 바꾼다. 한도를 모두 소진한 뒤 PG 미접수가 확인돼야 시도 FAILED/RETRY_EXHAUSTED와 Refund ACTION_REQUIRED로 전환한다. FAILED 시도는 자동 PG 조회·재전송에서 제외하고 운영자 목록에 남긴다. 한도 소진 후에도 PG 처리 중·조회 장애이면 결과를 확인할 때까지 조회한다. 환불금 포기가 아니다.
- 결과 불명 상태에서 새 식별자를 발급한 PG 취소 요청·별도 환불금 지급을 허용하지 않는다. 확정 실패 뒤 운영자가 새 식별자를 발급한 PG 취소 요청을 만들 때도 환불금 지급 합계 0원·미확정 시도 없음·별도 환불금 지급 예약 없음·합의 금액 불변을 검증한다.
- 실제 PG 미연동은 명시적 전송 전 실패·조회 오류다. 운영에서 테스트 성공 스위치를 쓰지 않고 E2E에서만 PG 테스트 구현을 주입한다.

- 자동 재전송 한도를 소진하고 PG 미접수가 확인돼 최근 시도가 FAILED/RETRY_EXHAUSTED가 된 환불은 해당 매장 점주도 PG 취소 다시 요청을 직접 실행할 수 있다. 실제 환불금 지급액 0·모든 PG 결과 확정·활성 별도 환불금 지급 예약 없음을 확인하고 같은 Refund.amount의 새 PaymentCancel을 만든다. 이전 실패 기록은 그대로 보존하고 실행자·시각·사유를 남긴다. 새 식별자를 발급한 PG 취소 요청의 resendCount는 0부터 시작한다. 각 시도의 자동 재전송에는 기존 한도를 계속 적용하며, 한도 소진 건에서 다음 시도를 자동으로 만들지는 않는다. 결과 확인 버튼의 기존 시도 재전송과 확정 실패 뒤의 명시적 새 식별자를 발급한 PG 취소 요청 생성을 구분한다.

## R5. 조회 복구와 서버 재시작

- 기존 BullMQ와 DB 일정(`nextInquiryAt`)을 사용한다. 기동 시 스케줄을 복원하고 메시지 유실·중복과 무관하게 DB에서 예정 작업을 찾는다. 커밋 뒤 호출 전 중단도 재조회부터 처리하며 최초 전송을 무조건 반복하지 않는다.
- 연속 조회 오류 5회면 PaymentCancel QUERY_FAILED다. 환불금 지급 결과는 미확정이고 Refund PENDING을 유지한다.
- `RefundRecoveryControl` 단일 행으로 자동 복구 담당을 공유한다. 900초마다 가장 오래된 1건만 조회하며, 정상 응답을 받으면 최대 20건씩 나머지를 조회한다. IN_PROGRESS도 통신 정상 응답이지 환불금 지급 완료는 아니다.
- 일괄 조회 중 오류가 재발하면 1건 조회 방식으로 돌아간다. MANAGER의 수동 재개도 같은 제어 행과 담당 토큰을 사용한다.
- 처리 담당 토큰·기한은 중복 작업 방지 장치다. 기한 경과로 이용권이나 지급 차단 상태를 복구하지 않는다.

### 개별 환불 확인과 전체 복구의 분리

- OWNER는 현재 소유 매장, MANAGER는 운영 범위에서 한 환불의 미확정 시도만 즉시 조회한다. 고객은 실행하지 않는다. 전체 장애 복구 재개는 계속 MANAGER 전용이다.
- 개별 확인은 자동 작업과 PaymentCancel 담당 토큰·lastInquiryAt을 공유한다. 전송·조회 진행 중이면 추가 호출하지 않고, 조회가 끝났어도 lastInquiryAt부터 일반 조회 간격 안의 반복 실행은 최근 상태를 반환한다. PG 호출은 DB 트랜잭션 밖에서 하고 결과 저장·콜백 경합은 R6의 동일 처리로 해결한다.
- 개별 확인의 정상 응답은 해당 건만 반영하며 전역 복구 제어를 바꾸지 않는다. 개별 확인에서 PG 미접수가 확실하면 자동 재전송 횟수와 관계없이 즉시 다시 보낸다. 미확정 시도는 기존 ID·금액을 사용하며 manualResendCount로 따로 센다. 한도 소진 실패 건도 개별 조회할 수 있고 미접수가 다시 확인되면 기존 실패를 보존한 취소 요청을 새 PG 취소 요청 식별자로 기록해 보낸다. 별도 버튼·사유 입력은 요구하지 않는다. 담당 토큰은 자동 작업과 공유하되 자동 횟수와 manualResendCount를 구분한다. 조회 오류·PG 처리 중이면 재전송하지 않는다. 한도 소진 외 확정 실패·0원·별도 예약에는 PG를 호출하지 않는다. 응답·예외는 [API 개별 확인](contracts/rest-api.md#개별-확인-post-refundrefundidpg-check)을 따른다.

## R6. 동시성·저장 범위

- 공유 잠금 순서는 Payment → Ticket → TicketPause → UsageSession → SeatAssignment → Refund → PaymentCancel → ManualRefundPayout이다. 필요한 행만 이 순서로 잠그며 같은 종류는 ID 순이다. 기존 정지 행은 Ticket 다음·UsageSession 이전에 잠그고 조회·종료한다.
- 환불 접수와 입실은 Ticket을 먼저 잠근다. 입실이 먼저면 고객 환불은 사용 이력으로 거절하고, 환불 확정이 먼저면 입실은 TICKET_TERMINATED로 거절한다.
- PG 조회 담당 지정은 PaymentCancel만 갱신하는 짧은 독립 트랜잭션에서 끝낸다. 결과 저장은 새로운 트랜잭션에서 Refund → PaymentCancel 순서로 잠그고 상태·토큰을 재확인한다. PG 결과 저장에서는 Ticket을 다시 활성화하거나 좌석을 건드리지 않는다.
- PG 호출·송금 실행을 DB 트랜잭션 안에서 기다리지 않는다. 퇴실 Job 제거는 커밋 뒤 수행하며 실패해도 종료를 되돌리지 않는다. 남은 Job은 REVOKED를 다른 상태로 덮어쓰거나 다시 차감할 수 없다.
- 같은 환불금 지급 성공 반영·실제액 합산·원장·필요 알림은 하나의 트랜잭션이다. 중복 콜백과 조회가 경쟁해도 한 번만 반영한다. 최종 결과와 모순되는 늦은 통보는 자동 덮어쓰기 대신 운영자 알림·후속 대사 대상으로 남긴다.

## R7. 별도 환불금 지급과 환불금 중복 지급 차단

- 환불금 지급 실패를 이용 복구로 되돌리지 않으려면 PG 외 지급을 실제로 기록할 경로가 필요하다. 이번 범위는 MANAGER의 예약·증빙 기록이며 은행 송금 실행은 제외한다.
- `ManualRefundPayout` RESERVED 생성과 `Refund.payoutMethod=MANUAL` 전환을 함께 저장한다. 모든 PG 취소 요청이 확정됐고 미지급액이 양수인 ACTION_REQUIRED에서만 허용하며, 예약액은 미지급액과 같아야 한다.
- 예약 뒤 실제 지급은 사람이 외부에서 한다. 환불금 지급 시각·외부 거래 식별자·증빙·실행자와 예약액을 확인한 뒤 SUCCEEDED와 원장을 함께 기록한다. 예약 요청이나 확인 버튼만으로 돈이 지급됐다고 처리하지 않는다.
- 환불금 지급 여부가 불명확한 예약은 기한 만료로 해제하지 않는다. 예약 후 3600초가 지나도 미확인이면 해당 예약의 운영자 알림을 한 번 남기고, 담당자가 바뀌어도 예약을 유지한다. 증빙 있는 확실한 미지급 확인으로만 FAILED로 끝내며 Refund는 ACTION_REQUIRED로 남긴다. PG 모드로 복귀하려면 PG 취소 다시 요청을 명시적으로 요청한다. MANAGER는 기존 확정 실패를, 점주는 R4의 최근 시도 RETRY_EXHAUSTED 조건을 만족하는 자기 매장 건만 실행할 수 있다.
- MANAGER만 예약·확정·미지급 확인을 할 수 있다. 한 환불에 활성 예약은 1개, 외부 지급 거래 식별자는 전역 고유다. 원문 은행 계좌·민감정보를 로그에 남기지 않으며 증빙 참조도 권한 범위 안에서만 노출한다.

## R8. 원장·알림·멱등성

- 기존 `Ledger.paymentCancelId @unique`를 유지하고 `refundId`, `manualRefundPayoutId`를 추가한다. 실제 지급별 `amount=-actualAmount`, 초기 상태 RELEASABLE, 원래 shopId·orderId를 기록한다. 별도 환불금 지급은 manualRefundPayoutId unique, 0원은 refundId 기반 부분 unique로 보호한다.
- 같은 환불에 환불금 지급 실패 후 재시도가 있어도 실패 시도는 원장을 만들지 않는다. 부족액을 별도 환불금 지급하면 PG 실제액과 별도 환불금 지급액에 각각 1건이 생긴다. 매출 기록·정산 배치는 여전히 범위 밖이다.
- 고객 환불 환불금 지급 실패는 고객·현재 매장 점주·운영자, 매장 환불은 점주·운영자, 시스템 취소는 운영자에게 알린다. QUERY_FAILED·금액 불일치·별도 환불금 지급 장기 미확인도 운영자 알림 대상이다. 환불금 지급 상태 전이와 알림 생성은 같은 트랜잭션이며 읽음은 사용자별이다.
- 환불 접수의 DB 멱등 키는 요청자+작업종류+키, 요청 내용 해시는 대상·금액·사유·동의를 포함한다. 같은 키·같은 요청은 권한 재검증 뒤 최초 응답을 반환한다. 다른 요청은 409다.
- PG 취소 재요청·별도 환불금 지급 예약·확정은 별도의 작업종류로 같은 멱등 규칙을 적용한다. 재시도·예약에는 키를 필수로 받는다. 외부 거래 고유성과 지급별 원장 고유성은 키 유무와 무관한 마지막 방어다.

## R9. 콜백 인증

결제·환불 콜백에만 JWT를 우회하고 PG 서명 가드를 적용한다. rawBody·HMAC-SHA256·X-PG-Timestamp·X-PG-Signature·300초 허용 편차와 기존 canonical 규격은 유지한다. 서명 검증 전에 업무 상태를 바꾸지 않는다. 세부 규격은 [API 계약](contracts/rest-api.md)을 따른다.

## R10. 설정·데이터 전환·범위

| 환경 변수 | 기본값 | 의미 |
|---|---:|---|
| REFUND_RESULT_WAIT_SECONDS | 60 | 응답 없는 PG 취소 요청의 최초 조회 대기 |
| REFUND_SWEEP_INTERVAL_SECONDS | 5 | DB의 전송·조회 예정 작업 탐색 주기 |
| REFUND_QUERY_INTERVAL_SECONDS | 15 | 정상 재조회 간격 |
| REFUND_PG_TIMEOUT_SECONDS | 10 | PG 전송·조회 응답 제한 |
| REFUND_WORK_LEASE_SECONDS | 30 | 작업자 처리 기한 |
| REFUND_QUERY_BACKOFF_SECONDS | 15 | 조회 실패 후 첫 재조회 간격 |
| REFUND_QUERY_BACKOFF_MAX_SECONDS | 300 | 지수 증가 조회 간격 상한 |
| REFUND_QUERY_FAILURE_THRESHOLD | 5 | PG 취소 결과 확인 실패 전환 연속 오류 횟수 |
| REFUND_RECOVERY_PROBE_SECONDS | 900 | 장애 복구 확인용 1건 조회 간격 |
| REFUND_RECOVERY_BATCH_SIZE | 20 | 일반·복구 조회 처리 단위 |
| REFUND_RESEND_LIMIT | 3 | 모든 경로의 백그라운드 자동 재전송 한도, 최초·개별 확인에 따른 재전송 제외 |
| REFUND_MANUAL_CONFIRM_ALERT_SECONDS | 3600 | 별도 환불금 지급 예약 후 미확인 최초 알림 기준 |
| PG_CALLBACK_MAX_SKEW_SECONDS | 300 | 콜백 서명 시각 오차 허용 |
| PG_CALLBACK_SECRET | 필수, 기본값 없음 | 공유 서명 비밀값, 최소 32자 |

숫자는 양의 정수, 재전송 한도는 0 이상이다. Joi에서 `lease > timeout`, `interval >= sweep+timeout`, `backoffCap >= backoffBase`를 검증한다. 조회 장애 간격은 `min(base × 2^(연속오류-1),cap)`이다. 환경 변경은 순차 재시작으로 반영하고 DB 진행 상태·금액·기한은 초기화하지 않는다.

SC-004는 최종 PG 결과를 정상 응답하고 작업이 밀리지 않는 조건에서 60+15=75초에 시도 결과를 판명하는 목표다. PG 처리 중·재전송·장애·적체 또는 미지급금 전체 해결 시간을 75초로 보장하지 않는다.

기존 구현과 새 계약은 비호환이다. 기존 PG 미확정 시도는 실제 결과를 조회해 정리한 뒤 데이터 전환하며, 미확정 건이 남으면 전환을 차단한다. 과거 승인 대기·확정 실패는 신규 이용 종료로 추정하지 않고 이력으로 보존한다. 과거 성공과 누락 원장은 증거가 있는 금액만 이관한다. 상세는 [데이터 모델](data-model.md) 10절이다.

근거는 기존 refund/payment/pg/usage-session/session-lifecycle/ticket-pause·Prisma 코드와 사용자 결정이다. 기존 기술 문서 [NestJS raw body](https://docs.nestjs.com/faq/raw-body), [BullMQ 스케줄러](https://docs.bullmq.io/guide/job-schedulers), [PostgreSQL 잠금](https://www.postgresql.org/docs/16/explicit-locking.html), [Node crypto](https://nodejs.org/docs/latest-v22.x/api/crypto.html)의 선택은 유지한다. 이번 수정에서 라이브러리 동작을 새로 실행 검증한 것은 아니다.
