-- PG 취소 요청의 횟수 필드는 0 이상 (data-model §6 "횟수는 음수 금지")
ALTER TABLE "payment_cancels" ADD CONSTRAINT "payment_cancels_counts_check" CHECK (
  "resend_count" >= 0
  AND "manual_resend_count" >= 0
  AND "inquiry_count" >= 0
  AND "inquiry_failure_count" >= 0
  AND "send_attempt_count" >= 0
);
