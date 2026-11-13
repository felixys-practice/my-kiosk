-- 한 환불에 미확정 PG 취소 요청(REQUESTED·QUERY_FAILED)은 하나만 허용 (data-model §6)
CREATE UNIQUE INDEX "payment_cancels_refund_id_active_key"
ON "payment_cancels" ("refund_id")
WHERE "status" IN ('REQUESTED', 'QUERY_FAILED');
