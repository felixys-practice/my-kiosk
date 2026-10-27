-- 결제 전체 대상 환불은 승인 금액 불일치 자동 취소(SYSTEM)만 만든다 (data-model §2·§6)
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_target_source_check"
CHECK ("target_kind" <> 'PAYMENT' OR "source" = 'SYSTEM');
