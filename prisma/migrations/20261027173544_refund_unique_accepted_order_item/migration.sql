-- 확정된 상품 대상 환불은 주문 항목당 하나만 허용 (data-model §6)
-- 과거 거절 이력(LEGACY_REJECTED)은 이 제약에서 제외해 함께 보존한다
CREATE UNIQUE INDEX "refunds_order_item_id_accepted_key"
ON "refunds" ("order_item_id")
WHERE "decision_status" = 'ACCEPTED' AND "target_kind" = 'ORDER_ITEM';
