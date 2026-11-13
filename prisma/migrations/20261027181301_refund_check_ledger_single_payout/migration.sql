-- 환불 원장은 PG 결제 취소와 별도 환불금 지급 중 하나만 가리킨다 (data-model §8)
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_single_payout_check"
CHECK ("payment_cancel_id" IS NULL OR "manual_refund_payout_id" IS NULL);
