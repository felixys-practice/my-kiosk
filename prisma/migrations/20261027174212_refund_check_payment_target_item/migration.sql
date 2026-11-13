-- 결제 전체 대상 환불은 주문 항목 없이 결제만 가리킨다 (data-model §2·§6)
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_target_item_check"
CHECK ("target_kind" <> 'PAYMENT' OR "order_item_id" IS NULL);
