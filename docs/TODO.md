# 프로젝트 Todos

**2026-11-18**

✅ 1. 현재 구현과 다른 주석·문서를 정리해야 합니다.
   - refund-operations.service.ts:364 (src/refund/refund-operations.service.ts:364)에 제거된 “운영자 직접 재시도”를 안내하는 주석이 남아 있습니다.
   - release-checklist.md:16 (specs/002-refund-completion/release-checklist.md:16)도 PG 개별 확인과 일반 PG 재요청을 별도 API처럼 설명합니다.
   - verification.md:360 (specs/003-pg-client/verification.md:360)의 최종 결과는 이전 650개·212개입니다. 이후 변경과 666개·213개 검증 결과를 후속 기록으로 추가해야 합니다.
✅ 2. 남은 린트와 최종 빌드를 확인해야 합니다.

   직전 실행에서는 기존 통합 테스트의 ESLint 오류 1건과 Swagger 명명 경고 2건이 남았습니다. 최근 재시도 변경 후 빌드는 아직 실행하지 않았습니다.
3. 새로 변경한 상태 전이의 경계 조건을 집중 검수하는 것이 좋습니다.

   특히 내부 실패를 성공·처리 중으로 정정하는 동안 다른 지급 작업이나 콜백이 들어오는 경우, 여러 PaymentCancel의 결과가 누적되는 경우, 리스 만료 후 복구되는 경우를 코드·테스트 대응표로 확인할 필요가 있습니다. 현재 결함이 확인됐다는 뜻은 아니며, 전체 테스트 통과와 별도로 해당 조건의 검증 근거를 확인하는 작업입니다.

---

- [ ] 별도 지급 실패 후 `MANUAL → PG` 지급 방식 전환 절차를 결정하고 구현한다.
  - 현재 동작: 별도 지급 예약을 확실한 미지급 근거로 종료하면 `ManualRefundPayout.status=FAILED`로 변경하지만, `Refund.payoutMethod=MANUAL`은 유지한다. `pg-check`는 이 환불을 PG 조회·재전송·새 요청 생성 대상에서 제외한다.
  - 예시: 환불금이 1만 원인 경우

    1. **PG 취소가 실패한다.**

       `Refund.payoutStatus=ACTION_REQUIRED`, `Refund.payoutMethod=PG`, `Refund.paidAmount=0`인 상태다.

    2. **운영자가 계좌 이체로 지급하기 위해 예약한다.**

       `ManualRefundPayout.status=RESERVED` 기록이 생성되고 `Refund.payoutMethod=MANUAL`로 변경된다. 예약 API는 실제 송금을 수행하지 않는다.

    3. **계좌 이체를 하지 않았다는 확실한 근거로 예약을 종료한다.**

       `ManualRefundPayout.status=FAILED`로 변경하지만, `Refund.payoutMethod=MANUAL`과 지급액 0원은 유지된다.

    4. **운영자가 다시 PG 취소로 1만 원을 지급하려 한다.**

       이때 필요한 절차가 `MANUAL → PG` 전환이다. 현재 `pg-check`는 저장 상태만 반환하며 PG를 호출하지 않는다. PG 지급 방식으로 변경하고 취소를 재개하는 조건·절차는 아직 미결이다.

  - 미결 사항: 전환 API·실행 권한, 별도 지급이 없었음을 확인하는 조건, 기존 PG 요청 조회 결과별 처리, `Refund.payoutMethod=PG`로 변경하는 시점과 PG 취소 재개 절차를 결정한다.
  - 중복 지급 방지: 현재 지급액·미확정 PG 요청·활성 별도 지급 예약·다른 지급 작업·작업 토큰을 재검사하고, 반복·동시 실행과 늦은 PG 결과·콜백을 고려한다. 실제 지급 여부가 불명확하거나 단순히 대기 시간이 지났다는 이유로 전환하지 않는다.
  - 관련 코드·계약: `RefundOperationsService.markManualPayoutNotPaid()`, `RefundRepository.findFailedRetryCandidate()`, `specs/002-refund-completion/contracts/rest-api.md`의 별도 지급 미지급 확인·개별 PG 확인 절차.
  - 주석 정리 완료(2026-11-18): `markManualPayoutNotPaid()`에 `Refund.payoutMethod=MANUAL` 유지, `pg-check` 처리 대상 제외, PG 지급 방식 전환 절차 미결을 명시했다. 전환 기능 자체는 미구현이다.
