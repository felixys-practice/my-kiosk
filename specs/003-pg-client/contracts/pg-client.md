# PG 결제 취소·조회와 환경 선택 계약

구현할 계약이며 현재 코드의 완료 상태나 실제 PG API 규격이 아니다. 결제 승인 계약은 [인계 문서](../payment-handoff.md)를 참고하여 별도 브랜치에서 설계한다.

## 1. 메서드

`PgService`는 `PG_CLIENT`로 `PgClient`를 주입받는다. 환불 업무 서비스는 `PgService`만 주입받는다.

| `PgService` 메서드 | `PgClient` 메서드 | 기능 | 입력 | 결과 |
| --- | --- | --- | --- | --- |
| `requestPaymentCancel` | `requestPaymentCancel` | PG에 지정 금액의 결제 취소를 요청한다. 업무 상태·실제 지급액·원장 반영은 환불 서비스가 담당한다. | `{ paymentCancelId, amount }`. 클라이언트에는 `AbortSignal` 추가 | 기존 `PgCancelSendResult` |
| `inquirePaymentCancel` | `inquirePaymentCancel` | 지정한 PG 결제 취소 요청의 결과를 조회한다. | `{ paymentCancelId }`. 클라이언트에는 `AbortSignal` 추가 | 기존 `PgCancelQueryResult` |

기존 `sendCancel`·`inquireCancel` 호출처와 테스트는 위 이름으로 변경한다. 승인 요청·승인 저장 완료 통지 메서드는 추가하지 않는다.

클라이언트의 시작 검증 메서드 `validateConfiguration()`은 `{ ready:true }` 또는 `{ ready:false, code, fields? }`를 반환한다. fields에는 설정 이름만 포함한다.

## 2. 결과·오류·업무 반영

취소 요청의 `NOT_SENT / ACCEPTED / UNKNOWN / SUCCEEDED / REJECTED`, 조회의 `SUCCEEDED / FAILED / IN_PROGRESS / NOT_FOUND / QUERY_ERROR`는 기존 의미를 유지한다.

- `PgClient` 구현: PG사 고유 요청·인증·HTTP 응답을 해석한다. 일반 404·인증 오류·조회 반영 지연을 확정 미접수로 바꾸지 않는다.
- `PgService`: 호출 제한 시간·중단을 제어한다. 취소 요청 타임아웃·일반 예외는 `UNKNOWN`, 조회 타임아웃·예외는 `QUERY_ERROR`로 반환한다.
- PG가 반환한 성공 결과에는 요청 시 전달한 `paymentCancelId`가 필요하다. `PgService`는 응답에서 해석한 ID와 호출 시 전달한 ID가 일치하는지 검사한다. 누락·불일치는 요청이면 `UNKNOWN`, 조회면 `QUERY_ERROR`로 처리하고 지급 결과로 전달하지 않는다. 서버가 요청 ID를 응답에 임의로 채워 검증을 통과시키지 않는다. 콜백의 대상 검증은 002 API §7을 따른다.
- 성공 결과에는 비어 있지 않은 취소 거래 ID와 0 이상 안전 정수 실제액이 필요하다. 누락·잘못된 결과는 요청이면 `UNKNOWN`, 조회면 `QUERY_ERROR`다. 요청액과 실제액의 불일치는 숨기지 않고 기존 결과 서비스에 넘긴다.
- `NOT_SENT`는 실제 요청 전에 실패했다는 근거가 있을 때만 클라이언트가 반환한다. 일반 네트워크 예외로 추정하지 않는다.
- `RefundDispatchService`는 즉시 `SUCCEEDED`를 받으면 기존 `RefundResultService`로 전달한다. 콜백을 기다리지 않는다.
- 업무 서비스가 최종 상태 보호·담당 토큰·실제액·원장을 반영한다. 결과 불명은 기존 조회·복구로 확인한다.

제한 시간은 기존 `REFUND_PG_TIMEOUT_SECONDS`를 유지한다. 작업 리스가 제한 시간보다 길어야 한다는 설정 관계도 유지한다. 승인용 제한 시간 설정은 추가하지 않는다.

## 3. 모의 구현

- 최초 취소 요청: 요청받은 `paymentCancelId`, 요청액 전액의 취소 성공과 새 모의 취소 거래 ID를 메모리에 저장하고 즉시 반환한다.
- 같은 요청 ID·금액: 최초 결과를 반환하고 추가 취소 거래를 만들지 않는다.
- 같은 요청 ID·다른 금액: 최초 결과를 유지하고 `UNKNOWN`을 반환한다. 조회는 최초 실제액을 반환하므로 기존 금액 불일치 처리로 확인할 수 있다.
- 저장된 ID 조회: 같은 취소 거래 ID·실제액 반환.
- 기록 없는 ID 조회: `QUERY_ERROR`. 재시작·다른 프로세스·처음 보는 요청을 모두 확정 미접수로 판단하지 않는다.

상태는 `SimulatedPgClient` 인스턴스의 Map에만 저장한다. 외부 저장소·업무 DB 접근·HTTP 자동 콜백·타이머 전달 작업은 추가하지 않는다. 취소 콜백 자체는 기존 수신 기능과 테스트를 유지한다.

## 4. 운영용 골격

`ProductionPgClient`는 실제 PG의 요청 매핑·인증·통신·중단·응답 해석·전송 전후 실패 판단을 어디에 구현할지 설명한다. 실제 PG사를 추정한 URL·응답 코드·성공 응답은 넣지 않는다.

`validateConfiguration()`은 이번 골격에서 항상 `PG_IMPLEMENTATION_INCOMPLETE`와 `ready:false`를 반환한다. 취소 요청·조회 메서드는 명시적 미구현 오류를 낸다. 사용자가 준비 상태를 환경변수로 우회하지 못하게 한다. 승인 메서드 골격은 별도 결제 작업에서 정한다.

## 5. 서버 시작 검증

| 구성 | 처리 |
| --- | --- |
| PG_MODE 누락·simulated/production 외 값 | PG_MODE_INVALID, 사유 안내 후 시작 거부 |
| PG_MODE=simulated, NODE_ENV=development 또는 test | SimulatedPgClient 선택 |
| PG_MODE=simulated, NODE_ENV=production | PG_MODE_FORBIDDEN, 사유 안내 후 시작 거부 |
| PG_MODE=production, 이번 운영용 골격 | PG_IMPLEMENTATION_INCOMPLETE, 실제 연동 미구현 안내 후 시작 거부 |
| 선택 구현의 필수 설정 누락 | PG_CONFIGURATION_MISSING, 항목명 안내 후 시작 거부 |

Joi는 모드·환경을 확인하고 provider factory는 선택한 구현의 준비 여부를 검사한다. 기존 JWT·DB·콜백 서명 등 앱 필수 설정은 유지한다. 실제 운영 PG사의 추가 설정은 PG 선정 후 정하며 이번에 가상 키를 요구하지 않는다.

검사 통과 시 모드·클래스명을 시작 로그에 남긴다. 실패 시 코드·항목명·사유만 남기고 전체 env·비밀값·개인정보 원문을 출력하지 않는다. 자동 모의 대체·접속 확인 요청은 하지 않는다. 위 코드는 시작 검증용이며 HTTP 오류 코드가 아니다.

## 6. 공개 API와 결제 경계

공개 환불·결제 경로와 결제 DTO는 유지한다. 환불 콜백 DTO는 2026-11-16 계약 변경에 따라 orderItemId를 제거하고 paymentCancelId로만 취소 요청을 식별한다. [002 API §7·§8](../../002-refund-completion/contracts/rest-api.md)을 따른다.

이번 구조에서 환불 호출 경로가 바뀌므로 기존 결제 승인 콜백의 시스템 환불도 새 취소·조회 경로를 사용한다. 승인 요청·승인 상태 전이·이용권 발급·승인 저장 메서드는 수정하지 않는다. 새 공개 PG 조회 API도 추가하지 않는다.
