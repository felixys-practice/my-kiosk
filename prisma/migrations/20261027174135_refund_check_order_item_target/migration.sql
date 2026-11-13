-- 상품 대상 환불은 주문 항목이 필수 (data-model §2·§6)
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_item_target_check"
CHECK ("target_kind" <> 'ORDER_ITEM' OR "order_item_id" IS NOT NULL);
