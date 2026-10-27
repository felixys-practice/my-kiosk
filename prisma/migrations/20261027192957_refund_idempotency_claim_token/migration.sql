-- 멱등 처리 중 기록의 담당 토큰 (Phase 2 재검수 P1)

-- AlterTable
ALTER TABLE "refund_idempotency_records" ADD COLUMN     "claim_token" TEXT;

