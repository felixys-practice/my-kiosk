-- 확정된 환불 금액은 0 이상 (data-model §3·§6)
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_check" CHECK ("amount" >= 0);
