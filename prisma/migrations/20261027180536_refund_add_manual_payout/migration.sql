-- 별도 환불금 지급 모델과 정지 기록의 재개 없는 종료 필드 (data-model §5, tasks T009)

-- CreateEnum
CREATE TYPE "TicketPauseCloseReason" AS ENUM ('REFUND_TERMINATED');

-- CreateEnum
CREATE TYPE "ManualRefundPayoutStatus" AS ENUM ('RESERVED', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "ticket_pauses" ADD COLUMN     "close_reason" "TicketPauseCloseReason",
ADD COLUMN     "closed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "manual_refund_payouts" (
    "id" TEXT NOT NULL,
    "refund_id" TEXT NOT NULL,
    "status" "ManualRefundPayoutStatus" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reserved_by_id" TEXT NOT NULL,
    "reserved_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "external_transaction_id" TEXT,
    "evidence_reference" TEXT,
    "not_paid_evidence" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_refund_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manual_refund_payouts_refund_id_idx" ON "manual_refund_payouts"("refund_id");

-- CreateIndex
CREATE INDEX "manual_refund_payouts_status_reserved_at_idx" ON "manual_refund_payouts"("status", "reserved_at");

-- AddForeignKey
ALTER TABLE "manual_refund_payouts" ADD CONSTRAINT "manual_refund_payouts_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_refund_payouts" ADD CONSTRAINT "manual_refund_payouts_reserved_by_id_fkey" FOREIGN KEY ("reserved_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_refund_payouts" ADD CONSTRAINT "manual_refund_payouts_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

