
-- DropIndex
DROP INDEX "refund_idempotency_records_requester_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "refund_idempotency_records_requester_id_operation_key_key" ON "refund_idempotency_records"("requester_id", "operation", "key");

