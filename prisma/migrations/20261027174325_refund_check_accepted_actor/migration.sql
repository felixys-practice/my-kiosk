-- 신규 고객·매장 환불은 실행자가 필수 (data-model §3·§6). SYSTEM과 과거 이력은 제외
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_accepted_actor_check"
CHECK ("decision_status" <> 'ACCEPTED' OR "source" NOT IN ('CUSTOMER', 'STORE') OR "requested_by_id" IS NOT NULL);
