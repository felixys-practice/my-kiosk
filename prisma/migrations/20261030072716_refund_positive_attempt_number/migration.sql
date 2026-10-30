-- PG 취소 시도 번호는 환불 안에서 1부터 시작한다.
ALTER TABLE "payment_cancels" ADD CONSTRAINT "payment_cancels_attempt_number_check" CHECK ("attempt_number" >= 1);
