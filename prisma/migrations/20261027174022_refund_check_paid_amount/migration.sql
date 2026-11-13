-- 환불금 지급 합계는 0 이상 (data-model §3·§6)
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paid_amount_check" CHECK ("paid_amount" >= 0);
