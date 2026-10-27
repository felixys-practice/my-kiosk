-- 별도 환불금 지급 금액은 양수 (data-model §5)
ALTER TABLE "manual_refund_payouts" ADD CONSTRAINT "manual_refund_payouts_amount_check" CHECK ("amount" > 0);
