-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentCancelFailureCode" ADD VALUE 'SEND_FAILED';
ALTER TYPE "PaymentCancelFailureCode" ADD VALUE 'PG_REJECTED';
ALTER TYPE "PaymentCancelFailureCode" ADD VALUE 'RETRY_EXHAUSTED';

-- AlterEnum
ALTER TYPE "PaymentCancelStatus" ADD VALUE 'QUERY_FAILED';

-- AlterTable
ALTER TABLE "payment_cancels" ADD COLUMN     "actual_amount" INTEGER,
ADD COLUMN     "attempt_number" INTEGER,
ADD COLUMN     "claim_token" TEXT,
ADD COLUMN     "claim_until" TIMESTAMP(3),
ADD COLUMN     "inquiry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "inquiry_failure_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_inquiry_at" TIMESTAMP(3),
ADD COLUMN     "last_inquiry_error" TEXT,
ADD COLUMN     "last_send_attempt_at" TIMESTAMP(3),
ADD COLUMN     "manual_resend_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "next_inquiry_at" TIMESTAMP(3),
ADD COLUMN     "query_failed_at" TIMESTAMP(3),
ADD COLUMN     "recovery_generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refund_id" TEXT,
ADD COLUMN     "requested_by_id" TEXT,
ADD COLUMN     "resend_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "retry_reason" TEXT,
ADD COLUMN     "send_attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "approved_amount" INTEGER;

-- CreateIndex
CREATE INDEX "payment_cancels_refund_id_idx" ON "payment_cancels"("refund_id");

-- CreateIndex
CREATE INDEX "payment_cancels_status_next_inquiry_at_idx" ON "payment_cancels"("status", "next_inquiry_at");

-- AddForeignKey
ALTER TABLE "payment_cancels" ADD CONSTRAINT "payment_cancels_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_cancels" ADD CONSTRAINT "payment_cancels_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
