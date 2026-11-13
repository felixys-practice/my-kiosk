-- 지급 대상 아님(NOT_APPLICABLE)은 과거 거절 이력에서만 쓴다 (data-model §3)
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_not_applicable_legacy_check"
CHECK ("payout_status" <> 'NOT_APPLICABLE' OR "decision_status" = 'LEGACY_REJECTED');
