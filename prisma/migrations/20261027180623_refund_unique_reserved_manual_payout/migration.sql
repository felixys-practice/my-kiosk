-- 한 환불에 활성 별도 환불금 지급 예약(RESERVED)은 하나만 허용 (data-model §6)
CREATE UNIQUE INDEX "manual_refund_payouts_refund_id_reserved_key"
ON "manual_refund_payouts" ("refund_id")
WHERE "status" = 'RESERVED';
