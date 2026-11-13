-- 원장 지급 연결, 환불 알림·읽음, 장애 복구 제어, DB 멱등 요청 기록 (data-model §6·§8, tasks T010)

-- CreateEnum
CREATE TYPE "RefundNotificationAudience" AS ENUM ('CUSTOMER', 'SHOP', 'OPERATOR');

-- CreateEnum
CREATE TYPE "RefundRecoveryMode" AS ENUM ('PROBE', 'BATCH');

-- CreateEnum
CREATE TYPE "RefundIdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "ledger" ADD COLUMN     "manual_refund_payout_id" TEXT,
ADD COLUMN     "refund_id" TEXT;

-- CreateTable
CREATE TABLE "refund_notifications" (
    "id" TEXT NOT NULL,
    "refund_id" TEXT NOT NULL,
    "payment_cancel_id" TEXT,
    "manual_refund_payout_id" TEXT,
    "kind" TEXT NOT NULL,
    "audience" "RefundNotificationAudience" NOT NULL,
    "shop_id" TEXT NOT NULL,
    "recipient_user_id" TEXT,
    "event_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_notification_receipts" (
    "notification_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_notification_receipts_pkey" PRIMARY KEY ("notification_id","user_id")
);

-- CreateTable
CREATE TABLE "refund_recovery_controls" (
    "id" TEXT NOT NULL,
    "mode" "RefundRecoveryMode" NOT NULL DEFAULT 'PROBE',
    "next_probe_at" TIMESTAMP(3),
    "claim_token" TEXT,
    "claim_until" TIMESTAMP(3),
    "batch_cutoff_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_recovery_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_idempotency_records" (
    "id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "status" "RefundIdempotencyStatus" NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "refund_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refund_notifications_refund_id_idx" ON "refund_notifications"("refund_id");

-- CreateIndex
CREATE INDEX "refund_notifications_audience_shop_id_created_at_idx" ON "refund_notifications"("audience", "shop_id", "created_at");

-- CreateIndex
CREATE INDEX "refund_notifications_recipient_user_id_created_at_idx" ON "refund_notifications"("recipient_user_id", "created_at");

-- CreateIndex
CREATE INDEX "refund_idempotency_records_requester_id_idx" ON "refund_idempotency_records"("requester_id");

-- CreateIndex
CREATE INDEX "ledger_refund_id_idx" ON "ledger"("refund_id");

-- AddForeignKey
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_manual_refund_payout_id_fkey" FOREIGN KEY ("manual_refund_payout_id") REFERENCES "manual_refund_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_notifications" ADD CONSTRAINT "refund_notifications_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_notifications" ADD CONSTRAINT "refund_notifications_payment_cancel_id_fkey" FOREIGN KEY ("payment_cancel_id") REFERENCES "payment_cancels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_notifications" ADD CONSTRAINT "refund_notifications_manual_refund_payout_id_fkey" FOREIGN KEY ("manual_refund_payout_id") REFERENCES "manual_refund_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_notifications" ADD CONSTRAINT "refund_notifications_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_notifications" ADD CONSTRAINT "refund_notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_notification_receipts" ADD CONSTRAINT "refund_notification_receipts_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "refund_notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_notification_receipts" ADD CONSTRAINT "refund_notification_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_idempotency_records" ADD CONSTRAINT "refund_idempotency_records_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_idempotency_records" ADD CONSTRAINT "refund_idempotency_records_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

