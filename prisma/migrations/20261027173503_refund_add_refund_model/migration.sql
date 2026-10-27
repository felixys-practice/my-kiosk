-- CreateEnum
CREATE TYPE "RefundTargetKind" AS ENUM ('ORDER_ITEM', 'PAYMENT');

-- CreateEnum
CREATE TYPE "RefundSource" AS ENUM ('CUSTOMER', 'STORE', 'SYSTEM', 'LEGACY_UNKNOWN');

-- CreateEnum
CREATE TYPE "RefundDecisionStatus" AS ENUM ('ACCEPTED', 'LEGACY_REJECTED');

-- CreateEnum
CREATE TYPE "RefundPayoutStatus" AS ENUM ('PENDING', 'ACTION_REQUIRED', 'PAID', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "RefundPayoutMethod" AS ENUM ('PG', 'MANUAL');

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "order_item_id" TEXT,
    "target_kind" "RefundTargetKind" NOT NULL,
    "source" "RefundSource" NOT NULL,
    "decision_status" "RefundDecisionStatus" NOT NULL,
    "policy_version" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paid_amount" INTEGER NOT NULL DEFAULT 0,
    "payout_status" "RefundPayoutStatus" NOT NULL,
    "payout_method" "RefundPayoutMethod" NOT NULL DEFAULT 'PG',
    "review_required" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_reason" TEXT,
    "review_evidence_reference" TEXT,
    "action_code" TEXT,
    "action_reason" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "terminated_at" TIMESTAMP(3),
    "requested_by_id" TEXT,
    "termination_consented_at" TIMESTAMP(3),
    "exit_consented_at" TIMESTAMP(3),
    "reason" TEXT,
    "ended_session_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_order_item_id_idx" ON "refunds"("order_item_id");

-- CreateIndex
CREATE INDEX "refunds_payout_status_idx" ON "refunds"("payout_status");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_ended_session_id_fkey" FOREIGN KEY ("ended_session_id") REFERENCES "usage_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
