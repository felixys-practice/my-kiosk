-- 모든 PG 취소 요청의 환불 내 시도 번호를 필수로 저장한다.
ALTER TABLE "payment_cancels" ALTER COLUMN "attempt_number" SET NOT NULL;
