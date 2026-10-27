# 환불 데이터 모델: 이용 종료와 지급 분리

**기준**: [spec.md](spec.md), 정책 v0.4 · **갱신일**: 2026-10-27

현재 Prisma 스키마가 아니라 구현 예정 설계다. 기존 PaymentCancel·RefundLock 중심 설계를 아래 구조로 바꾼다.

## 1. 모델별 역할

| 모델 | 역할 |
|---|---|
| Refund | 이용 종료와 확정된 환불 금액을 보관하는 업무 기록, PG 취소 요청 실패 후에도 유지 |
| PaymentCancel | PG에 보내는 취소 요청의 번호·금액·처리 결과·재전송 이력. Refund 1:N |
| ManualRefundPayout | 운영자의 별도 환불금 지급 예약·증빙·실제 환불금 지급 기록, Refund 1:N |
| Ledger | PG 결제 취소·별도 환불금 지급의 실제 금액 기록, 같은 지급은 1건 |
| RefundRecoveryControl | 여러 서버의 PG 장애 복구 조회 담당 조정 |
| RefundNotification / RefundNotificationReceipt | 사건 알림과 사용자별 읽음 |

`Refund`는 확정된 환불 금액과 이용 종료를 보관한다. `PaymentCancel`은 PG에 보내는 취소 요청을 번호별로 보관한다. 실패가 확정된 요청을 대신해 새 PG 취소 요청 식별자로 PG에 취소를 요청할 때는 이전 실패 기록을 보존하고 `PaymentCancel` 행을 하나 추가한다. 이때 기존 `Refund`와 확정된 환불 금액은 유지한다. 기존 요청을 기존 PG 취소 요청 식별자로 재전송할 때는 행을 추가하지 않는다.

환불 1건과 PG 취소 요청 1건을 같은 레코드로 사용하지 않는다. 기존 RefundLock은 새 접수에 생성하지 않는다. 상품당 확정 Refund unique와 Ticket 행 잠금이 새 환불 중복을 막고, Refund 잠금과 활성 지급 고유성이 지급 중복을 막는다. 기존 RefundLock 데이터는 전환 검증 후 정리한다.

## 2. Payment·대상 구분

Payment에 `approvedAmount Int?`를 추가한다. 기존 amount는 원래 요청액이며 덮어쓰지 않는다. 승인액 불일치에서도 인증된 실제 승인액을 보존하고 업무상 FAILED로 남긴다.

| 경로 | Refund.targetKind | orderItemId | 금액 | 이용 종료 |
|---|---|---|---|---|
| CUSTOMER | ORDER_ITEM | 필수 | 상품 실결제액 전액 | 환불 확정 시 |
| STORE | ORDER_ITEM | 필수 | 전액 또는 점주 입력액 | 환불 확정 시 |
| 좌석 배정 실패 SYSTEM | ORDER_ITEM | 필수 | 상품 실결제액 | 이미 발행됐다면 환불 확정 시 종료 |
| 승인 금액 불일치 SYSTEM | PAYMENT | null | 실제 승인액 전액 | 이용권을 발행하지 않음 |

결제 전체 취소에 가짜 상품·이용권을 만들지 않는다. Payment → Refund 관계로 원래 주문·매장을 확인한다. 같은 승인 사건의 자동 환불은 대상별 고유 키로 한 번만 생성한다.

## 3. Refund

| 필드 | 타입·제약 | 의미 |
|---|---|---|
| id | UUID PK | PG 취소 요청이 바뀌어도 유지되는 환불 식별자 |
| paymentId / orderItemId | FK, 상품 ID는 PAYMENT에서 null | 원래 결제·상품 |
| targetKind | ORDER_ITEM / PAYMENT | 취소 대상 |
| source | CUSTOMER / STORE / SYSTEM / LEGACY_UNKNOWN | 경로·알림·이력 |
| decisionStatus | ACCEPTED / LEGACY_REJECTED | 새 환불은 ACCEPTED만, 기존 거절 이력만 별도 구분 |
| policyVersion | String | 신규 v0.4, 과거 증거 기반 이관은 LEGACY |
| amount | Int, 0 이상, 확정 뒤 불변 | 확정된 환불 금액 |
| paidAmount | Int, 0 이상 | 성공 PG 취소 요청·별도 환불금 지급의 실제액 합계, 잠금 아래 갱신 |
| payoutStatus | PENDING / ACTION_REQUIRED / PAID / NOT_APPLICABLE | 마지막 값은 LEGACY_REJECTED만 |
| payoutMethod | PG / MANUAL | 현재 지급 경로, RESERVED 동안 MANUAL 고정 |
| reviewRequired | Boolean | PG 금액 불일치 검토가 남았는지 |
| reviewedById / reviewedAt / reviewReason / reviewEvidenceReference | User FK? / DateTime? / String? / String? | 부족액 지급 확정 또는 초과액 검토의 실행자·시각·사유·근거 |
| actionCode / actionReason | String? | 미지급·확인·불일치 등 조치 사유 |
| requestedAt / acceptedAt | DateTime, acceptedAt은 과거 거절에서만 null | 신청·업무 확정 시각 |
| terminatedAt | DateTime? | 이용권 있는 신규 환불은 필수, 이용권 없는 결제 취소는 null |
| requestedById | User FK?, SYSTEM·증거 없는 과거만 null | 실행자 |
| terminationConsentedAt / exitConsentedAt | DateTime? | 신규 CUSTOMER/STORE는 종료 동의 필수, 이용 중 STORE는 퇴실 동의도 필수 |
| reason / endedSessionId | String? / Session FK? | 점주 사유·실제 종료 세션 |
| paidAt / updatedAt | DateTime? / DateTime | 전체 환불금 지급 완료·마지막 변경 |

`outstandingAmount=max(amount-paidAmount,0)`, `overpaidAmount=max(paidAmount-amount,0)`는 응답에서 계산한다. PG 취소 완료는 PG가 확인한 실제액이며 고객 은행 반영 시각을 의미하지 않는다. PAID는 부족액 0, 미확정 환불금 지급 없음, reviewRequired=false일 때만 가능하다. PG 부족액을 예약대로 실제 지급하고 증빙을 확정하면 그 담당자·시각·증빙을 부족 지급 검토 기록으로도 남겨 reviewRequired를 함께 해제한다. 초과 지급은 운영자 검토 후 실제액을 유지한 채 PAID가 될 수 있다.

신규 acceptedAt·terminatedAt은 같은 확정 트랜잭션의 시각을 사용한다. 이용권의 기존 expiresAt·remainingMinutes를 환불금 지급 실패로 복원하거나 연장하지 않는다. 이미 정지 중이었다면 재개 없이 해당 정지 기록을 닫고 종료 사유를 보존한다.

## 4. PaymentCancel: PG 취소 요청

기존 테이블과 PK·PG 취소 거래 ID unique를 유지하고 `refundId`를 추가한다. 실제 구현 전에는 기존 orderItemId·paymentId 연결도 유지해 검증·이관한다. 새 행의 연결은 Refund와 같아야 한다.

| 필드 | 설계 |
|---|---|
| refundId | 새로 추가하는 취소 요청 기록은 필수 FK. 보존할 과거 거절 이력만 이관 기간 null 허용 |
| amount / actualAmount | 고정 요청액 / 확인 전 null인 실제 PG 취소액 |
| status | REQUESTED / QUERY_FAILED / SUCCEEDED / FAILED |
| attemptNumber / requestedAt | 환불 안의 증가하는 시도 번호 / 생성 시각 |
| pgTransactionId | PG 취소 거래 ID, 고유, 승인 거래와 별개 |
| failureCode / failureReason / failedAt | 확정 시도 실패, Refund 실패·철회가 아님 |
| cancelledAt / updatedAt | 실제 PG 성공 확정 / 최종 갱신 |
| resendCount | 백그라운드 자동 재전송 횟수, 최초 전송과 개별 확인에 따른 재전송은 제외 |
| manualResendCount | 개별 확인에서 PG 미접수를 확인한 뒤 기존 미확정 시도를 다시 보낸 횟수, 자동 한도와 별도 |
| inquiryCount / inquiryFailureCount | 총 조회·연속 조회 오류 횟수 |
| lastInquiryAt / nextInquiryAt / lastInquiryError | 조회 일정·장애 상세 |
| queryFailedAt / recoveryGeneration | 확인 실패 진입 시각·알림 중복 방지 세대 |
| lastSendAttemptAt / sendAttemptCount | 전송 직전 저장하는 시각·횟수 |
| claimToken / claimUntil | 개별 작업자의 담당 토큰·처리 기한 |
| requestedById / retryReason | 최초 시스템 실행 또는 권한 있는 점주·운영자의 재시도 감사 정보 |

신규 PG 취소 요청 amount는 Refund.amount와 같아야 하고, 기존 실제 환불금 지급 합계는 0이어야 한다. 일부 PG 결제 취소가 있으면 PG 전액 재시도 대신 부족액 별도 환불금 지급만 허용한다. 같은 미확정 시도의 재전송은 같은 PaymentCancel.id를 PG 멱등 키로 사용한다. 확정 실패 뒤 권한 있는 사람의 명시적 재시도는 새 PaymentCancel.id를 사용한다.

최근 시도가 이미 FAILED이고 실패 사유가 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED인 환불도 점주·운영자의 개별 조회 대상이다. 해당 실패 시도의 식별자로 PG에 다시 조회해 미접수 또는 거절 확정이 확인되면 Refund 잠금 아래 실제 지급액 0·다른 미확정 지급 없음·payoutMethod=PG·활성 별도 예약 없음·유효한 자기 담당 토큰을 확인하고 기존 Refund.amount의 새 PaymentCancel을 만든다. 작업 시작 때 다른 유효 담당이 없어야 한다. 거절 확정은 PG가 해당 요청을 거절했고 그 요청으로 취소가 실행되지 않았으며 앞으로도 진행되지 않는다고 확정 응답한 경우다. 오류 문자열만으로 실행 여부가 불명확하면 거절 확정이 아니다. 이전 FAILED 행의 상태·사유·횟수는 보존한다. 새 행의 requestedById는 개별 확인 실행자, retryReason은 개별 확인에서 미접수 또는 거절 확정 후 재시도임을 기록한다. 별도 사유 입력은 요구하지 않는다. 새 행은 resendCount=0·manualResendCount=0이고 lastInquiryAt을 승계한다. 조회 오류이면 실패 이력을 보존하고 새 요청을 만들지 않으며, 처리 중·취소 성공 등 모순 결과는 PG_RESULT_CONFLICT·운영자 알림과 추가 지급 차단으로 처리한다. 미확정 요청의 조회에서 새로 확인한 거절은 실패·조치 필요만 기록한다. MANUAL 예약 실패 종료 후 PG 재개는 운영자 직접 재시도로만 한다. 새 요청 최초 전송과 이후 자동 재전송을 구분하며 자동 작업에는 기존 미접수·한도 조건을 적용한다.

PaymentCancel의 FAILED는 현재 스키마에도 있지만 기존 설명은 PG의 확정 거절 중심이다. 새 구현에서는 확인된 전송 전 실패·재전송 한도 소진 후 PG 미접수 확인까지 포함하도록 의미와 주석을 확장한다. SEND_FAILED·PG_REJECTED·RETRY_EXHAUSTED 실패 사유를 추가하고 기존 사유는 과거 이력 해석을 위해 보존한다. Refund와 그 payoutStatus=ACTION_REQUIRED는 아직 현재 Prisma 스키마에 없는 신규 설계다.

## 5. ManualRefundPayout: 별도 환불금 지급

| 필드 | 의미·제약 |
|---|---|
| id / refundId | UUID PK / Refund FK |
| status | RESERVED / SUCCEEDED / FAILED |
| amount | 예약 시 Refund 미지급액과 같고 이후 불변, 양수 |
| reservedById / reservedAt / reason | MANAGER 실행자·예약 시각·사유 |
| confirmedById / confirmedAt / paidAt | 확정 담당자·확정 시각·실제 환불금 지급 시각 |
| externalTransactionId | 실제 지급 거래 식별자, 성공 기록에서 전역 unique |
| evidenceReference | 권한 있는 운영자가 확인할 수 있는 환불금 지급 증빙 참조 |
| notPaidEvidence / failureReason | 확실한 미지급으로 예약을 종료할 근거 |

RESERVED를 만들기 전에 Refund를 잠그고 모든 PG 취소 요청이 최종 상태인지, reviewRequired 초과 지급이 아닌지, 다른 예약이 없는지 확인한다. 이 예약에는 TTL 자동 해제가 없다. 실제 환불금 지급 여부가 모르면 RESERVED를 유지하고 알린다. 완료 기록에는 예약과 같은 금액·거래 식별자·환불금 지급 시각·증빙을 필수로 받는다. 실제 송금 API는 구현하지 않는다.

## 6. 고유성·검사 제약

- Refund: `orderItemId WHERE decisionStatus='ACCEPTED' AND targetKind='ORDER_ITEM'` unique. PAYMENT는 paymentId에 같은 조건의 unique. 동일 결제의 상충 대상은 Payment 잠금 아래 검증한다.
- PaymentCancel: `(refundId,attemptNumber)` unique, `refundId WHERE status IN ('REQUESTED','QUERY_FAILED')` partial unique, pgTransactionId unique.
- ManualRefundPayout: `refundId WHERE status='RESERVED'` partial unique, externalTransactionId unique.
- PG 활성 시도와 별도 환불금 지급 예약 사이의 교차 제약은 두 테이블의 인덱스만으로 보장되지 않는다. 모든 생성 경로가 Refund를 잠근 뒤 payoutMethod와 상대 테이블을 재검증해야 한다.
- amount·actualAmount·paidAmount·횟수는 음수 금지. ORDER_ITEM은 상품 필수, PAYMENT는 상품 null·SYSTEM만. 신규 CUSTOMER/STORE는 실행자·종료 동의 필수다.
- 상태를 PAID로 바꾸는 모든 경로는 미지급액 0·미확정 환불금 지급 없음·검토 완료를 같은 트랜잭션에서 검사한다. DB CHECK가 다른 테이블 합계를 검증한다고 가정하지 않는다.
- DB 멱등 요청은 `(requesterId,operation,key)` unique와 requestFingerprint를 갖는다. 생성 중 요청과 완료 응답을 구분하고 같은 키·다른 본문을 거부한다.

## 7. 상태 전이·트랜잭션

| 사건 | Refund | PaymentCancel / 별도 환불금 지급 | 이용권·좌석 |
|---|---|---|---|
| 검증·동의 거절 | 생성 안 함 | 생성 안 함 | 변경 없음 |
| 양수 환불 확정 | ACCEPTED/PENDING | 최초 REQUESTED 저장 | REVOKED·퇴실·배정 해제 |
| 0원 환불 확정 | ACCEPTED/PAID | PG 취소 요청 없음, 원장 0원 | 같은 확정 처리에서 종료 |
| PG 응답 없음·처리 중 | PENDING | REQUESTED | 종료 유지 |
| 조회 연속 실패 | PENDING | QUERY_FAILED | 종료 유지 |
| PG 미접수, 한도 내 | PENDING | 같은 ID로 재전송 | 종료 유지 |
| 전송 전 실패·거절·한도 초과 | ACTION_REQUIRED | FAILED | 종료 유지 |
| 확정된 환불 금액과 같은 PG 결제 취소 성공 | PAID | SUCCEEDED·actualAmount | 종료 유지 |
| PG 실제액 불일치 | ACTION_REQUIRED·reviewRequired | SUCCEEDED·실제액 원장 | 종료 유지 |
| 운영자 직접 재시도 또는 점주·운영자의 실패 확정 건 개별 확인 재전송 | PENDING/PG | 새 REQUESTED, 이전 실패는 보존 | 종료 유지 |
| 별도 환불금 지급 예약 | ACTION_REQUIRED/MANUAL | RESERVED | 종료 유지 |
| 증빙 있는 별도 환불금 지급 성공 | 미지급액 0·검토 완료면 PAID | SUCCEEDED·실제액 원장 | 종료 유지 |
| 별도 환불금 지급 여부 모름 | ACTION_REQUIRED/MANUAL | RESERVED 유지 | 종료 유지 |
| 확실한 별도 미지급 | ACTION_REQUIRED | FAILED, 실제 환불금 지급 합계 변화 없음 | 종료 유지 |

자동 처리 대상은 Refund가 ACCEPTED·payoutStatus=PENDING·payoutMethod=PG이고 활성 별도 환불금 지급 예약이 없는 건의 미확정 PaymentCancel(REQUESTED/QUERY_FAILED)이다. 일반 REQUESTED 조회와 QUERY_FAILED 복구 조회는 각각의 일정·전역 복구 제어 규칙을 따른다. 자동 재전송은 그중 PG 미접수 확인·resendCount<설정 한도를 만족할 때만 가능하다.

한도를 소진한 전송의 PG 미접수가 확인되면 Refund 잠금 아래 PaymentCancel.status=FAILED·failureCode=RETRY_EXHAUSTED·failedAt을 기록하고 nextInquiryAt·claimToken·claimUntil을 null로 정리한다. Refund.payoutStatus=ACTION_REQUIRED·actionCode=RETRY_EXHAUSTED와 운영자 알림도 함께 저장한다. FAILED는 모든 자동 PG 조회·재전송 선택에서 제외하고, ACTION_REQUIRED는 운영자 목록에서 계속 조회한다. 별도 EXCLUDED 상태는 추가하지 않는다.

resendCount가 한도에 도달했다는 이유만으로 실패로 바꾸지 않는다. PG 처리 중·조회 장애·결과 불명은 기존 미확정 상태로 조회를 계속한다. 운영자 재시도는 원인을 해결하고 모든 환불금 지급 결과가 확정됐는지 확인한 뒤 새 PaymentCancel을 생성하고 Refund를 PENDING/PG로 바꾼다. 실패했던 시도를 다시 활성화하지 않는다.

확정 트랜잭션은 권한·정책·금액·동의 재검사 → 필요한 퇴실·시간 차감 → Refund 생성·Ticket REVOKED·기존 정지 닫기·SeatAssignment 해제 → 최초 PG 취소 요청 저장이다. 0원은 PG 대신 0원 원장·PAID를 함께 저장한다. PG 요청은 커밋 뒤에만 한다.

공유 잠금 순서는 Payment → Ticket → TicketPause → UsageSession → SeatAssignment → Refund → PaymentCancel → ManualRefundPayout이다. 기존 정지 기록은 Ticket 다음·UsageSession 이전에 잠근다. 이미 생성된 환불의 PG 결과·예약은 Refund 이후 필요한 지급 행만 잠그고 앞 단계 행으로 역행하지 않는다. 동일 종류 복수 행은 ID 순이다. Repository가 쿼리를 캡슐화하고 Service가 업무 판단을 한다.

개별 확인은 자동 작업과 claimToken·claimUntil·lastInquiryAt을 공유한다. 유효한 작업 담당이 있으면 추가 조회·전송하지 않고, 작업이 끝났어도 최근 조회 간격 안에는 저장 상태를 반환한다. PG 미접수가 확실히 확인된 미확정 시도는 자동 횟수를 검사하지 않고 기존 ID·금액으로 즉시 다시 보내며 manualResendCount만 증가시킨다. resendCount를 초기화하거나 증가시키지 않는다. Refund → PaymentCancel 잠금 아래 상태·환불금 지급액·다른 환불금 지급·예약·토큰을 검증하고 전송 횟수·시각·담당 기한을 저장한 뒤 커밋 밖에서 전송한다.

FAILED이고 실패 사유가 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED인 시도의 개별 조회 담당 지정은 Refund → PaymentCancel 순서로 잠그고 수행하며 자동 선택에서는 계속 제외한다. 조회 중인 실패 시도의 유효한 claimToken도 기존 PG 취소 재요청·별도 환불금 지급 생성 경로가 검사해 경쟁 지급을 막는다. 조회 후 취소 요청 기록을 새 PG 취소 요청 식별자로 추가하면 기존 조회 담당을 해제하고 새 식별자를 발급한 PG 취소 요청에 담당을 부여하는 작업을 같은 트랜잭션에서 처리한다. 새 식별자를 발급한 PG 취소 요청은 활성 시도 고유 제약으로도 보호한다. 실패 시도 재조회가 기존 확정 실패와 모순되면 actionCode=PG_RESULT_CONFLICT를 기록하고 자동·개별 재전송·새 식별자를 발급한 PG 취소 요청·별도 환불금 지급 생성 모두 차단한다. 일반 조회·콜백은 결과 미확정인 새 취소 요청이 만들어졌는지 다시 확인해 늦은 결과가 다른 환불금 지급을 시작하지 못하게 한다.

PG 조회 담당 지정은 PaymentCancel만 갱신하고 트랜잭션을 끝낸다. 결과 저장 때 Refund·해당 시도를 잠근 뒤 담당 토큰과 미확정 상태를 확인한다. 외부 호출 동안 DB 잠금을 유지하지 않는다. 담당 기한이 지났다고 지급을 다시 허용하지 않는다.

성공한 지급의 상태·실제액·Refund 합계·원장·필요 알림을 함께 저장한다. 같은 최종 결과의 중복 통보는 합산하지 않는다. 최종 결과와 모순되는 늦은 PG 통보는 그대로 덮어쓰지 않고 운영자 알림·대사 근거로 남긴다. PG의 최종 실패가 실제로 최종인지 보장되지 않는 연동은 별도 환불금 지급을 허용할 수 없다.

## 8. 원장·알림·복구 제어

Ledger에 refundId FK와 manualRefundPayoutId nullable FK를 추가한다. PG 결제 취소는 paymentCancelId unique, 별도 환불금 지급은 manualRefundPayoutId unique다. 둘 중 하나만 연결한다. 0원 환불은 둘 다 null·amount=0이며 refundId의 0원 전용 partial unique로 1건만 기록한다. 합계·원장과 환불금 지급 성공을 같은 트랜잭션에서 반영하고 초기 상태는 RELEASABLE이다.

RefundNotification은 refundId 필수, paymentCancelId/manualRefundPayoutId 선택, kind·audience(CUSTOMER/SHOP/OPERATOR)·shopId·recipientUserId·eventKey·createdAt을 가진다. 동일 eventKey+audience+recipient 고유성으로 중복을 막는다. Receipt는 `(notificationId,userId)` PK와 readAt이다. 현재 ShopOwner·MANAGER 권한으로 조회하고 공동 점주 읽음은 사람별로 분리한다.

RefundRecoveryControl은 기존 설계의 PROBE/BATCH·nextProbeAt·담당 토큰·처리 기한·batchCutoffAt을 유지한다. QUERY_FAILED가 N건이어도 매 자동 시점의 PG 복구 확인은 1번이다. ACTION_REQUIRED와 RESERVED는 PG QUERY_FAILED와 별도 목록으로 보인다. RESERVED가 REFUND_MANUAL_CONFIRM_ALERT_SECONDS(기본 3600초)를 넘으면 sweep가 예약 ID 기반 eventKey로 최초 미확인 알림을 한 번 생성한다. 매 sweep마다 알림을 반복 생성하지 않는다.

## 9. 금액·권한·이전과의 차이

- 한 이용권의 환불 확정은 1회지만 PG 취소 요청은 여러 번 가능하다. 부분 지급을 이유로 이용권을 계속 쓰게 하지 않는다.
- PG 실제액을 확정된 환불 금액으로 덮어쓰거나 상한을 다시 적용해 실제 지급을 무시하지 않는다. 별도 환불금 지급은 미지급액과 같은 금액만 허용한다.
- 새 Refund 생성은 고객 본인 또는 해당 매장 점주만 한다. 시스템 자동 취소는 서버 내부 사건이다. MANAGER는 기존 환불 지급의 운영 처리만 한다.
- 정지·좌석 타입 변경·입실·자동 종료는 Ticket을 잠근 뒤 REVOKED를 재검증한다. 환불 실패로 재개하는 경로는 설계에서 제거한다.

## 10. 데이터 전환·배포

1. 기존 구현의 조회만 사용하는 정리 도구로 PG 미확정 시도를 모두 확인한다. 결과를 모르면 전환을 차단한다. 옛 요청을 새 종료 동의로 추정해 활성 이용권을 일괄 소멸시키지 않는다.
2. 거래가 증명된 기존 성공 환불은 Refund ACCEPTED/PAID·policyVersion=LEGACY로 이관하고 원래 시도를 연결한다. 실제액은 증거가 있는 기존 값만 사용하며 이미 기록된 원장을 중복 생성하지 않는다.
3. 기존 승인 대기는 시도 이력을 FAILED·LEGACY_STORE_REFUND_REQUIRED로 보존하고 Refund LEGACY_REJECTED/NOT_APPLICABLE 이력으로 노출한다. 이용권·좌석은 바꾸지 않는다. 기존 확정 실패도 새 환불 확정으로 추정하지 않고 거절 이력으로 보존한다. 입증되지 않은 금액 불일치는 수동 성공으로 바꾸지 않는다.
4. 새 테이블·nullable FK·검사 제약을 추가하고 검증·중복 정리 뒤 unique를 적용한다. 기존 RefundLock은 미확정 PG 건 없음이 확인된 뒤에만 삭제하고 신규 코드에서 사용을 중단한다.
5. 구버전과 신버전의 의미가 다르므로 결제·환불·입실 변경 요청과 백그라운드 작업을 일시 중지해 전환한다. 데이터·서명 설정·새 계약 검증을 마친 뒤 연다. 신·구 코드 동시 쓰기는 금지한다.
6. 실제 PG·은행은 아직 미연동이다. PG 미접수 확정·최종 실패·같은 키 중복 취소 방지 보장은 실연동 전에 검증해야 한다. 결과 미확정·별도 환불금 지급 예약을 지우는 다운 마이그레이션은 허용하지 않는다. 장애 시 데이터를 보존하고 수정 배포한다.

문서 수정은 DB 마이그레이션 실행이나 기존 데이터 검증을 완료했다는 의미가 아니다.
