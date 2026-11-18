# 별도 결제 브랜치 작업 인계

**작성일**: 2026-11-14
**작성 위치**: feature/pg-client
**문서 성격**: 논의·근거·미결정 보존용. 결제 기능 명세나 구현 완료 기록이 아니다.

## 다음 세션에서 먼저 읽을 내용

사용자는 결제 로직을 별도 브랜치에서 진행할 의사를 밝혔다. 이에 따라 현재 PG 작업에서 결제 승인 연동을 분리하는 방향을 제안했다. 이 문서는 논의를 보존한다. 2026-11-14 사용자 요청으로 003 활성 명세·계획은 취소·조회 중심으로 범위를 축소했다. 아래 승인 계약·자동 콜백 논의는 별도 결제 작업에서 재검토할 과거 제안이다.

실제 결제 PG사·API는 미정이다. 결제 승인 API의 응답이 접수인지 최종 승인 결과인지도 해당 PG 규격에 따라 정해야 한다. 기존 임시 코드의 콜백 흐름을 근거로 모든 운영 PG가 같은 절차를 사용한다고 가정하지 않는다.

## 현재 코드에서 확인한 사실

| 위치 | 현재 동작 |
| --- | --- |
| [payment.service.ts](../../src/payment/payment.service.ts) requestPayment | 결제 PENDING 생성 → 내부 임시 requestVan 호출 → PG 거래 ID·REQUESTED 저장. PgService를 호출하지 않는다. |
| [payment.repository.ts](../../src/payment/payment.repository.ts) requestedPayment | Payment.pgTransactionId 저장과 Payment.status=REQUESTED 변경. PG 전송 메서드가 아니다. |
| payment.service.ts callbackPayment·handleCallback·successPayment | 서명 콜백의 승인 결과에 따라 상태·금액을 확인하고 결제 성공·이용권 발급·좌석 처리를 수행한다. |
| payment.service.ts failMismatchAndStartRefund | 승인액 불일치 시 실제액 저장·결제 실패·좌석 선점 해제·시스템 환불 확정을 트랜잭션으로 처리하고 커밋 후 PG 취소 요청. 이용권 미발급. |
| [pg.service.ts](../../src/pg/pg.service.ts) requestPaymentApproval | 지연·로그만 있는 임시 구현. 실제 승인 요청 경로와 연결되지 않는다. |
| [payment.controller.ts](../../src/payment/payment.controller.ts) callback | /payments/callback은 기존 PgSignatureGuard를 사용한다. |

결제 로직이 전부 없는 상태는 아니다. 실제 승인 요청 통신은 임시이지만 승인 콜백의 업무 처리와 시스템 환불 연결은 존재한다. 재개 시 현재 코드·브랜치·미커밋 상태를 다시 확인한다.

## 실제 PG 절차를 확인하면서 드러난 설계 문제

이전 003 설계는 “승인 요청 접수 응답의 거래 ID 저장 → 별도 승인 콜백 → 결제 성공”을 공통 계약으로 정했다. 토스페이먼츠의 일반 카드 결제는 인증 후 서버가 승인 API를 호출하고 응답에서 최종 승인 결과를 확인한다. 따라서 승인 메서드가 거래 ID만 반환하고 최종 결과는 무조건 콜백으로 받도록 고정한 설계는 다시 검토해야 한다.

참고한 공식 자료:

- [토스 결제 흐름](https://docs.tosspayments.com/guides/v2/get-started/payment-flow)
- [토스 승인·취소 API](https://docs.tosspayments.com/reference)
- [웹훅 이벤트](https://docs.tosspayments.com/reference/using-api/webhook-events)

자료 확인일은 작성일과 같다. 토스를 채택하기로 결정한 것은 아니다. 카드·가상계좌·기타 비동기 결제수단의 절차를 동일하게 취급하지 않는다.

환불은 현재 RefundDispatchService가 즉시 SUCCEEDED를 받아 RefundResultService에 실제액·취소 거래 ID를 전달하는 경로를 이미 갖는다. 승인도 즉시 성공과 비동기 결과를 어떤 공통 처리에 연결할지 검토해야 한다.

## 기존 논의와 그 적용 한계

### 승인 요청 오류

사용자는 이번 003 작업에서는 기존 승인 요청 예외의 FAILED 처리를 유지하는 A안을 선택했다. 이는 실제 운영 결제의 올바른 복구 정책을 확정했다는 뜻이 아니다.

- 현재 승인 요청 예외와 요청 상태 저장 실패는 모두 Payment.status=FAILED 처리 범위다.
- 이미 FAILED인 결제에 늦은 승인 성공 콜백이 오면, 기존 승인액 불일치 중복 통보 외에는 PaymentAlreadyClosedError로 거부한다.
- 환불 복구는 PaymentCancel.id로 취소 결과를 조회한다. Payment의 승인 결과 불명을 복구하는 로직이 아니다.
- 실제 승인 후 응답 유실, PG 거래 ID 저장 실패, 지연·중복 콜백, 서버 중단 시 상태와 후속 확인 방법은 결제 작업에서 결정해야 한다.

### 모의 승인

사용자는 개발용 모의 승인 결과의 자동 전달을 선택했다. 이후 승인 절차를 재검토하게 됐으므로, “자동으로 기본 결제 흐름을 확인한다”는 목적과 “항상 서명 HTTP 콜백으로 전달한다”는 구체적 방식은 구분해 재확인해야 한다.

이전 003 설계의 notifyApprovalRequestStored는 확정된 운영 PG 요구가 아니라 기존 비동기 모의 콜백의 레이스를 막기 위해 제안한 메서드다.

- 현행 코드는 PG 응답 후 pgTransactionId·REQUESTED를 저장한다.
- 그 전에 모의 콜백이 오면 ID로 결제를 찾지 못하거나 상태 조건이 맞지 않는다.
- setTimeout·setImmediate·고정 지연만으로 DB 저장 순서를 보장할 수 없다.
- 저장 후 명시적 통지, 전달 재시도, 승인 결과 즉시 반영 구조 등을 비교했다. 자동 콜백을 쓰지 않는 설계를 선택하면 저장 완료 통지 자체가 불필요할 수 있다.
- 콜백 방식이 필요하면 기존 서명·원문 바이트·실제 수신 포트·종료 중단·오류 처리를 보존한다. 모의 전달 코드가 업무 DB를 직접 변경하지 않는다.

### 이름

- 승인 요청: requestPaymentApproval
- 취소 요청: requestPaymentCancel
- 취소 결과 조회: inquirePaymentCancel
- 상태 저장: requestedPayment → markPaymentRequested 변경을 논의하고 문서에 반영했지만 코드는 변경하지 않았다.
- notifyApprovalRequestStored의 Request는 저장한 “승인 요청”을 뜻하는 명사다. 메서드의 필요성은 승인 절차 결정 후 다시 판단한다.

이름 합의가 메서드의 입출력·상태 전이까지 확정한 것으로 해석되지 않도록 한다.

## 결제 작업에서 결정할 순서

1. 지원할 PG 연동 방식과 승인 응답·콜백의 의미를 확인한다. 실제 PG사 미정이면 가정과 지원 범위를 명시한다.
2. 즉시 승인 성공·실패·접수·결과 불명 중 필요한 결과를 정하고, 기존 결제 상태·PG 거래 식별자와 연결한다.
3. 즉시 응답과 콜백이 동일한 승인 업무 처리를 사용하도록 설계한다. 중복 발급·동시 도착·늦은 결과·금액 불일치·좌석 실패를 보존한다.
4. 요청 전 실패·전송 후 결과 불명·PG 확정 실패·응답 후 DB 저장 실패를 구분하고 조회·재요청·고객 응답을 결정한다.
5. 그 뒤 PgClient 승인 메서드·모의 구현·자동 전달·저장 완료 통지의 필요성과 계약을 정한다.
6. 별도 Spec Kit 명세와 테스트 계획을 만들고 기존 환불 계약과 회귀 범위를 연결한다.

승인 조회 API나 복구 워커를 필요성 검토 없이 추가하지 않는다. 실제 PG사가 보장하는 식별자·조회·멱등성과 프로젝트 업무 정책을 구분한다.

## 현재 PG 브랜치에서 분리한 항목

- requestVan 교체와 실제 승인 경로 연결
- requestedPayment 명칭 변경
- 모의 승인·서명 HTTP 콜백 자동 전달
- notifyApprovalRequestStored 및 승인 timeout·오류 계약

이번 PG 브랜치의 활성 문서에는 취소·조회 구조, 운영용 골격, 개발용 모의 취소·조회, 환경 선택·시작 검증을 남겼다. 문서 범위만 조정했으며 코드는 변경하지 않았다. 기존 승인 콜백이 시작하는 시스템 환불은 새 취소·조회 구조에서도 보존해야 한다.

현재 환불 설계 문서: [spec](spec.md), [plan](plan.md), [research](research.md), [계약](contracts/pg-client.md), [데이터 모델](data-model.md). 승인에 관한 기존 논의는 현재 활성 문서 대신 이 인계 문서를 기준으로 재개한다.

## 재개용 요청 예시

> payment-handoff.md를 먼저 읽고 현재 코드와 Git 상태를 다시 확인하라. 결제 작업은 별도 브랜치에서 진행한다. 기존 003의 콜백 중심 승인 계약은 재검토 대상이다. 즉시 승인 결과와 비동기 결과의 처리, 승인 요청 결과 불명 정책을 근거와 함께 비교하라. 코드·명세 수정 전에 범위를 설명하고 승인을 기다려라.

## 작업 보호 조건

- 현재 브랜치: feature/pg-client. 새 결제 브랜치는 아직 생성하지 않았다.
- 기존 미추적 .serena/·src/idempotency-challenge/를 작업에 포함하지 않는다.
- 문서·코드 수정은 승인된 범위에서 진행한다. 커밋·푸시·PR은 별도 요청이 필요하다.
- 현재 인계 문서 작성은 계획·코드 구현이나 실행 검증의 완료를 뜻하지 않는다.
