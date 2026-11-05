# 환불 기능 최종 대조와 검증 기록

## 1. 명세·시나리오·API 의미 대조

아래 항목은 `spec.md`, `acceptance-scenario-diagrams.md`, `contracts/rest-api.md`와 환불 컨트롤러의 HTTP 경로를 대조한 결과다. 다이어그램은 업무 흐름을, API 계약은 요청·응답을 설명한다. 서로 다른 표현이 가리키는 저장 동작과 호출 경로를 아래처럼 구분한다.

| 다르게 읽힐 수 있는 표현 | 현재 적용하는 의미와 실제 API |
|---|---|
| 고객·점주의 환불 접수와 환불금 지급 | `POST /refund`, `POST /refund/shop/:shopId`는 이용 종료와 환불 금액을 확정한다. 양수 환불의 202는 실제 환불금 지급 완료가 아니다. 지급액·미지급액은 `GET /refund/:refundId`에서 별도로 확인한다. 근거: FR-006·FR-015·FR-035, 계약 §3·§4, QS-1-1·QS-2-1. |
| PG 개별 확인과 운영자의 PG 재요청 | `POST /refund/:refundId/pg-check`는 저장된 취소 요청을 PG에 조회한다. 확실한 미접수이면 같은 ID로 재전송하고, 이미 실패한 시도에 대한 확실한 미접수·거절 확정이면 조건을 다시 확인한 뒤 새 ID로 요청한다. `POST /refund/:refundId/payout-retries`는 운영자가 사유와 멱등 키를 제출하는 별도 직접 재시도다. 근거: FR-052~057, 계약 §5·§8, QS-5-13~20·QS-10-1~1d. |
| 별도 환불금 지급 예약과 실제 지급 | `POST /refund/:refundId/manual-payouts`는 중복 지급을 막기 위한 `RESERVED` 기록이며 송금이나 원장 생성이 아니다. 운영자가 실제 지급의 시각·거래 ID·증빙을 확인한 뒤 `POST /refund/:refundId/manual-payouts/:payoutId/confirm`으로 지급액과 원장을 확정한다. 근거: FR-045·FR-046, 계약 §5, QS-10-3·QS-10-4. |
| 지급 여부가 불명확한 예약과 미지급 확정 | 기다린 시간만으로 예약을 해제하지 않는다. 실제 지급하지 않았다는 근거가 확인되면 `POST /refund/:refundId/manual-payouts/:payoutId/not-paid`가 예약을 `FAILED`로 종료하고 다른 지급의 차단을 해제한다. 이때 실제 지급액과 원장은 늘지 않는다. 근거: FR-047, 계약 §5, QS-10-5·QS-10-10. |
| PG 초과 취소 검토와 초과액 회수 | `POST /refund/:refundId/amount-review`는 운영자가 초과 취소의 검토 결과를 기록한다. 확정 환불 금액·PG 실제액·원장을 수정하거나 초과액을 회수하는 API가 아니다. 근거: FR-049, 계약 §5, QS-10-8. |
| 자동 복구 재개와 환불금 지급 완료 | `POST /refund/recovery/resume`는 결과 확인 실패 건의 재조회를 예약한다. PG 성공 확인 전에는 환불금 지급 완료가 아니다. 근거: FR-026a, 계약 §8, QS-5-10a. |

위 경로는 컨트롤러의 Swagger 요약에도 같은 뜻으로 표시했다. 실제 PG와 은행 연동은 `release-checklist.md`의 미확인 항목으로 남는다.

## 2. 실행 검증

T178에서 전체 단위·E2E, 빌드, 변경 파일 ESLint, 의도적 오류 검출과 원복 결과를 명령·실행 시각·환경·통과 수로 기록한다. T177의 컨트롤러 변경 뒤 `npx tsc --noEmit`과 변경한 네 컨트롤러의 ESLint는 통과했다. 이 문서의 명세 대조를 전체 기능 회귀 통과로 계산하지 않는다.
