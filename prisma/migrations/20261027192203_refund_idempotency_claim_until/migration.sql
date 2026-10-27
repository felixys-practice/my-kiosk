-- 멱등 처리 중 기록의 처리 기한 (Phase 2 검수 R4)

-- AlterTable
ALTER TABLE "refund_idempotency_records" ADD COLUMN     "claim_until" TIMESTAMP(3);

