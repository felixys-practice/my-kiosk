-- 신규 고객·매장 환불은 이용 종료 동의 시각이 필수 (data-model §3·§6). SYSTEM과 과거 이력은 제외
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_accepted_consent_check"
CHECK ("decision_status" <> 'ACCEPTED' OR "source" NOT IN ('CUSTOMER', 'STORE') OR "termination_consented_at" IS NOT NULL);
