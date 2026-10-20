-- CreateEnum
CREATE TYPE "SettlementBatchStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- AlterEnum
BEGIN;
CREATE TYPE "ledger_status_new" AS ENUM ('HELD', 'RELEASABLE', 'SETTLED');
ALTER TABLE "ledger" ALTER COLUMN "status" TYPE "ledger_status_new" USING ("status"::text::"ledger_status_new");
ALTER TYPE "ledger_status" RENAME TO "ledger_status_old";
ALTER TYPE "ledger_status_new" RENAME TO "ledger_status";
DROP TYPE "public"."ledger_status_old";
COMMIT;

-- DropIndex
DROP INDEX "ledger_sellerId_idx";

-- DropIndex
DROP INDEX "ledger_tradeId_idx";

-- AlterTable
ALTER TABLE "ledger" DROP COLUMN "sellerId",
DROP COLUMN "tradeId",
ADD COLUMN     "order_id" TEXT NOT NULL,
ADD COLUMN     "payment_cancel_id" TEXT,
ADD COLUMN     "settlement_batch_id" TEXT,
ADD COLUMN     "shop_id" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "settlement_batches" (
    "id" TEXT NOT NULL,
    "status" "SettlementBatchStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "total_amount" INTEGER,
    "seller_count" INTEGER,
    "ledger_count" INTEGER,

    CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "settlement_batch_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "bank_transaction_id" TEXT,
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_settlement_accounts" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_holder" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_settlement_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlement_batches_status_idx" ON "settlement_batches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_bank_transaction_id_key" ON "payouts"("bank_transaction_id");

-- CreateIndex
CREATE INDEX "payouts_shop_id_idx" ON "payouts"("shop_id");

-- CreateIndex
CREATE INDEX "payouts_settlement_batch_id_idx" ON "payouts"("settlement_batch_id");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "shop_settlement_accounts_shop_id_key" ON "shop_settlement_accounts"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_payment_cancel_id_key" ON "ledger"("payment_cancel_id");

-- CreateIndex
CREATE INDEX "ledger_shop_id_idx" ON "ledger"("shop_id");

-- CreateIndex
CREATE INDEX "ledger_order_id_status_idx" ON "ledger"("order_id", "status");

-- CreateIndex
CREATE INDEX "ledger_settlement_batch_id_idx" ON "ledger"("settlement_batch_id");

-- AddForeignKey
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_payment_cancel_id_fkey" FOREIGN KEY ("payment_cancel_id") REFERENCES "payment_cancels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "settlement_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_settlement_accounts" ADD CONSTRAINT "shop_settlement_accounts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

