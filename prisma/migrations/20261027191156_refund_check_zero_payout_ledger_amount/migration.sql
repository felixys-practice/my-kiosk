-- 환불에 연결되고 두 지급 연결이 모두 없는 원장(0원 환불 원장)은 금액이 0이어야 한다 (data-model §8, tasks T010)
-- refund_id가 없는 매출 원장은 이 제약을 받지 않는다
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_zero_payout_amount_check"
CHECK ("refund_id" IS NULL OR "payment_cancel_id" IS NOT NULL OR "manual_refund_payout_id" IS NOT NULL OR "amount" = 0);
