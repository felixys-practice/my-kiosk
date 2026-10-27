-- 환불 안의 PG 취소 요청 시도 번호는 중복 불가 (data-model §6)
CREATE UNIQUE INDEX "payment_cancels_refund_id_attempt_number_key" ON "payment_cancels"("refund_id", "attempt_number");
