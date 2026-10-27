-- 확정된 결제 전체 대상 환불(승인 금액 불일치 자동 취소)은 결제당 하나만 허용 (data-model §6)
CREATE UNIQUE INDEX "refunds_payment_id_accepted_key"
ON "refunds" ("payment_id")
WHERE "decision_status" = 'ACCEPTED' AND "target_kind" = 'PAYMENT';
