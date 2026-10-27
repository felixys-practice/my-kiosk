# 환불 REST API 계약: 이용 종료와 지급 분리

**기준**: [명세](../spec.md), [데이터 모델](../data-model.md), 정책 v0.4. 구현 예정의 비호환 변경이다. PG 취소 요청 실패는 환불 접수 취소가 아니다.

## 1. 공통 규약

- 기본 경로는 접두사 없는 기존 경로다. JSON·UUID·UTC ISO 8601, 원 단위 0 이상 정수를 사용한다. 소수·음수·숫자 문자열·미허용 필드는 DTO에서 거부한다.
- 콜백 외에는 JWT가 필수다. USER는 본인, OWNER는 현재 ShopOwner 매장 범위, MANAGER는 운영 범위다. 고객지원은 새 매장 환불 금액을 정할 수 없다. 역할 부족은 403 REFUND_FORBIDDEN이며 현재 전역 RoleGuard의 401 응답을 새 계약의 역할 검사에 재사용하지 않는다.
- 실행자 ID는 JWT에서만 받는다. 고객 본문에 userId·shopId·amount로 다른 대상을 지정할 수 없다. 성공·오류의 전역 래핑은 유지한다.
- 성공은 `{success,statusCode,data,timestamp,path}`, 오류는 `{success:false,statusCode,error:{code,message,details?},timestamp,method,path}`다. 예시는 data 부분이다.
- 예외 필터는 인식한 도메인 오류에 `error.code ?? error.name`을 사용한다. 기존 다른 도메인 코드·인증 규칙을 일괄 변경하지 않는다.

이 문서에서 PG 취소 요청은 서버가 PG에 확정된 환불 금액만큼 결제를 취소해 달라고 보내는 요청이다. 서버는 PG 취소 요청 식별자(`PaymentCancel.id`)를 발급해 각 요청의 금액과 처리 결과를 기록한다. 새 식별자를 발급한 PG 취소 요청은 실패한 요청을 대신해 새 PG 취소 요청 식별자로 보내는 요청이다. 기존 환불(`Refund`)과 확정된 환불 금액은 유지하고, 이전 실패 기록을 보존한 채 `PaymentCancel` 기록을 하나 추가한다. 기존 요청을 재전송할 때는 PG 취소 요청 식별자와 기록을 유지한다.

## 2. 경로와 권한

| 메서드·경로 | 범위 | HTTP |
|---|---|---:|
| POST /refund | USER·본인 이용권, 종료 동의 필수 | 202 |
| POST /refund/shop/:shopId | OWNER·현재 소유 매장, 종료 동의 필수 | 202 / 200(0원) |
| POST /usage-sessions | 기존 입실 계약, 종료 이용권 차단 | 기존 201 |
| GET /refund/me | 본인 주문의 환불·과거 거절 이력 | 200 |
| GET /refund/shop/:shopId | 현재 소유 OWNER / MANAGER | 200 |
| GET /refund/user/:userId | MANAGER | 200 |
| GET /refund/:refundId | 본인 주문 / 현재 ShopOwner / MANAGER | 200 |
| GET /refund/recovery/status | MANAGER | 200 |
| POST /refund/recovery/resume | MANAGER·전체 조회 재개 | 202 / 200 |
| POST /refund/:refundId/pg-check | 현재 소유 OWNER / MANAGER·해당 환불만 PG 확인 | 200 / 202 |
| POST /refund/:refundId/payout-retries | MANAGER·운영자 직접 재시도 | 202 |
| POST /refund/:refundId/manual-payouts | MANAGER·별도 환불금 지급 예약 | 201 |
| POST /refund/:refundId/manual-payouts/:payoutId/confirm | MANAGER·실제 환불금 지급 증빙 확정 | 200 |
| POST /refund/:refundId/manual-payouts/:payoutId/not-paid | MANAGER·확실한 미지급 증빙 확인 | 200 |
| POST /refund/:refundId/amount-review | MANAGER·초과 지급 검토 기록 | 200 |
| GET /refund/notifications | 현재 본인 수신 범위만 | 200 |
| PATCH /refund/notifications/:notificationId/read | 현재 수신 권한 있는 본인 | 200 |
| POST /payments/callback | PG 서명, JWT 불필요 | 200 |
| POST /refund/callback | PG 서명, JWT 불필요 | 200 |

고정 경로 me/shop/user/recovery/notifications를 `:refundId`보다 먼저 매칭한다. 기존 상세 키 paymentCancelId는 refundId로 바뀐다. PG 콜백은 여전히 시도 키 paymentCancelId로 연결한다. 승인 대기 승인 API나 PG 결과 강제 성공·실패 API는 없다.

## 3. 환불 정보·상태

```json
{
  "refundId":"UUID", "decisionStatus":"ACCEPTED", "policyVersion":"v0.4",
  "paymentId":"UUID", "targetKind":"ORDER_ITEM", "orderItemId":"UUID", "ticketId":"UUID",
  "shopId":"UUID", "source":"STORE", "amount":12000, "paidAmount":0,
  "outstandingAmount":12000, "overpaidAmount":0,
  "acceptedAt":"2026-10-26T00:00:00.000Z", "terminatedAt":"2026-10-26T00:00:00.000Z",
  "payoutStatus":"PENDING", "payoutMethod":"PG", "reviewRequired":false,
  "paymentCancelId":"현재 시도 UUID", "attemptStatus":"REQUESTED",
  "actionCode":null, "actionReason":null, "paidAt":null
}
```

| 구분 | 값·표시 |
|---|---|
| decisionStatus | 신규 ACCEPTED는 이용 종료·금액 확정. LEGACY_REJECTED는 과거 승인 대기·거절 이력이고 acceptedAt/terminatedAt=null |
| payoutStatus=PENDING | 환불금 지급 처리 중, 현재 시도의 QUERY_FAILED면 PG 취소 결과 확인 실패·재확인 중으로 별도 표시 |
| payoutStatus=ACTION_REQUIRED | 미지급 조치 필요 또는 금액 불일치 검토 필요. 확정 환불은 유지 |
| payoutStatus=PAID | 확정된 환불 금액의 지급 완료·필요 검토 완료. 고객 은행의 명세 반영 시각을 뜻하지 않음 |
| payoutStatus=NOT_APPLICABLE | 과거 거절 이력만 사용, 미지급 환불로 계산하지 않음 |
| attemptStatus | REQUESTED / QUERY_FAILED / SUCCEEDED / FAILED, 한 번의 PG 취소 요청 상태 |

신규 ACCEPTED의 이용권은 모든 환불금 지급 상태에서 REVOKED다. PAYMENT 대상은 ticketId/orderItemId/terminatedAt=null이며 SYSTEM만 생성한다. 실제 환불금 지급 합계는 성공 시도·증빙 지급만 더하고, 미확정 PG 결과나 예약 금액을 0원 환불금 지급 성공으로 해석하지 않는다. 과거 기록은 policyVersion=LEGACY와 decisionStatus로 새 결정과 구별한다.

상세 응답은 `attempts`와 `manualPayouts` 이력을 포함한다. 운영 상세 오류·증빙 참조·검토 사유는 MANAGER에게만 노출하며 고객에게 PG 원문 오류·민감 계좌 정보를 반환하지 않는다.

## 4. 환불 확정 요청

### 고객: POST /refund

```json
{ "ticketId":"UUID", "consentToTerminateTicket":true }
```

본인 이용권 범위 → 결제 SUCCESS → 환불금 지급 완료 Refund → 미지급 ACCEPTED Refund → 사용·기한 조건 → 종료 동의를 확인한다. 소멸 상태만 보고 ALREADY_REFUNDED를 반환하지 않는다. 실제 지급이 끝나기 전의 확정 환불은 REFUND_IN_PROGRESS다.

사용 여부는 기존 정책 순서(현재 이용 중 → 정기권 활성화 전 → 시간권 잔여=구매 시간 → 그 외)다. 미사용 기한은 PERIOD.activationDeadline / TIME.minuteExpireDeadline이고 신청 시각이 기한보다 늦어야 초과다. 가능 조건 대표 사유는 USED_TICKET 우선, `details.violations`에 모든 위반, `details.action=CONTACT_SHOP` 안내를 둔다.

종료 동의는 환불금 지급 지연·실패에도 이용권이 복구되지 않음과 환불 금액을 안내한 확인 값이다. false/누락은 REFUND_TERMINATION_CONSENT_REQUIRED다. 검증 거절은 Refund·시도·세션·좌석을 바꾸지 않는다.

### 매장: POST /refund/shop/:shopId

```json
{ "ticketId":"UUID", "amount":5000, "reason":"서비스 불만 보상", "consentToTerminateTicket":true, "consentToEndSession":true }
```

- 현재 ShopOwner 범위에서만 이용권을 찾는다. amount 필수, reason 제공 시 trim 후 1~500자, 동의 값은 boolean이다. 종료 동의는 필수이며 이용 중인 경우 퇴실 동의도 필요하다. UI는 한 번의 확인으로 두 값을 보낼 수 있다.
- 사용 이력·기한 초과는 `0 <= amount <= 실결제액`와 공백 아닌 사유가 필수다. 소진·만료·기존 정지를 이유로 거부하지 않는다. 미사용 기한 안이면 전액만 허용하고 reason은 선택이다.
- 이용 중에 consentToEndSession이 false/누락이면 TICKET_IN_USE다. 동의 사이 이미 퇴실했다면 다시 차감하지 않는다. 앞선 거절은 업무 기록을 만들지 않으므로 같은 키로 유효한 확인 요청을 보낼 수 있다.

모든 검증 뒤 한 트랜잭션에서 Refund ACCEPTED·고정 금액·동의·종료 시각, 필요한 퇴실·사용량 차감, Ticket REVOKED, 기존 정지 기록 종료, SeatAssignment 해제와 최초 PaymentCancel을 저장한다. 0원은 PG 취소 요청 대신 Refund PAID와 0원 원장을 함께 기록한다. 저장 실패 시 전부 롤백하고 PG를 호출하지 않는다.

커밋 뒤 PG를 호출한다. 양수의 최초 정상 접수는 202이며 PG가 즉시 성공해도 접수 사실과 최신 상태 GET을 구분한다. 확실한 전송 전 실패·즉시 PG 거절도 202로 `decisionStatus=ACCEPTED`, `payoutStatus=ACTION_REQUIRED`, 현재 실패 시도·미지급 사유를 반환한다. 환불 신청 자체가 취소됐다는 502 응답을 사용하지 않는다. 응답 유실 뒤 같은 키로 재호출하면 최초 접수 응답을 반환하고 최신 환불금 지급 상태는 GET에서 확인한다. 0원은 200 PAID다.

### 중복 요청

환불 접수의 Idempotency-Key는 선택이며 1~128자 ASCII 비공백이다. 요청자+operation(CUSTOMER_REFUND/STORE_REFUND)+key unique, 해시는 대상·금액·trim 사유·종료/퇴실 동의를 포함한다. 같은 키·다른 내용은 409 IDEMPOTENCY_KEY_REUSED다. 반환 전 현재 권한을 다시 확인한다. 최초 생성 중이면 IDEMPOTENCY_REQUEST_IN_PROGRESS다. 키가 없어도 상품당 ACCEPTED Refund unique가 새 환불을 막는다. PG 취소 요청 실패 후 새 키로도 새 환불은 만들지 않는다.

## 5. PG 취소 재요청·별도 환불금 지급

이 절의 지급 재처리 경로는 MANAGER 전용이다. 고객·점주의 payout-retries 요청은 환불 상태나 사유 입력 여부와 관계없이 403 REFUND_FORBIDDEN으로 거부한다. 모든 경로에서 Idempotency-Key를 필수로 받는다. 누락은 IDEMPOTENCY_KEY_REQUIRED다. `refundId`로 권한·상태를 찾은 뒤 Refund 행을 잠그고 PG 활성 시도·별도 예약·환불금 지급액을 재검사한다. 확인되지 않은 PG·RESERVED·유효한 개별 조회 담당이 있는 실패 시도 또는 PG_RESULT_CONFLICT가 있으면 REFUND_PAYOUT_UNRESOLVED로 거부한다.

### POST /refund/:refundId/payout-retries

본문 `{ "reason":"PG 취소 다시 요청 사유" }`, trim 후 1~500자 필수. MANAGER만 기존 확정 실패의 원인을 조치한 뒤 직접 재시도할 수 있다. 고객·OWNER는 403 REFUND_FORBIDDEN, 운영자의 없는 환불은 404 REFUND_NOT_FOUND다. 별도 환불 신청은 요구하지 않는다. pg-check에서 미접수 또는 거절 확정이 확인돼 재전송한 뒤 이 API를 다시 호출하도록 요구하지 않는다.

공통 조건은 ACCEPTED·ACTION_REQUIRED, 모든 PG 결과 최종, paidAmount=0, 활성 별도 환불금 지급 없음이다. Refund 잠금 뒤 조건을 다시 확인하고 기존 Refund.amount의 새 PaymentCancel을 만들어 PENDING/PG로 바꾼다. 이전 FAILED 행·실패 사유·재전송 횟수는 변경하지 않는다. requestedById·requestedAt·retryReason으로 실행자·시각·사유를 보존한다. 이전 시도의 자동 재전송 한도 소진을 이유로 이 명시적 요청을 거부하지 않는다.

새 식별자를 발급한 PG 취소 요청은 새 PaymentCancel.id를 PG 멱등 키로 사용하고 resendCount=0부터 기존 자동 재전송 한도를 적용한다. 최초 전송은 커밋 뒤 즉시 수행한다. 새 식별자를 발급한 PG 취소 요청도 한도를 소진하고 PG 미접수가 확인되면 FAILED로 끝내며 다음 시도를 자동 생성하지 않는다. 같은 키 반복은 권한 확인 후 최초 응답을 반환하고, 다른 키 요청·다른 환불금 지급과 경쟁하면 Refund 잠금과 활성 시도 고유성으로 중복 생성을 막는다. 이미 일부 지급됐으면 REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL, 미확정 환불금 지급·예약은 REFUND_PAYOUT_UNRESOLVED로 거부한다. 응답 202 `{refundId,paymentCancelId,payoutStatus:"PENDING"}`는 환불금 지급 완료가 아니다.

#### 반복 요청·다른 키 동시 요청의 처리 순서

1. JWT에서 MANAGER 역할을 확인한다. 고객·OWNER는 환불 상태·사유 입력 여부와 관계없이 403 REFUND_FORBIDDEN이다. 운영자의 없는 환불은 404 REFUND_NOT_FOUND다.
2. 같은 요청자·PG 재시도 기능·Idempotency-Key의 처리 기록을 찾는다. 환불 번호와 trim한 사유가 같고 최초 응답이 저장돼 있으면 그 응답을 반환한다. 이때 최초 응답의 paymentCancelId를 그대로 사용하고 현재 시도가 REQUESTED라는 이유로 이미 수락한 요청의 반복을 거절하지 않는다. 내용이 다르면 409 IDEMPOTENCY_KEY_REUSED다. 최초 요청이 아직 응답 저장 전이면 기존 IDEMPOTENCY_REQUEST_IN_PROGRESS 규칙을 따른다.
3. 다른 키의 새 요청은 Refund를 잠그고 상태를 재검사한다. 지급 완료 등 운영 재처리 불가 상태는 409 REFUND_PAYOUT_NOT_ACTIONABLE, 미확정 PG 요청·활성 별도 지급 예약·유효한 조회 담당·PG_RESULT_CONFLICT는 409 REFUND_PAYOUT_UNRESOLVED로 거절한다. 미지급액이 남은 일부 지급은 409 REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL로 거절한다. 이 상태 오류는 새 실행 요청에만 적용하며 같은 키·같은 내용의 최초 응답 반환보다 앞서 검사하지 않는다.
4. 앞의 검사를 통과하면 ACCEPTED·ACTION_REQUIRED·모든 PG 결과 최종·paidAmount=0·활성 별도 지급 없음 조건을 확인하고 새 요청을 추가한다. 잠금·활성 취소 요청 고유 제약·PG 멱등 키로 중복 생성을 막는다. 거절하거나 최초 응답을 반환한 요청은 PaymentCancel 행과 PG 취소 호출을 추가하지 않는다.

최초 202 응답은 접수 당시 정보다. 반복 반환된 202를 PG 취소 완료로 해석하지 않고 최신 상태는 GET /refund/:refundId에서 확인한다.

### POST /refund/:refundId/manual-payouts

본문 `{ "amount":12000, "reason":"PG 원인 확인 후 별도 환불금 지급" }`. 모든 PG 취소 요청이 최종, ACTION_REQUIRED, outstandingAmount>0, 활성 예약 없음이 조건이다. amount는 현재 미지급액과 정확히 같아야 한다. Refund.payoutMethod=MANUAL과 RESERVED 지급을 함께 저장하고 다른 환불금 지급을 차단한다. 응답 201 `{refundId,payoutId,status:"RESERVED",amount}`. 이 API가 은행 송금을 실행하지 않는다.

### POST /refund/:refundId/manual-payouts/:payoutId/confirm

본문 `{ "amount":12000, "paidAt":"UTC ISO 시각", "externalTransactionId":"실제 지급 거래 키", "evidenceReference":"운영 증빙 참조" }`. RESERVED·해당 환불 귀속·예약과 같은 금액·유효한 환불금 지급 시각·증빙을 검증한다. externalTransactionId 1~200자, evidenceReference 1~1000자, paidAt은 미래 불가다. 실제 지급 사실을 운영자가 확인한 뒤에만 호출한다. 외부 거래 키는 지급 기관·거래 계정 범위를 포함해 전역으로 구별할 수 있는 정규화 식별값이다.

SUCCEEDED·Refund paidAmount 합산·미지급액 계산·원장을 같은 트랜잭션에서 처리한다. 부족액 지급이었다면 이 증빙 확정으로 부족 지급 검토도 함께 완료하고 검토자·시각·증빙을 남겨 reviewRequired=false로 바꾼다. 합계 충족·검토 완료면 PAID다. 같은 확정의 반복은 기존 결과를 반환하며 다른 환불에서 같은 지급 거래 키는 MANUAL_PAYOUT_REFERENCE_REUSED다. 수신 권한 없는 사람에게 증빙 원문을 노출하지 않는다.

### POST /refund/:refundId/manual-payouts/:payoutId/not-paid

본문 `{ "reason":"지급하지 않았음이 확인됨", "evidenceReference":"미지급 확인 근거" }`. RESERVED이고 실제 지급이 없다는 확실한 증빙이 있어야 FAILED로 종료한다. 환불금 지급 여부를 모르거나 단순 대기 시간 초과이면 처리하지 않는다. 예약 후 REFUND_MANUAL_CONFIRM_ALERT_SECONDS가 지나면 해당 예약의 최초 미확인 알림을 한 번 남기고 예약은 유지한다. 환불은 ACTION_REQUIRED, paidAmount·원장은 변화 없다. PG 재개는 MANAGER의 명시적 payout-retries로만 한다.

### POST /refund/:refundId/amount-review

본문 `{ "reason":"초과 지급 검토 결과", "evidenceReference":"확인 근거" }`. PG 실제액 초과로 reviewRequired=true·outstandingAmount=0이며 미확정 환불금 지급이 없어야 한다. 검토자·시각·사유를 보존하고 reviewRequired=false·PAID로 바꾼다. amount·paidAmount·PG 실제액·원장은 바꾸지 않는다. 부족액이 있으면 REFUND_AMOUNT_REVIEW_INCOMPLETE로 거부하고 부족액 지급 경로를 사용한다. 이 기능은 초과액 회수나 PG 결과 정정 API가 아니다.

## 6. 입실·저장 순서·원장

기존 입실 DTO와 소유권 검사 범위는 바꾸지 않는다. 세션 생성·첫 활성화 직전에 Ticket을 잠그고 REVOKED를 확인해 409 TICKET_TERMINATED로 거부한다. 환불금 지급 실패에도 허용하지 않는다. 기존 좌석 타입·배정·가용성 검사는 유지한다.

공유 잠금 순서는 Payment → Ticket → TicketPause → UsageSession → SeatAssignment → Refund → PaymentCancel → ManualRefundPayout이다. 필요한 행만 순서를 유지하고 같은 종류는 ID 순이다. PG 결과 저장·운영자 지급은 Refund 이후만 잠그며 Ticket으로 역행하지 않는다. PG 조회 담당 지정은 PaymentCancel만 갱신하고 끝내며 외부 조회 동안 잠금을 잡지 않는다. 담당 토큰·현재 상태를 결과 저장 때 다시 확인한다.

공통 환불금 지급 결과 처리는 PG 취소 요청의 최종 상태·실제액·Refund 합계·실제 지급 원장·필요 알림을 함께 저장한다. PG별 paymentCancelId, 별도 환불금 지급별 manualRefundPayoutId, 0원별 refundId unique로 중복을 막는다. 원장은 RELEASABLE·원래 orderId/shopId·실제액의 음수다. PG 실제액 불일치면 시도 SUCCEEDED·Refund ACTION_REQUIRED이며 불변 amount 대비 부족액/초과액을 표시한다. 실패·미확정·예약만으로 원장은 생기지 않는다.

## 7. PG 콜백 서명

두 콜백만 JWT 공개 경로로 두고 전용 PG 서명 가드를 필수 적용한다. 로그인 JWT는 서명을 대신하지 않는다. `NestFactory`의 `rawBody:true`로 파싱 전 바이트를 확보한다. 인증 전에 DTO 변환·JSON 재직렬화한 바디를 서명 검증에 사용하지 않는다. 운영 배포는 HTTPS를 사용하며 로컬 검증은 HTTP를 허용한다. `Content-Type: application/json`을 사용하고 압축 바디와 query string은 400 `PG_CALLBACK_FORMAT_INVALID`로 거부한다. 서명 대상 경로는 아래 고정 ASCII 경로다.

필수 인증 헤더는 `X-PG-Timestamp`(십진 Unix 초)와 `X-PG-Signature`(`v1=` 뒤 소문자 hex 64자) 두 개다. 중복 헤더·잘못된 형식은 인증 실패다. 단일 `PG_CALLBACK_SECRET`을 사용하며 Joi에서 최소 32자로 검증한다.

서명 계산에 사용하는 canonical은 다음 **UTF-8 문자열**이며 구분은 LF, 끝 LF는 없다. SHA256(rawBody)는 실제 수신 바이트의 소문자 hex다. JSON 키 순서·공백·개행을 바꾸지 않는다.

```text
v1\n{timestamp}\nPOST\n{path}\n{sha256(rawBody)}
```

`signature = "v1=" + hex(HMAC-SHA256(PG_CALLBACK_SECRET, canonical))`. 길이·형식을 확인한 뒤, 서명의 어느 위치가 다른지에 따라 비교 시간이 달라지지 않는 방식(상수 시간 비교)으로 검증한다. 서버 시각과 timestamp 차이의 절댓값은 **300초 이하**여야 한다. 실패는 401이고 업무 상태를 변경하지 않는다. secret·서명·개인정보 원문은 로그에 남기지 않는다.

300초 안에 같은 결과가 재전송되면 결제·취소 거래 식별자와 현재 상태를 확인하고 자동 취소·원장의 unique 제약을 적용해 중복 반영하지 않는다. 동일 거래 콜백이 반복돼도 발행·자동 취소·원장 기록은 한 번만 실행한다. 콜백 전용 이벤트 ID, DB 이벤트 테이블, 처리한 이벤트 식별자를 별도로 남기는 기록(tombstone)은 추가하지 않는다. 모순되는 늦은 결과는 최종 상태를 유지하고 거래 로그에 남긴다. DB 커밋 실패는 503으로 응답하여 PG가 재전송하게 한다.

유효 기간이 지난 재전송은 이미 처리했더라도 401이다. PG는 **같은 거래 결과·같은 raw body**에 새 timestamp로 다시 서명한다. PG에서 실제 결제·취소가 발생한 시각과 통보를 발송하며 서명한 시각은 구분한다.


### POST /payments/callback

기존 본문 `{success,pgTransactionId,amount,reason?}`를 유지한다. 금액·식별자를 검증한 뒤 정상 승인에는 기존 발행 흐름을 실행한다. 승인액 불일치면 실제 승인액 저장·결제 FAILED·이용권 미발행·좌석 선점 해제·PAYMENT 대상 Refund ACCEPTED와 최초 PaymentCancel을 같은 트랜잭션에 저장한다. 좌석 배정 실패는 상품 대상 Refund·이용 종료·배정 해제를 같은 방식으로 저장한다. 같은 승인 사건은 한 번만 반영하고 콜백은 200 수신 확인한다.

### POST /refund/callback

```json
{ "success":true, "paymentCancelId":"UUID", "pgTransactionId":"PG 취소 거래 ID", "orderItemId":"UUID", "amount":5000, "reason":null }
```

기존 필드와 서명을 유지한다. orderItemId만 선택/null이며 저장된 PaymentCancel→Refund 대상과 일치해야 한다. PAYMENT 대상은 null이어야 한다. PG 취소 거래 ID를 원승인 ID와 구별하고 전역 unique로 검증한다. 성공 amount는 실제액이며 누락·비정수면 거부한다. 금액 불일치도 실제 PG 취소 요청 성공으로 반영하고 Refund는 조치 필요로 둔다. 미확정 시도에만 결과를 한 번 반영하며 모순되는 최종 통보는 운영자 알림·대사 대상으로 남긴다. 결과 확인 불명 상태에서 성공으로 꾸미지 않는다.

## 8. PG 요청·조회·복구

요청 결과는 NOT_SENT / ACCEPTED / UNKNOWN / SUCCEEDED / REJECTED다. NOT_SENT·REJECTED는 시도 FAILED·Refund ACTION_REQUIRED이며 이용 종료는 유지한다. ACCEPTED·UNKNOWN은 REQUESTED로 조회한다.

조회는 SUCCEEDED{pgTransactionId,cancelledAmount}, FAILED{reason}, IN_PROGRESS, NOT_FOUND{authoritative:true}, QUERY_ERROR{reason}다. 실제액 누락·인증 오류·일반 HTTP 404·PG 조회 반영 지연은 QUERY_ERROR로 다룬다. 백그라운드 자동 작업은 PG가 미접수를 확실히 확인한 NOT_FOUND일 때만 모든 경로에서 같은 시도 ID·금액으로 한도 내 재전송한다. 자동 작업은 한도를 모두 소진한 뒤 PG 미접수가 확인된 경우에만 해당 시도를 FAILED/RETRY_EXHAUSTED로 종료하고 Refund를 ACTION_REQUIRED로 바꾼다. 개별 확인의 재전송은 아래 별도 규칙으로 처리한다. 한도 소진 후 결과 불명·PG 처리 중이면 조회를 계속한다. IN_PROGRESS는 연속 오류를 초기화하고 다시 조회한다.

자동 PG 처리는 Refund의 ACCEPTED·PENDING·PG, 별도 환불금 지급 활성 예약 없음, PaymentCancel의 REQUESTED/QUERY_FAILED를 함께 확인한다. FAILED 시도는 조회·재전송에서 제외하며 nextInquiryAt과 담당 토큰·기한을 지운다. ACTION_REQUIRED 환불은 운영자 목록에 남는다. MANAGER가 payout-retries를 명시적으로 호출하면 취소 요청을 새 PG 취소 요청 식별자로 기록하고 PENDING/PG로 바꾼다. 기존 실패 시도는 그대로 보존한다.

QUERY_ERROR가 연속 한도에 도달하면 QUERY_FAILED다. 하나의 RefundRecoveryControl로 900초마다 가장 오래된 1건을 확인하고 정상 응답 뒤 20건씩 재조회한다. 오류 재발 시 1건 확인으로 돌아간다. MANAGER 재개는 동일 제어 행·시도 담당 토큰을 사용한다.

`GET /refund/recovery/status`는 `{mode,running,requestedCount,queryFailedCount,actionRequiredCount,reservedManualCount,oldestQueryFailedAt,nextProbeAt}`를 반환한다. `POST /refund/recovery/resume`은 본문 없음/{}이고 202 SCHEDULED, 이미 실행 중이면 200 ALREADY_RUNNING, 대상 없으면 200 NO_WORK다. 금액·개별 최종 상태를 입력받지 않는다.

작업 기한 경과는 환불금 중복 지급 허용 근거가 아니다. 미확정 시도와 RESERVED가 있으면 다른 환불금 지급을 막는다. 서버 재시작 시 DB 시도·예약·확정된 환불 금액을 복원하고 PG 미확정은 조회부터 한다. RESERVED는 담당자가 확인하도록 남긴다.

### 개별 확인: POST /refund/:refundId/pg-check

현재 ShopOwner인 OWNER 또는 MANAGER만 호출한다. 다른 매장/없는 환불은 404 REFUND_NOT_FOUND, USER는 403 REFUND_FORBIDDEN, 미로그인은 401이다. 본문 없음/{}이며 금액·시도 ID·결과를 입력받지 않는다. 미확정 시도의 PG 미접수 또는 이미 실패한 시도의 미접수·거절 확정이 확인되면 이 요청 안에서 재전송까지 진행하므로 별도 버튼이나 사유 입력을 요구하지 않는다. Idempotency-Key는 필수가 아니며 Refund 잠금·시도 담당 토큰·최근 조회 간격·활성 시도 고유성으로 반복·동시 실행을 제어한다.

- 일반 대상은 ACCEPTED·PENDING·PG이고 별도 환불금 지급 예약이 없는 환불의 REQUESTED/QUERY_FAILED 시도 한 건이다. 최근 시도가 FAILED이고 실패 사유가 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED인 ACCEPTED·ACTION_REQUIRED·PG 환불도 실제 환불금 지급액 0·다른 미확정 환불금 지급 없음·별도 예약 없음이면 개별 확인 대상이다. 다른 확정 실패·환불금 지급 완료·0원·별도 환불금 지급 예약·금액 불일치 검토·과거 거절 이력은 저장 상태만 반환한다. 예약을 실패 종료해 MANUAL인 환불도 pg-check 재전송 대상이 아니며 PG 재개는 MANAGER의 payout-retries로만 한다.
- PG_RESULT_CONFLICT가 있으면 재전송·새 식별자를 발급한 PG 취소 요청 생성 없이 저장된 확인 필요 상태를 반환한다. 권한과 대상을 확인한 뒤 Refund → PaymentCancel 순서로 잠근다. 같은 환불의 전송·조회 담당이 유효하면 ALREADY_RUNNING, 작업은 끝났으나 lastInquiryAt부터 REFUND_QUERY_INTERVAL_SECONDS가 지나지 않았으면 RECENT_RESULT다. 그 외에는 담당 토큰·기한·조회 시작 시각을 저장하고 트랜잭션 밖에서 PG에 조회한다. 자동 조회 일정이나 자동 재전송 횟수 때문에 실행을 막지 않는다.
- 결과 저장 때 Refund → PaymentCancel을 다시 잠그고 토큰·현재 환불금 지급 상태·다른 환불금 지급·예약을 재검사한다. 콜백이나 다른 작업이 먼저 확정했다면 저장 상태를 반환한다. 새 식별자를 발급한 PG 취소 요청 생성과 별도 환불금 지급 예약 경로도 FAILED 시도에 유효한 개별 조회 담당이 있는지 검사한다.
- 일반 미확정 시도의 SUCCEEDED는 실제액·원장을, FAILED는 시도 실패·조치 필요·알림을 반영한다. 금액 불일치는 기존 규칙을 따른다. IN_PROGRESS·QUERY_ERROR에는 취소를 보내지 않고 기존 조회 일정·오류 규칙을 적용한다. 미확정 요청의 조회에서 거절이 새로 확인돼도 같은 실행에서 새 요청을 생성하지 않는다. 정상 조회 응답은 연속 오류와 lastInquiryError를 초기화한다.
- authoritative NOT_FOUND이면 자동 재전송 횟수와 관계없이 즉시 다시 보낸다. 미확정 시도는 기존 PaymentCancel.id를 PG 멱등 키로 사용하고 기존 amount를 보낸다. manualResendCount·sendAttemptCount·lastSendAttemptAt·갱신한 담당 기한을 저장한 뒤 커밋 밖에서 전송한다. 자동 횟수 resendCount는 검사·초기화·증가하지 않는다. 실행자·시각·개별 확인에 따른 재전송임을 거래 로그에 남긴다.
- 최근 시도가 이미 FAILED이고 실패 사유가 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED인 환불을 조회해 authoritative NOT_FOUND 또는 거절 확정이 확인되면 기존 실패 상태·사유·횟수를 보존한다. 거절 확정은 PG가 해당 요청을 거절했고 그 요청으로 취소가 실행되지 않았으며 앞으로도 진행되지 않는다고 확정 응답한 경우다. 오류 문자열만으로 실행 여부가 불명확하면 거절 확정이 아니다. 실제 지급액 0·다른 미확정 지급 없음·payoutMethod=PG·활성 별도 예약 없음·유효한 자기 담당 토큰을 확인하고 같은 Refund.amount의 새 PaymentCancel을 생성해 PENDING/PG로 바꾼다. 작업 시작 때 다른 유효 담당이 없어야 한다. 새 PaymentCancel.id를 PG 멱등 키로 사용하고 resendCount=0·manualResendCount=0부터 시작한다. requestedById·requestedAt·retryReason에 실행자·시각·개별 확인에서 미접수 또는 거절 확정 후 재시도임을 기록하고 lastInquiryAt을 승계한다. 조회 담당 해제·새 전송 담당 부여를 함께 저장하고 커밋 뒤 즉시 전송한다. 별도 버튼·사유 입력·payout-retries 호출은 요구하지 않는다.
- 앞의 세 실패 사유로 이미 FAILED인 시도의 재조회가 QUERY_ERROR이면 결과 확인 불가를 안내하고 취소 요청 기록을 새로 추가하지 않는다. 기존 실패 이력은 유지한다. 성공·처리 중 등 기존 확정 실패와 모순되는 결과는 기존의 모순 결과 처리 원칙에 따라 actionCode=PG_RESULT_CONFLICT와 운영자 알림을 기록하고 추가 환불금 지급을 차단한다. 이런 모순을 무시하고 취소 요청 기록을 새로 추가하지 않는다.
- 재전송 결과는 NOT_SENT / ACCEPTED / UNKNOWN / SUCCEEDED / REJECTED의 기존 처리 규칙을 따른다. 결과 불명은 자동 조회로 이어가며 전송 전후 중단·담당 기한 경과 뒤에는 조회부터 처리한다. 자동 작업은 resendCount와 자동 한도를 계속 적용한다. 개별 확인으로 다른 환불을 조회하거나 RefundRecoveryControl을 변경하지 않는다.

응답은 `{checkStatus,inquiryResult,resendResult,lastInquiryAt,lastInquiryFailed,refund}`다. refund는 권한에 맞춘 최신 정보다. inquiryResult는 이번 조회 결과, resendResult는 이번 재전송 또는 한도 소진·전송 전 실패·PG 거절로 실패 확정 후 새 PG 취소 요청 식별자로 보낸 취소 요청의 최초 응답이며 수행하지 않았으면 각각 null이다. lastInquiryFailed는 저장한 마지막 조회 오류 유무로 계산한다. 운영 전용 원문 오류·증빙은 점주에게 추가 노출하지 않는다.

| HTTP·checkStatus | 의미 |
|---|---|
| 200 CHECKED | 조회와 필요한 재전송 결과를 반영함. 처리 중·조회 오류·전송 후 응답 없음도 포함하므로 환불금 지급 완료를 뜻하지 않음 |
| 202 ALREADY_RUNNING | 이 환불의 전송·조회가 진행 중. 추가 PG 호출 없이 현재 상태 반환, 이후 GET 상세에서 결과 확인 |
| 200 RECENT_RESULT | 최근 조회 간격 안의 반복 실행. 최근 시각·저장 상태 반환 |
| 200 NO_PENDING_ATTEMPT | 개별 PG 조회 대상이 아님. 저장 상태와 필요한 조치 반환. RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED의 FAILED 시도는 재전송 허용 조건을 만족하면 이 사유로 제외하지 않음 |

### 운영 설정

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

ConfigService/Joi로 `lease>timeout`, `interval>=sweep+timeout`, `backoffCap>=backoffBase`를 검증한다. 일반 시간·횟수는 양의 정수, resend 한도는 0 이상이다. 간격은 `min(base×2^(연속오류-1),cap)`다. 환경 변경은 순차 재시작으로 적용하며 진행 상태는 초기화하지 않는다. 별도 설정 API는 없다. SC-004의 75초 목표는 최종 PG 결과·무적체 조건의 시도 결과 판명 시간이며 전체 미지급 해결 시간을 보장하지 않는다.

## 9. 내역·알림

목록 쿼리는 payoutStatus?,decisionStatus?,page=1,limit=20(1~100), MANAGER에는 actionRequiredOnly?를 허용한다. 정렬은 requestedAt DESC,id DESC다. `/me`는 본인 주문으로 고정하고 다른 userId는 받지 않는다. 범위 안 빈 목록은 200, 범위 밖/없는 대상은 404다. 미지급 ACTION_REQUIRED와 미확정 RESERVED를 완료 목록으로 숨기지 않는다.

알림은 refundId·선택 지급 식별자·kind·audience·shopId·message·createdAt·isRead/readAt을 반환한다. unreadOnly=false,page,limit,audience?를 사용하며 현재 역할·ShopOwner 수신 범위를 적용한다. 동일 사건 알림과 읽음은 사용자별로 중복을 막는다. 읽음 PATCH는 빈 본문/{}이며 반복 요청은 최초 readAt을 유지한다.

| 사건 | 수신자 |
|---|---|
| CUSTOMER PG 취소 요청 실패·조치 필요 | 고객 본인·현재 매장 점주·MANAGER |
| STORE PG 취소 요청 실패·조치 필요 | 현재 매장 점주·MANAGER |
| SYSTEM PG 취소 요청 실패·조치 필요 | MANAGER |
| QUERY_FAILED·금액 불일치·별도 환불금 지급 장기 미확인 | MANAGER |

## 10. 오류 코드

| 상황 | HTTP | error.code |
|---|---:|---|
| DTO 형식·미허용 필드·음수/소수/문자열 금액 | 400 | BadRequestException |
| JWT 없음·만료 | 401 | 기존 UnauthorizedException / DomainUnauthorizedError |
| 역할·운영 권한 부족 | 403 | REFUND_FORBIDDEN |
| 본인/매장 범위에 없는 이용권 | 404 | TICKET_NOT_FOUND |
| 결제 성공 아님 | 409 | PAYMENT_NOT_COMPLETED |
| 환불금 지급 완료 환불 존재 | 409 | ALREADY_REFUNDED |
| 확정 미지급 환불 존재 | 409 | REFUND_IN_PROGRESS |
| 고객 사용 이력 / 미사용 기한 초과 | 409 | USED_TICKET / EXPIRED_TICKET |
| 종료·금액 동의 누락 | 400 | REFUND_TERMINATION_CONSENT_REQUIRED |
| 매장 금액 상한 초과 | 400 | REFUND_AMOUNT_EXCEEDED |
| 미사용 전액 원칙 위반 | 400 | UNUSED_TICKET_FULL_REFUND_REQUIRED |
| 필수 사유 누락 | 400 | REFUND_REASON_REQUIRED |
| 이용 중 퇴실 동의 없음 | 409 | TICKET_IN_USE |
| 이용 종료 이용권 입실·재개·타입 변경 | 409 | TICKET_TERMINATED |
| 범위 밖/없는 매장·사용자·환불·알림 | 404 | SHOP_NOT_FOUND / USER_NOT_FOUND / REFUND_NOT_FOUND / NOTIFICATION_NOT_FOUND |
| 같은 키 다른 요청 / 최초 처리 중 | 409 | IDEMPOTENCY_KEY_REUSED / IDEMPOTENCY_REQUEST_IN_PROGRESS |
| 운영 변경의 멱등 키 없음 | 400 | IDEMPOTENCY_KEY_REQUIRED |
| PG 결과 미확정·활성 별도 환불금 지급 예약 | 409 | REFUND_PAYOUT_UNRESOLVED |
| 환불금 지급 완료·운영 재처리 불가 상태 | 409 | REFUND_PAYOUT_NOT_ACTIONABLE |
| 일부 지급 후 PG 전액 재시도 | 409 | REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL |
| 예약액이 미지급액 또는 확정액과 다름 | 400 | REFUND_OUTSTANDING_AMOUNT_MISMATCH |
| 없는/다른 환불 귀속 환불금 지급 예약 | 404 | MANUAL_PAYOUT_NOT_FOUND |
| 이미 실패·완료된 예약의 상충 변경 | 409 | MANUAL_PAYOUT_STATE_CONFLICT |
| 다른 환불금 지급에서 외부 거래 식별자 재사용 | 409 | MANUAL_PAYOUT_REFERENCE_REUSED |
| 실제 지급·확실한 미지급 증빙 누락 | 400 | MANUAL_PAYOUT_EVIDENCE_REQUIRED |
| 부족액 존재·초과 검토 조건 미충족 | 409 | REFUND_AMOUNT_REVIEW_INCOMPLETE |
| 서명 누락·형식·불일치 / 시각 초과 | 401 | PG_CALLBACK_UNAUTHORIZED / PG_CALLBACK_EXPIRED |
| 콜백 형식·압축·쿼리 위반 | 400 | PG_CALLBACK_FORMAT_INVALID |
| 콜백 대상 없음 / 거래 연결 불일치 | 404 / 409 | PG_CALLBACK_TARGET_NOT_FOUND / PG_CALLBACK_TARGET_MISMATCH |
| 저장·담당 지정 실패 | 503 | REFUND_STORAGE_UNAVAILABLE |
| 예상 못 한 오류 | 500 | INTERNAL_SERVER_ERROR |

전송 전 실패·PG 거절은 접수 후 PG 취소 요청 결과이며 HTTP 신청 거절 코드가 아니다. `actionCode`는 SEND_FAILED, PG_REJECTED, RETRY_EXHAUSTED, AMOUNT_MISMATCH, MANUAL_CONFIRMATION_REQUIRED 등을 사용한다. PG 내부 오류 원문은 운영 상세에만 보관한다. NOT_TICKET_OWNER는 폐지, TICKET_REVOKED 강제 폐기는 범위 밖이다.

## 11. 추적·전환

| FR | 계약 |
|---|---|
| 001~007a | 판정·동의·기존 이력(3~4절) |
| 008~016a | 매장 권한·금액·퇴실·종료 확정(4절) |
| 017 | 환불금 지급 결과와 무관한 종료 이용권 차단(6절) |
| 018~020 | 실제 지급별 원장(6절) |
| 021~029,026a | PG 취소 요청·재조회·모든 경로 재전송·중복 방지(8절) |
| 030~032 | 자동 취소·PG 서명(7절) |
| 033~039 | 권한·응답·내역·알림(1~3,9절) |
| 040~042 | 종료 동의·원자적 이용 종료·복구 금지(4,6절) |
| 043~051 | 미지급 운영·별도 환불금 지급·검토·계속 추적(5,8~10절) |

기존 클라이언트는 요청 동의·응답 refundId/payoutStatus·상세 키를 함께 바꿔 배포한다. 기존 PG 미확정이 남으면 데이터 전환을 차단하고 결과를 추측하지 않는다. 과거 승인 대기/실패는 LEGACY_REJECTED/NOT_APPLICABLE로 보존해 새 환불의 이용 종료와 구별한다. 실제 PG 서명·미접수 확정·최종 실패·PG 멱등 보장은 실연동 때 검증해야 한다.
