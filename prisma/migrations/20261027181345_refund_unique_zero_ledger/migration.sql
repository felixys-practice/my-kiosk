-- 0원 환불 원장(지급 연결 없음)은 환불당 하나만 허용 (data-model §8)
CREATE UNIQUE INDEX "ledger_refund_id_zero_payout_key"
ON "ledger" ("refund_id")
WHERE "refund_id" IS NOT NULL AND "payment_cancel_id" IS NULL AND "manual_refund_payout_id" IS NULL;
