-- 환불에 연결된 PG 취소 요청의 대상 상품은 환불의 대상 상품과 같아야 한다 (data-model §4 "새 행의 연결은 Refund와 같아야 한다")
-- 다른 테이블 값과 비교하므로 CHECK 제약 대신 행 단위 검사 트리거로 막는다. 결제 전체 대상(PAYMENT)은 둘 다 null이다

-- 기존 데이터가 이미 조건을 어기면 마이그레이션을 멈춘다(어긴 행을 먼저 정리해야 한다)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "payment_cancels" pc
      JOIN "refunds" r ON r."id" = pc."refund_id"
     WHERE pc."order_item_id" IS DISTINCT FROM r."order_item_id"
  ) THEN
    RAISE EXCEPTION 'payment_cancels_refund_target_check: 환불과 대상 상품이 다른 PG 취소 요청이 이미 있습니다';
  END IF;
END
$$;

CREATE FUNCTION "payment_cancels_refund_target_check"() RETURNS trigger AS $$
BEGIN
  IF NEW."refund_id" IS NOT NULL AND NEW."order_item_id" IS DISTINCT FROM (
    SELECT r."order_item_id" FROM "refunds" r WHERE r."id" = NEW."refund_id"
  ) THEN
    RAISE EXCEPTION 'payment_cancels_refund_target_check: PG 취소 요청의 대상 상품이 환불의 대상 상품과 다릅니다'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payment_cancels_refund_target_check"
  BEFORE INSERT OR UPDATE OF "refund_id", "order_item_id" ON "payment_cancels"
  FOR EACH ROW EXECUTE FUNCTION "payment_cancels_refund_target_check"();
