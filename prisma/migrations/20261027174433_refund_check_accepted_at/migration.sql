-- 확정된 환불은 업무 확정 시각이 필수, 과거 거절 이력만 null 허용 (data-model §3)
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_accepted_at_check"
CHECK ("decision_status" <> 'ACCEPTED' OR "accepted_at" IS NOT NULL);
