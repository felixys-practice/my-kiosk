# 환불 검증 안내: 이용 종료와 지급 분리

**기준**: [명세](spec.md), [API 계약](contracts/rest-api.md), 정책 v0.4. 이 문서는 실행할 검증 절차이며 테스트 실행 결과가 아니다.

## 1. 준비

기존 Node·PostgreSQL·Redis 환경과 .env.example, `.specify/memory/tdd-profile.md`의 실제 명령을 따른다. 실제 PG·은행 연결 대신 테스트 환경에서만 결과를 제어하는 PG 구현을 주입한다. 운영 성공 스위치를 추가하지 않는다.

기능 구현 뒤 실행할 기본 명령:

```bash
npm run build
npm run test
npm run test:e2e
```

변경 파일 린트와 DB 제약·동시성 테스트를 함께 수행한다. 인수 시나리오별 테스트는 HTTP를 호출해야 하며, 헌법에 따라 동작 하나마다 먼저 실패를 확인하고 cycle-log에 실제 출력을 남긴다. 시드/마이그레이션은 검증용 DB에서만 실행한다.

## 2. 검증 데이터

USER 고객 둘, 서로 다른 매장 OWNER, 공동 ShopOwner, MANAGER를 준비한다. 고객지원은 새 매장 환불을 할 수 없고 기존 미지급 운영만 할 수 있다.

이용권은 미사용·사용·이용 중·기한 경계·초과·소진·만료·기존 정지, 시간권/정기권, 자유석/고정석을 조합한다. 고정석은 활성 배정과 퇴실 이후 배정을 구별한다. 미사용 정기권에 expiresAt이 없을 수 있음을 반영한다.

PG 결과는 NOT_SENT·UNKNOWN·ACCEPTED·정상액 성공·거절·authoritative NOT_FOUND·조회 오류·IN_PROGRESS·금액 부족/초과를 준비한다. 확정 환불과 PG 취소 요청을 별도 fixture로 만들고 시도 실패 후에도 Refund·REVOKED가 남는지 검증한다.

## 3. 필수 검증 흐름

- 종료/금액 동의 누락·검증 거절은 Refund·PG 취소 요청·퇴실·좌석을 만들거나 바꾸지 않는다.
- 정상 접수는 PG 호출 전 이용 종료·금액·동의·고정석 해제·시도를 함께 저장한다. 응답은 이용 종료와 환불금 지급 상태를 구분한다.
- PG 전송 전 실패·거절·조회 장애에도 종료를 복구하지 않는다. 고객의 재입실·정지 재개·좌석 변경·새 환불은 차단한다.
- 정기권 대기 시간·시간권 소진 기한을 정지/연장하지 않는다. 이미 종료한 이용권은 지급에 따라 이용 기간이 다시 생기지 않는다.
- 백그라운드 자동 작업은 미접수 확인 뒤 모든 경로에 같은 자동 재전송 한도를 적용한다. 한도 소진과 PG 미접수 확인이 함께 있어야 FAILED·운영자 처리로 전환한다. 이후 sweep·PROBE·BATCH에서 해당 FAILED 시도의 PG 호출이 더 생기지 않는지 확인한다. 결과 미확정이면 계속 조회하며 새 지급은 차단한다.
- QUERY_FAILED는 긴 간격마다 전체에서 1건 조회, 정상 응답 뒤 배치 조회다. PG 처리 중은 정상 통신일 뿐 PAID가 아니다.
- 자동 횟수 0·한도 직전·소진에서도 미확정 시도의 확실한 미접수는 기존 ID로 즉시 재전송한다. 최근 시도가 이미 세 실패 사유로 FAILED이면 10-1a 조건으로 새 ID를 만든다. 미확정 요청의 조회에서 새로 확인한 거절은 실패·조치 필요만 기록하고 같은 실행에서 새 요청을 만들지 않는다. 조회 오류·처리 중·실제 지급액 있음·활성 예약에는 전송하지 않는다. 최근 시도가 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED로 이미 FAILED인 경우를 각각 준비한다. 개별 조회에서 authoritative NOT_FOUND 또는 거절 확정이면 실제 환불금 지급액 0원·다른 미확정 지급 없음·지급 방식 PG·활성 별도 지급 예약 없음·유효한 자기 담당 토큰을 확인해 별도 버튼·사유 입력 없이 같은 환불 금액의 새 PaymentCancel을 즉시 전송한다. 이전 실패 이력·횟수·이용 종료와 조회 시각 승계를 확인한다. QUERY_ERROR이면 새 요청을 만들지 않고, 처리 중·취소 성공 등 모순이면 PG_RESULT_CONFLICT·운영자 알림과 추가 지급 차단을 검증한다. 기존 미확정 요청 재전송은 manualResendCount만 증가시키고 자동 횟수는 바꾸지 않는다.
- 점주·운영자는 개별 확인으로 세 실패 사유의 최근 FAILED 요청을 다시 보낼 수 있다. 직접 payout-retries는 MANAGER만 실행하며 사유·요청 키·같은 키 재응답·권한·상태 오류를 검증한다.
- 알려진 실패 뒤 MANAGER 재시도는 같은 Refund·확정된 환불 금액·새 식별자를 발급한 PG 취소 요청으로 수행한다. 이미 일부 지급됐으면 PG 전액 재시도를 막는다.
- 별도 환불금 지급은 미지급액 예약→실제 외부 지급→증빙 확정이다. 예약 중 다른 환불금 지급을 막고 환불금 지급 여부 불명은 TTL로 해제하지 않는다.
- PG 부족액은 실제액 원장 후 부족액만 환불금을 별도로 지급한다. 초과액은 추가 환불금 지급 없이 검토 기록을 남긴다. 금액·원장 덮어쓰기는 없다.
- 같은 지급의 중복 콜백·조회·수동 확정은 합계·원장·알림을 한 번만 바꾼다. 같은 외부 거래 키를 다른 환불에 재사용하면 거부한다.
- 콜백은 raw body와 timestamp로 서명한다. 잘못된 서명·과거 서명·사용자 JWT만 있는 콜백은 상태를 바꾸지 않는다.
- 목록·상세·알림·증빙·읽음과 운영 지급 API의 권한을 각각 확인한다. 미지급 건을 실패 완료로 숨기지 않는다.

## 4. 동시성·중단 복구

1. 고객/점주가 동시에 환불을 요청해도 확정된 `Refund`는 1건만 생성한다. 입실이 먼저 완료되면 사용 이력 때문에 고객 환불 요청을 거절한다. 환불 확정이 먼저면 이용권은 종료 상태이므로 뒤이은 입실 요청에 HTTP 409와 `TICKET_TERMINATED` 오류 코드를 반환한다.
2. 확정 커밋 전 중단은 이용 종료·환불 모두 롤백하고 PG 호출 0회다. 커밋 뒤 전송 전 중단은 종료·환불·시도를 유지하고 조회로 확인한다.
3. PG 성공 직후 DB 저장 실패·콜백 중복·조회 경쟁은 같은 시도와 원장을 한 번만 반영한다. 합계를 중복 가산하지 않는다.
4. 점주·MANAGER의 개별 확인, MANAGER 직접 재시도와 별도 예약이 동시에 요청되면, 각 처리는 Refund 행 잠금을 획득한 트랜잭션에서 다른 지급 처리의 상태를 재검사해 중복 지급을 막는다. 각 테이블의 partial unique만 검사하고 교차 경합을 놓치지 않는다.
5. 별도 환불금 지급 예약 뒤 중단·운영자 변경·증빙 확인 지연에도 다른 환불금 지급을 시작하지 않는다. 확인되지 않은 송금의 재실행을 막는다.
6. 기존 자동 종료·정지 재개·좌석 타입/배정 변경이 REVOKED를 덮어쓰지 않는다. 남은 퇴실 Job이 이중 차감하지 않는다.
7. 서비스 전 개발 데이터를 폐기할 수 있으므로 과거 환불 이관은 제외한다. 빈 검증용 DB에 스키마·제약을 적용하고 테스트 데이터를 생성해 전체 회귀를 확인한다. 기존 운영 데이터 복제본 전환 검증은 하지 않는다.

## 5. 성공 기준 확인

SC-004는 PG 최종 결과 정상 응답·무적체 조건에서 60초 대기+15초 조회 간격=75초의 시도 결과 판명을 검증한다. `test/refund-crash-recovery.e2e-spec.ts`의 U419는 기본 설정과 최초 조회 예정 시각을 확인하고, 테스트 시계의 59.999초 탐색에서는 조회하지 않으며 65초 탐색에서 PG 최종 성공을 반영해 75초 안에 시도 결과를 판명한다. PG 처리 중·재전송·장애·운영자 별도 환불금 지급은 전체 환불금 지급 완료 시간과 구분한다.

원장은 실제 지급별 정확히 1건, 0원은 Refund별 1건이다. 부족액 별도 환불금 지급이 있으면 원장이 2건일 수 있으며 두 금액의 합계를 비교한다. 환불 확정 자체나 예약에는 실제 지급 원장이 생기지 않는다.

## 6. 인수 시나리오별 HTTP 검증 목록

각 행의 기대 결과는 구현 시 검증할 동작이다. 총 92개이며 다이어그램과 번호가 같다. 마지막 열의 `QS-n-m`은 실제 `it` 또는 `it.each` 테스트 이름에 포함된 식별자다. 같은 식별자가 여러 테스트 이름에 있으면 해당 시나리오의 조건을 나눠 검증한다.

| 시나리오 | HTTP 진입점 | 기대 결과 | 실제 E2E 테스트 |
|---|---|---|---|
| 1-1 | POST /refund | 실결제액 전액 환불과 이용 종료가 확정되고 고정석 배정이 해제되며, 응답은 "이용 종료 완료·환불금 지급 처리 중"이다. | test/refund-customer.e2e-spec.ts / QS-1-1 |
| 1-1a | POST /refund | 동의가 필요하다는 오류로 거절되고 이용권·좌석·환불 기록에는 변화가 없다. | test/refund-customer.e2e-spec.ts / QS-1-1a |
| 1-2 | POST /refund | 찾을 수 없는 이용권으로 거절되고, 그 이용권이 있다는 사실은 드러나지 않는다. | test/refund-customer.e2e-spec.ts / QS-1-2 |
| 1-3 | POST /refund | `PAYMENT_NOT_COMPLETED`로 거절된다. | test/refund-customer.e2e-spec.ts / QS-1-3 |
| 1-4 | POST /refund | `ALREADY_REFUNDED`로 거절된다. | test/refund-customer.e2e-spec.ts / QS-1-4 |
| 1-5 | POST /refund | `REFUND_IN_PROGRESS`로 거절된다. | test/refund-customer.e2e-spec.ts / QS-1-5 |
| 1-6 | POST /refund | `USED_TICKET`으로 거절되고 매장에 환불을 요청하라고 안내되며, 환불 기록은 남지 않는다. | test/refund-customer.e2e-spec.ts / QS-1-6 |
| 1-7 | POST /refund | `USED_TICKET`으로 거절된다. | test/refund-customer.e2e-spec.ts / QS-1-7 |
| 1-8 | POST /refund | `EXPIRED_TICKET`으로 거절되고 매장에 환불을 요청하라고 안내된다. | test/refund-customer.e2e-spec.ts / QS-1-8 |
| 1-9 | POST /refund | 대상 여부 규칙이 먼저 적용되어 `USED_TICKET`이 아니라 `REFUND_IN_PROGRESS`로 거절된다. | test/refund-customer.e2e-spec.ts / QS-1-9 |
| 2-1 | POST /refund/shop/:shopId | 이용 종료·고정석 해제·그 금액의 환불이 함께 확정되고 점주·시각·사유·금액이 기록되며, PG 결제 취소를 시작하고 "이용 종료 완료·환불금 지급 처리 중"으로 응답한다. | test/refund-store.e2e-spec.ts / QS-2-1 |
| 2-2 | POST 매장 환불 → POST /refund/callback → GET /refund/:refundId | 환불금 지급 완료로 바뀌며 이용 종료·좌석 해제는 반복하지 않는다. | test/refund-store.e2e-spec.ts / QS-2-2 |
| 2-3 | POST /refund/shop/:shopId | 기한이 지난 미사용권은 전액을 강제하지 않고 입력액으로 환불 확정·이용 종료·좌석 해제한다. 양수는 PG 취소 결과를 기다리는 중, 0원은 PG 없이 환불금 지급 완료·원장 0원 기록이다. 실결제액 10,000원에 환불액 0원·7,000원·10,000원을 각각 검증한다. | test/refund-store.e2e-spec.ts / QS-2-3 |
| 2-3a | POST /refund/shop/:shopId | 양수 금액은 1번, 0원은 4번과 같이 처리된다. | test/refund-store.e2e-spec.ts / QS-2-3a |
| 2-4 | POST /refund/shop/:shopId | PG에 요청하지 않고 환불 확정·이용 종료·좌석 해제·환불금 지급 완료·원장 0원 기록을 함께 처리한다. | test/refund-store.e2e-spec.ts / QS-2-4 |
| 2-5 | POST /refund/shop/:shopId | 환불이 거부되고 이용권과 결제에는 변화가 없다. | test/refund-store.e2e-spec.ts / QS-2-5 |
| 2-6 | POST /refund/shop/:shopId | 환불이 거부된다. | test/refund-store.e2e-spec.ts / QS-2-6 |
| 2-7 | POST /refund/shop/:shopId | 자기 매장에서 찾을 수 없는 이용권으로 거부되고, 그 이용권이 다른 매장에 있다는 사실은 드러나지 않는다. | test/refund-store.e2e-spec.ts / QS-2-7 |
| 2-7a | POST /refund/shop/:shopId | 권한이 없어 거부된다. | test/refund-store.e2e-spec.ts / QS-2-7a |
| 2-8 | POST /refund/shop/:shopId | 사유가 없어도 전액 환불·이용 종료·좌석 해제가 확정되고 점주·시각이 기록된다. PG 결제 취소를 시작하며 "이용 종료 완료·환불금 지급 처리 중"으로 응답한다. | test/refund-store.e2e-spec.ts / QS-2-8 |
| 2-8a | POST /refund/shop/:shopId | 사용하지 않은 이용권은 전액만 환불할 수 있다는 사유로 거부되고 이용권과 결제에는 변화가 없다. | test/refund-store.e2e-spec.ts / QS-2-8a |
| 2-9 | POST /refund/shop/:shopId | 고객 환불과 같은 대상 여부 규칙의 오류 코드(`ALREADY_REFUNDED`, `REFUND_IN_PROGRESS`)로 거부된다. | test/refund-store.e2e-spec.ts / QS-2-9 |
| 2-10 | POST /refund/shop/:shopId | "이용 중" 오류로 거부되고 이용과 이용권에는 변화가 없다. | test/refund-store.e2e-spec.ts / QS-2-10 |
| 2-11 | POST /refund/shop/:shopId | 퇴실·시간권 사용 시간 차감·이용권 소멸·고정석 해제·환불 확정을 함께 처리한 뒤 PG 결제 취소를 시작한다. 응답은 "이용 종료 완료·환불금 지급 처리 중"이다. | test/refund-store.e2e-spec.ts / QS-2-11 |
| 2-12 | POST /refund/shop/:shopId | 환불이 거부되고 퇴실도 되지 않는다. | test/refund-store.e2e-spec.ts / QS-2-12 |
| 2-13 | POST 매장 환불 → 실패 콜백 → GET /refund/:refundId | PG 취소 요청 실패와 미지급 조치 필요를 기록하고 알린다. 이용 종료·퇴실·사용 시간 차감·고정석 해제는 유지한다. 이용권을 복구하거나 새 환불을 받지 않고 같은 환불 건의 지급을 재처리한다. | test/refund-store.e2e-spec.ts / QS-2-13 |
| 3-1 | POST /usage-sessions | 이용 종료 오류로 거부된다. | test/refund-entry.e2e-spec.ts / QS-3-1 |
| 3-2 | POST /usage-sessions | 환불금 지급 완료 여부와 관계없이 이용 종료 오류로 거부된다. | test/refund-entry.e2e-spec.ts / QS-3-2 |
| 3-3 | POST /usage-sessions | 이용 종료 오류로 거부된다. 환불금 지급 실패를 이유로 이용권·고정석을 복구하지 않는다. | test/refund-entry.e2e-spec.ts / QS-3-3 |
| 4-1 | PG 콜백·GET 환불·원장 조회 | 원장에 그 매장·주문의 실제 PG 취소 금액만큼 음수 기록 1건이 생긴다. | test/refund-ledger.e2e-spec.ts / QS-4-1 |
| 4-2 | PG 콜백·GET 환불·원장 조회 | 원장 기록은 1건 그대로다. | test/refund-ledger.e2e-spec.ts / QS-4-2 |
| 4-3 | PG 콜백·GET 환불·원장 조회 | 원장에는 아무 기록도 생기지 않는다. | test/refund-ledger.e2e-spec.ts / QS-4-3 |
| 4-4 | PG 콜백·GET 환불·원장 조회 | 원장에는 아무 기록도 없다. | test/refund-ledger.e2e-spec.ts / QS-4-4 |
| 5-1 | PG 테스트 결과·복구 API·GET 환불 | PG 취소 요청 실패·환불금 지급 조치 필요를 기록하고 운영자에게 알린다. 접수된 환불과 이용 종료는 유지하며 응답에서도 이용 종료 완료와 미지급 상태를 구분한다. | test/refund-recovery.e2e-spec.ts / QS-5-1 |
| 5-2 | PG 테스트 결과·복구 API·GET 환불 | 환불금 지급 완료와 실제 금액의 원장 기록을 함께 반영한다. 이용 종료·좌석 해제는 반복하지 않는다. | test/refund-recovery.e2e-spec.ts / QS-5-2 |
| 5-3 | PG 테스트 결과·복구 API·GET 환불 | PG 취소 요청 실패와 환불금 지급 조치 필요를 기록하고 알린다. 확정된 환불 금액과 이용 종료는 유지한다. | test/refund-recovery.e2e-spec.ts / QS-5-3 |
| 5-4 | PG 테스트 결과·복구 API·GET 환불 | 같은 환불 건에서 같은 금액으로 다시 보내고 환불금 지급 처리 중으로 둔다. | test/refund-recovery.e2e-spec.ts / QS-5-4 |
| 5-5 | PG 테스트 결과·복구 API·GET 환불 | 4번과 같은 규칙으로 같은 금액을 다시 보낸다. | test/refund-recovery.e2e-spec.ts / QS-5-5 |
| 5-6 | PG 테스트 결과·복구 API·GET 환불 | 한도 소진 뒤 PG 미접수가 확인되면 해당 시도 FAILED/RETRY_EXHAUSTED·환불 ACTION_REQUIRED를 함께 기록하고 자동 조회·재전송에서 제외한다. 운영자 알림·금액·종료는 유지한다. 한도 소진 뒤 PG 처리 중·조회 오류이면 실패로 종료하지 않고 계속 조회한다. | test/refund-recovery.e2e-spec.ts / QS-5-6 |
| 5-7 | PG 테스트 결과·복구 API·GET 환불 | 환불금 지급 성공·실패로 단정하지 않고 정해진 간격으로 다시 조회한다. 다른 PG 취소 요청과 별도 환불금 지급은 허용하지 않는다. | test/refund-recovery.e2e-spec.ts / QS-5-7 |
| 5-8 | PG 테스트 결과·복구 API·GET 환불 | PG 취소 결과 확인 실패로 표시하고 운영자에게 알린다. 환불금은 미지급·결과 확인 중으로 남고 이용 종료는 유지된다. | test/refund-recovery.e2e-spec.ts / QS-5-8 |
| 5-9 | PG 테스트 결과·복구 API·GET 환불 | 가장 오래된 1건만 PG 거래조회한다. 쌓인 건수와 관계없이 해당 시점의 자동 조회는 1번이다. | test/refund-recovery.e2e-spec.ts / QS-5-9 |
| 5-10 | PG 테스트 결과·복구 API·GET 환불 | 그 결과를 반영하고 나머지를 정해진 건수씩 나눠 조회한다. 완료·거절·미접수는 각 규칙을 따르고, PG 처리 중·조회 장애는 지급을 확정하지 않고 재확인한다. | test/refund-recovery.e2e-spec.ts / QS-5-10 |
| 5-10a | PG 테스트 결과·복구 API·GET 환불 | 자동 재확인 예정 시각을 기다리지 않고 PG 취소 결과 확인 실패 건을 정해진 건수씩 묶어 조회한다. 재조회 실행은 환불 확정이나 환불금 지급 완료를 뜻하지 않는다. | test/refund-recovery.e2e-spec.ts / QS-5-10a |
| 5-10b | PG 테스트 결과·복구 API·GET 환불 | 권한 오류로 거부된다. | test/refund-recovery.e2e-spec.ts / QS-5-10b |
| 5-11 | PG 테스트 결과·복구 API·GET 환불 | 실제 환불금 지급액과 원장을 함께 기록하고 확정된 환불 금액은 바꾸지 않는다. 부족액·초과액을 구분해 환불금 지급 조치 필요로 두고 운영자에게 알린다. | test/refund-recovery.e2e-spec.ts / QS-5-11 |
| 5-12 | PG 테스트 결과·복구 API·GET 환불 | 2~11번의 같은 조회·재전송·미지급 관리 규칙을 적용한다. 승인 금액 불일치 건은 이용권을 만들지 않는다. | test/refund-recovery.e2e-spec.ts / QS-5-12 |
| 5-13 | POST /refund/:refundId/pg-check · GET 상세 | 자동 조회 예정 시각 전이라도 해당 시도 한 건만 즉시 조회하고, 환불금 지급 완료·실제액·원장을 한 번 반영해 결과를 보여준다. | test/refund-recovery.e2e-spec.ts / QS-5-13 |
| 5-14 | POST /refund/:refundId/pg-check · GET 상세 | 미확정 요청의 조회는 각각 처리 중 또는 결과 확인 불가로 안내하고 지급을 확정하지 않는다. 기존 조회 일정·오류 처리 규칙으로 다시 확인하며 다른 환불금 지급 차단을 유지한다. | test/refund-recovery.e2e-spec.ts / QS-5-14 |
| 5-15 | POST /refund/:refundId/pg-check · GET 상세 | 진행 중인 작업과 현재 저장 상태를 안내하고 PG를 중복 호출하지 않는다. 이후 환불 상세에서 반영 결과를 확인할 수 있다. | test/refund-recovery.e2e-spec.ts / QS-5-15 |
| 5-16 | POST /refund/:refundId/pg-check · GET 상세 | 지정한 환불만 확인한다. 정상 응답을 받아도 나머지 건의 일괄 조회를 시작하거나 전체 장애 복구 모드·예정 시각을 바꾸지 않는다. | test/refund-recovery.e2e-spec.ts / QS-5-16 |
| 5-17 | POST /refund/:refundId/pg-check · GET 상세 | 다른 매장 점주는 찾을 수 없음, 일반 고객은 권한 오류, 미로그인은 인증 오류로 거부한다. 거부한 요청은 PG를 호출하거나 환불 상태를 바꾸지 않는다. | test/refund-recovery.e2e-spec.ts / QS-5-17 |
| 5-18 | POST /refund/:refundId/pg-check · GET 상세 | 지급 완료·0원·활성 별도 예약·금액 불일치 검토·MANUAL 방식은 PG 호출 없이 저장 상태를 반환한다. 최근 시도가 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED로 이미 FAILED이고 재전송 허용 조건을 만족하면 5-19·10-1a로 개별 조회한다. | test/refund-recovery.e2e-spec.ts / QS-5-18 |
| 5-19 | POST /refund/:refundId/pg-check · GET 상세 | 자동 횟수 0·한도 직전·소진에서도 미확정 시도의 확실한 미접수는 기존 ID로 즉시 재전송한다. 최근 시도가 이미 세 실패 사유로 FAILED이면 10-1a 조건으로 새 ID를 만든다. 미확정 요청의 조회에서 새로 확인한 거절은 실패·조치 필요만 기록하고 같은 실행에서 새 요청을 만들지 않는다. 조회 오류·처리 중·실제 지급액 있음·활성 예약에는 전송하지 않는다. | test/refund-recovery.e2e-spec.ts / QS-5-19 |
| 5-20 | POST /refund/:refundId/pg-check · GET 상세 | 최근 조회 시각과 저장된 상태를 보여주고 PG를 추가 호출하지 않는다. 점주·운영자·자동 작업의 조회 시각을 같은 시도 기준으로 공유한다. | test/refund-recovery.e2e-spec.ts / QS-5-20 |
| 6-1 | POST /payments/callback | 결제는 실패로 처리되고, 이용권은 발행되지 않으며, 좌석 선점은 해제되고, PG가 승인한 금액 전액의 환불과 최초 PG 취소 요청이 함께 저장되고 지급을 시작한다. | test/refund-payment-mismatch.e2e-spec.ts / QS-6-1 |
| 6-2 | POST /payments/callback | 환불금 지급 완료로 바뀌고 실패 결제는 성공으로 복구하지 않는다. | test/refund-payment-mismatch.e2e-spec.ts / QS-6-2 |
| 6-3 | POST /payments/callback | 사용자 스토리 5와 같이 처리된다. | test/refund-payment-mismatch.e2e-spec.ts / QS-6-3 |
| 6-4 | POST /payments/callback | 기존처럼 이용권이 발행된다. | test/refund-payment-mismatch.e2e-spec.ts / QS-6-4 |
| 7-1 | PG 콜백 | 결과가 반영된다. | test/refund-callback-auth.e2e-spec.ts / QS-7-1 |
| 7-2 | PG 콜백 | 거부되고 환불금 지급 상태는 바뀌지 않는다. | test/refund-callback-auth.e2e-spec.ts / QS-7-2 |
| 7-3 | PG 콜백 | 거부된다. | test/refund-callback-auth.e2e-spec.ts / QS-7-3 |
| 7-4 | PG 콜백 | 1~3번과 같이 처리된다. | test/refund-callback-auth.e2e-spec.ts / QS-7-4 |
| 8-1 | GET /refund/shop/:shopId | 조회된다. | test/refund-history.e2e-spec.ts / QS-8-1 |
| 8-2 | GET /refund/shop/:shopId | 해당 매장을 찾을 수 없다는 응답을 받고 내역은 보이지 않는다. | test/refund-history.e2e-spec.ts / QS-8-2 |
| 8-3 | GET /refund/me | 조회된다. | test/refund-history.e2e-spec.ts / QS-8-3 |
| 8-4 | GET /refund/me | 자기 환불 내역만 보인다. 다른 고객을 지정해 조회할 방법은 없다. | test/refund-history.e2e-spec.ts / QS-8-4 |
| 8-5 | GET /refund/user/:userId · /refund/shop/:shopId | 조회된다. | test/refund-history.e2e-spec.ts / QS-8-5 |
| 9-1 | 환불·알림 GET/PATCH | 이용 종료 완료와 환불금 지급 상태가 구분된다. 양수의 최초 접수는 환불금 지급 처리 중, 보내기 전 실패·PG 거절은 이용 종료 완료·환불금 지급 조치 필요, 0원은 환불금 지급 완료로 응답한다. | test/refund-notifications.e2e-spec.ts / QS-9-1 |
| 9-2 | 환불·알림 GET/PATCH | 이용 종료 시각·확정된 환불 금액·실제 환불금 지급액·미지급액·환불금 지급 상태·조치 사유가 보인다. | test/refund-notifications.e2e-spec.ts / QS-9-2 |
| 9-3 | 환불·알림 GET/PATCH | 신청한 고객·그 매장 점주·운영자에게 미지급 알림이 남는다. | test/refund-notifications.e2e-spec.ts / QS-9-3 |
| 9-3a | 환불·알림 GET/PATCH | 그 매장 점주와 운영자에게 미지급 알림이 남는다. | test/refund-notifications.e2e-spec.ts / QS-9-3a |
| 9-4 | 환불·알림 GET/PATCH | 자기 매장의 알림만 보인다. | test/refund-notifications.e2e-spec.ts / QS-9-4 |
| 9-4a | 환불·알림 GET/PATCH | 자기 환불의 알림만 보인다. | test/refund-notifications.e2e-spec.ts / QS-9-4a |
| 9-4b | 환불·알림 GET/PATCH | 안 읽은 알림 조회에서 빠지고 전체 조회에는 읽음으로 남는다. 다른 사람의 알림은 읽음 처리할 수 없다. | test/refund-notifications.e2e-spec.ts / QS-9-4b |
| 9-5 | 환불·알림 GET/PATCH | 그 알림이 보인다. | test/refund-notifications.e2e-spec.ts / QS-9-5 |
| 10-1 | POST /refund/:refundId/payout-retries | 같은 환불·같은 금액(확정된 환불 금액)으로 취소 요청을 새 PG 취소 요청 식별자로 기록하고 실행자·사유를 기록한다. 이용권·좌석은 복구하지 않는다. | test/refund-operations.e2e-spec.ts / QS-10-1 |
| 10-1a | POST /refund/:refundId/pg-check | 최근 시도가 RETRY_EXHAUSTED·SEND_FAILED·PG_REJECTED로 이미 FAILED인 경우를 각각 준비한다. 개별 조회에서 authoritative NOT_FOUND 또는 거절 확정이면 실제 환불금 지급액 0원·다른 미확정 지급 없음·지급 방식 PG·활성 별도 지급 예약 없음·유효한 자기 담당 토큰을 확인해 별도 버튼·사유 입력 없이 같은 환불 금액의 새 PaymentCancel을 즉시 전송한다. 이전 실패 이력·횟수·이용 종료와 조회 시각 승계를 확인한다. QUERY_ERROR이면 새 요청을 만들지 않고, 처리 중·취소 성공 등 모순이면 PG_RESULT_CONFLICT·운영자 알림과 추가 지급 차단을 검증한다. | test/refund-operations.e2e-spec.ts / QS-10-1a |
| 10-1b | POST /refund/:refundId/pg-check · 자동 작업 | 10-1a로 PG에 취소 요청을 새 PG 취소 요청 식별자로 보낸 뒤 자동 작업은 정해진 횟수까지만 재전송한다. 이전 실패 시도의 상태·횟수는 바꾸지 않는다. 새 식별자를 발급한 PG 취소 요청도 한도 소진과 미접수로 실패하면 자동 처리를 멈추되, 점주·운영자의 개별 확인은 다시 실행할 수 있다. | test/refund-operations.e2e-spec.ts / QS-10-1b |
| 10-1c | POST /refund/:refundId/payout-retries | K1로 만든 환불 R의 취소 요청 A를 미확정으로 유지한다. 첫 요청을 보낸 운영자가 K1을 다시 사용하면 환불 대상과 입력 사유를 첫 요청과 비교한다. 내용이 같으면 A가 담긴 최초 202 응답을 반환하고, 바뀌었으면 409 IDEMPOTENCY_KEY_REUSED로 거절한다. K2·K3 동시 요청은 환불 R 잠금 뒤 409 REFUND_PAYOUT_UNRESOLVED로 거절한다. 취소 요청 행과 PG 취소 호출이 추가되지 않는지 확인한다. | test/refund-operations.e2e-spec.ts / QS-10-1c |
| 10-1d | POST /refund/:refundId/payout-retries | 고객·점주는 403 REFUND_FORBIDDEN. 운영자의 같은 키·같은 내용은 최초 응답 반환. 새 요청의 지급 완료·재처리 불가는 409 REFUND_PAYOUT_NOT_ACTIONABLE, 미확정 결과·활성 예약은 409 REFUND_PAYOUT_UNRESOLVED, 미지급액이 남은 일부 지급은 409 REFUND_PARTIAL_PAYOUT_REQUIRES_MANUAL. 거절·재응답에 기록·PG 호출 추가 없음. | test/refund-operations.e2e-spec.ts / QS-10-1d |
| 10-2 | POST payout-retries / manual-payouts | 환불금 지급 결과 미확정 오류로 거부한다. | test/refund-operations.e2e-spec.ts / QS-10-2 |
| 10-3 | POST /refund/:refundId/manual-payouts | 미지급액과 같은 금액을 예약하고 다른 PG 취소 요청·별도 환불금 지급을 차단한다. 예약은 환불금 지급 완료가 아니다. | test/refund-operations.e2e-spec.ts / QS-10-3 |
| 10-4 | POST manual-payouts/:payoutId/confirm | 별도 환불금 지급과 실제 금액의 원장을 함께 한 번만 기록한다. 합계가 확정된 환불 금액에 이르고 검토 사항이 없으면 환불금 지급 완료가 된다. | test/refund-operations.e2e-spec.ts / QS-10-4 |
| 10-5 | GET /refund/:refundId · GET /refund/notifications | 예약을 유지하고 운영자에게 확인을 요구한다. 시간 초과만으로 예약을 풀거나 다른 환불금 지급을 허용하지 않는다. | test/refund-operations.e2e-spec.ts / QS-10-5 |
| 10-6 | POST manual-payouts/:payoutId/confirm | 기존 결과를 반환하고 환불금 지급액·원장을 더하지 않는다. 다른 환불에서 같은 지급 거래 식별자를 쓰면 거부한다. | test/refund-operations.e2e-spec.ts / QS-10-6 |
| 10-7 | POST manual-payouts → confirm | 확정된 환불 금액에서 실제 환불금 지급액을 뺀 부족액만 예약·지급할 수 있다. 같은 환불의 PG 결제 취소와 부족액 지급은 각각 실제 금액으로 원장에 기록한다. 부족액의 실제 환불금 지급 증빙을 확정할 때 부족 지급 검토도 함께 마치고 전체 환불금 지급 완료로 바꾼다. | test/refund-operations.e2e-spec.ts / QS-10-7 |
| 10-8 | POST /refund/:refundId/amount-review | 실제액·초과액·검토 기록을 유지하고 환불금 지급 완료로 표시한다. 추가 환불금 지급이나 확정된 환불 금액 덮어쓰기는 하지 않으며 초과액 회수는 후속 범위다. | test/refund-operations.e2e-spec.ts / QS-10-8 |
| 10-9 | POST /refund/:refundId/manual-payouts | 고객이나 점주가 PG 외 수단으로 지급할 환불금의 예약을 요청하면 권한 오류로 거부된다. | test/refund-operations.e2e-spec.ts / QS-10-9 |
| 10-9a | POST /refund/:refundId/manual-payouts/:payoutId/confirm · not-paid | 고객이나 점주가 PG 외 수단으로 실제 지급한 환불금의 증빙 등록이나 미지급 확인을 요청하면 권한 오류로 거부된다. | test/refund-operations.e2e-spec.ts / QS-10-9a |
| 10-9b | POST /refund/:refundId/amount-review | 고객이나 점주가 PG 초과 취소에 대한 운영자 검토 결과 등록을 요청하면 권한 오류로 거부된다. | test/refund-operations.e2e-spec.ts / QS-10-9b |
| 10-10 | POST manual-payouts/:payoutId/not-paid | 해당 예약을 실패로 종료하고 환불금 지급 조치 필요로 남긴다. 환불금 지급 여부가 불명확하면 예약을 종료할 수 없다. | test/refund-operations.e2e-spec.ts / QS-10-10 |

### 요구사항·성공 기준 연결

현재 범위의 기능 요구사항은 아래 구현과 HTTP 테스트에 연결한다. 개별 동작의 세부 근거는 `tasks.md`와 `tdd/test-list.md`에 있다. 특히 FR-009의 매장 환불 대상 여부 오류는 `evaluateStoreRefund`가 고객 환불과 같은 `targetRuleRejection`을 호출하며, `test/refund-store.e2e-spec.ts`의 QS-2-9가 `ALREADY_REFUNDED`와 `REFUND_IN_PROGRESS`를 확인한다.

| 요구사항 | 구현 위치 | HTTP 검증 위치 |
|---|---|---|
| FR-001~007 | `src/refund/refund-policy.ts`, `refund-acceptance.service.ts` | `test/refund-customer.e2e-spec.ts` / QS-1-1~1-9 |
| FR-008~016·FR-016a | `src/refund/refund-policy.ts`, `refund-store.service.ts` | `test/refund-store.e2e-spec.ts` / QS-2-1~2-13(추가 a 시나리오 포함) |
| FR-017 | `src/usage-session/usage-session.repository.ts` | `test/refund-entry.e2e-spec.ts` / QS-3-1~3-3 |
| FR-018~020 | `src/refund/refund-result.service.ts`, `src/ledger/refund-ledger.repository.ts` | `test/refund-ledger.e2e-spec.ts` / QS-4-1~4-4 |
| FR-021~029·FR-052~057 | `src/refund/refund-recovery.service.ts`, `refund-dispatch.service.ts`, `refund-pg-check.service.ts`, `refund-retry.service.ts` | `test/refund-recovery.e2e-spec.ts` / QS-5-1~5-20, `test/refund-concurrency.e2e-spec.ts` / U405~U410 |
| FR-026a | 운영자가 PG 취소 결과 확인 실패 건의 전체 재조회를 예약하는 `src/refund/refund-recovery.service.ts`의 `resumeRecovery` | `test/refund-recovery.e2e-spec.ts` / QS-5-10a·QS-5-10b |
| FR-030 | `src/payment/payment.service.ts`, `src/refund/refund-system.service.ts` | `test/refund-payment-mismatch.e2e-spec.ts` / QS-6-1~6-4 |
| FR-031~032 | `src/pg/guards/pg-signature.guard.ts` | `test/refund-callback-auth.e2e-spec.ts` / QS-7-1~7-4 |
| FR-033~039 | `src/refund/refund-query.service.ts`, `refund-notification.service.ts` | `test/refund-history.e2e-spec.ts` / QS-8-1~8-5, `test/refund-notifications.e2e-spec.ts` / QS-9-1~9-5 |
| FR-040~051 | `src/refund/refund-acceptance.service.ts`, `refund-operations.service.ts`, `refund-query.service.ts` | `test/refund-operations.e2e-spec.ts` / QS-10-1~10-10, `test/refund-concurrency.e2e-spec.ts` / U403~U413, `test/refund-crash-recovery.e2e-spec.ts` / U414~U418 |

성공 기준 SC-001~003은 QS-1·QS-2·QS-4·QS-10의 판정·지급별 원장, SC-004는 U419의 기본 시간 경계, SC-005~007은 QS-5의 미확정·장애 복구, SC-006a는 QS-5-10a·QS-5-10b의 운영자 전체 재조회 예약과 권한 거절에 연결한다. SC-008~010은 QS-6·QS-7·QS-3의 자동 취소·서명·입실 거부에 연결한다. SC-011·SC-011a는 QS-8·QS-9의 조회 범위, SC-012~014는 QS-1·QS-2·QS-3·QS-5와 U403·U414~U416의 접수 응답·이용 종료 보존, SC-015~018은 QS-8·QS-9·QS-10의 미지급 추적·운영 권한·중복 지급 차단에 연결한다. SC-019~023은 QS-5·QS-10과 U405~U412의 개별 확인·담당 공유·재요청 멱등성에 연결한다. 이 연결은 테스트의 적용 범위이며 운영 환경에서 모든 요청의 100% 결과를 측정한 기록은 아니다.

FR-007a와 U262~U266은 서비스 시작 전 개발 데이터를 폐기할 수 있다는 결정으로 범위에서 제외했다. 과거 환불 이관·운영 서버 전환을 미구현 누락으로 계산하지 않으며, 빈 DB 재구축과 현행 동시성·중단 복구 검증은 유지한다.

## 7. 완료 판정

실제 구현 뒤 단위·HTTP E2E·DB 제약·동시성·중단 복구·빌드·변경 파일 린트와 주요 오류 구현을 일부러 넣어 실패를 검출하는 검증을 통과해야 한다. 문서에서 요구사항·번호·설정이 맞는 것만으로 이 검증을 완료했다고 보고하지 않는다.
