# 구현 전 기준선: 환불 기능 완료

T001 기록이다. 이번 기능이 바꾸게 될 기존 환불·결제·PG 코드가 지금 어떻게 동작하는지와 테스트 기준선을 적는다. 기능 구현 전인 커밋 `0f6338f` 시점의 코드를 기준으로 한다. 설정 검증 작업 T004·T005는 이 기록과 별개로 이미 반영됐다.

## 테스트 기준선

| 구분 | 명령 | 결과 (2026-10-27, `0f6338f`) |
|---|---|---|
| 단위 테스트 | `npm run test` | 테스트 파일 23개, 테스트 163개 모두 통과 |
| E2E 테스트 | `npm run test:e2e` | 테스트 파일 3개, 테스트 57개 모두 통과 |

- 기준선에서 실패한 테스트는 없다.
- E2E가 끝날 때 Jest가 "worker process has failed to exit gracefully" 경고를 낸다. 테스트가 끝난 뒤에도 연결이나 타이머 같은 리소스가 정리되지 않고 남았다는 뜻이다. 테스트 결과에는 영향이 없다.
- 2026-10-27 설정 작업 중에 `test/ticket-pause.e2e-spec.ts`가 한 번 2건 실패했다. 이후 재실행 4회는 모두 통과해 재현되지 않았다(`cycle-log.md` 사이클 17).
- 환불 E2E 테스트는 아직 없다. 환불 관련 단위 테스트는 `src/refund/refund.service.spec.ts`(185줄) 하나뿐이다. `src/refund/refund.repository.ts`(402줄)는 단위 테스트가 없다.

## 현재 동작과 새 계약에서 바뀌는 점

| 영역 | 현재 동작 (코드 위치) | 새 계약 |
|---|---|---|
| 고객 환불 신청 | `POST /refund`가 `{ticketId}`만 받는다. 본인 이용권인지만 확인한다. 사용 이력이 없으면 같은 상품의 환불이 동시에 진행되지 않도록 `RefundLock` 행을 만들고, `PaymentCancel`을 REQUESTED로 만든 뒤 PG에 취소를 요청한다. 사용 이력이 있으면 `PaymentCancel`을 PENDING_APPROVAL로 만들어 점주의 금액 입력을 기다린다 (`refund.service.ts` `refund`·`processAutoRefund`·`processPendingApproval`) | 이용 종료 동의를 받아 환불 금액과 이용 종료를 먼저 확정하는 `Refund` 기록을 만들고, PG 취소 요청은 그 아래의 별도 시도로 처리한다(US1). 사용 이력이 있는 이용권의 승인 대기 흐름은 새 신청 경로에서 없어진다 |
| 점주 매장 환불 | 없다 | 점주가 자기 매장 이용권의 환불을 확정한다(US2) |
| 중복 진행 방지 | `RefundLock` 행과 만료 시각으로 막는다. 만료된 잠금은 다음 신청이 PG 거래조회로 정리한다 (`acquireStaleLock`·`clearStaleLock`) | 상품당 확정 환불 1건 unique 제약과 Ticket·Refund 행 잠금으로 대체한다. 기존 `RefundLock`은 데이터 전환 단계(Phase 13)에서 제거한다 |
| PG 취소 요청 | `PgService.requestPaymentCancel`은 500ms 기다린 뒤 거래 로그만 남긴다. 반환값이 없다 (`pg.service.ts`) | 송신 결과 NOT_SENT / ACCEPTED / UNKNOWN / SUCCEEDED / REJECTED를 반환한다 (API 계약 §8, T016) |
| PG 거래조회 | `PgService.inquiryPaymentCancel`은 실제 조회 없이 항상 NOT_FOUND를 반환한다. 결과 종류는 NOT_FOUND / SUCCEEDED / FAILED / IN_PROGRESS 네 가지다 (`pg.service.ts`, `pg.types.ts`) | SUCCEEDED / FAILED / IN_PROGRESS / NOT_FOUND / QUERY_ERROR. NOT_FOUND는 PG가 미접수를 확실히 확인한 경우(`authoritative: true`)에만 쓴다. 지금 코드는 미연동 상태인데도 NOT_FOUND를 내므로, 현재 동작을 고정하는 테스트(U50)를 먼저 쓰고 바꾼다 |
| PG 취소 결과 콜백 | `POST /refund/callback`은 JWT 인증만 거친다. 본문의 `success`·`paymentCancelId`·`amount`로 결과를 확정한다 (`refund.controller.ts`) | JWT 대신 원문 HMAC 서명과 발송 시각으로 인증한다(US7) |
| 시스템 자동 환불 | `refundBySystem`이 결제 승인 뒤 좌석을 줄 수 없을 때 미사용 이용권을 환불한다 | 승인 금액 불일치 자동 취소(US6)와 함께 새 환불 기록 구조로 옮긴다 |
| 결제 승인 금액 불일치 | 결제를 실패 처리하고 선점 좌석을 풀고 `PaymentAmountMismatchError`를 던진다 (`payment.service.ts` `callbackPayment`) | 승인된 금액(`approvedAmount`)을 저장하고 자동 취소를 진행한다(US6) |
| 환불 내역 조회 | `GET /refund/shop/:shopId`, `GET /refund/user/:userId`가 경로의 ID만으로 조회한다. 요청자가 그 매장의 점주인지, 본인인지 확인하지 않는다 (`refund.controller.ts`) | 고객은 본인, 점주는 현재 ShopOwner인 매장, MANAGER는 전체 범위로 제한한다(US8) |

## 테스트 기반 작업(T002·T003)에서 정한 것

- **`test/helpers/refund-test-context.ts`**: 환불 E2E 파일들이 함께 쓰는 앱 기동과 기본 데이터다. 기존 `test/seat-type.e2e-spec.ts`처럼 `main.ts`와 같은 ValidationPipe·TransformInterceptor·HttpExceptionFilter를 등록한다. 고객, 다른 고객, 점주, 공동 점주, 다른 매장 점주, MANAGER와 두 매장을 만든다. 이용권은 실제 주문·결제 API로 발급한다. 정리할 때는 이 컨텍스트가 만든 사용자·매장 ID 기준으로만 지운다.
- **`test/helpers/refund-pg.stub.ts`**: 테스트 전용 PG 대역이다. 송신·조회 결과를 미리 정해 두고, 호출된 PG 취소 요청 식별자와 금액을 기록하며, 응답 지연과 응답 전 중단을 흉내 낸다. 결과 종류는 API 계약 §8을 그대로 따른다. 운영 코드에는 성공을 강제하는 스위치를 넣지 않는다.
- **아직 정해지지 않은 연결**: 운영 코드의 새 PG 메서드 이름과 결과 타입은 T016에서 `src/pg/pg.types.ts`에 정한다. 대역을 앱에 끼우는 교체 지점은 T018에서 만든다. 대역의 메서드 이름 `sendCancel`·`inquireCancel`과 결과 타입은 지금 계약 §8을 기준으로 임시로 정했다. T016에서 운영 타입이 생기면 대역이 그 타입을 가져다 쓰도록 맞춘다.
