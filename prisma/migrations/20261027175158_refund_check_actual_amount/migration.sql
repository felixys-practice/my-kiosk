-- PG가 확인한 실제 취소액은 0 이상 (data-model §6)
ALTER TABLE "payment_cancels" ADD CONSTRAINT "payment_cancels_actual_amount_check" CHECK ("actual_amount" >= 0);
