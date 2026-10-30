-- 모든 PG 취소 요청은 확정된 환불에 연결한다. 과거 개발 데이터 이관은 범위에서 제외했다.
ALTER TABLE "payment_cancels" ALTER COLUMN "refund_id" SET NOT NULL;
