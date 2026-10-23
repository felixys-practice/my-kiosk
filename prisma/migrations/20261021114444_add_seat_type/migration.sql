-- CreateEnum
CREATE TYPE "SeatType" AS ENUM ('FIXED', 'FREE');

-- CreateEnum
CREATE TYPE "SeatAssignmentStatus" AS ENUM ('HELD', 'ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "SeatReleaseReason" AS ENUM ('ORDER_CANCELLED', 'PAYMENT_FAILED', 'HOLD_EXPIRED', 'TICKET_EXPIRED', 'TICKET_EXHAUSTED', 'TICKET_REVOKED', 'TICKET_PAUSED', 'SEAT_TYPE_CHANGED', 'SEAT_MOVED');

-- CreateEnum
CREATE TYPE "TicketSeatChangeType" AS ENUM ('TYPE_CHANGE', 'SEAT_MOVE');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "seat_type" "SeatType" NOT NULL DEFAULT 'FREE';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "seat_type" "SeatType" NOT NULL DEFAULT 'FREE';

-- AlterTable
ALTER TABLE "seats" ADD COLUMN     "type" "SeatType" NOT NULL DEFAULT 'FREE';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "seat_type" "SeatType" NOT NULL DEFAULT 'FREE';

-- CreateTable
CREATE TABLE "seat_assignments" (
    "id" TEXT NOT NULL,
    "seat_id" TEXT NOT NULL,
    "order_item_id" TEXT,
    "ticket_id" TEXT,
    "status" "SeatAssignmentStatus" NOT NULL DEFAULT 'HELD',
    "held_until" TIMESTAMP(3),
    "assigned_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "release_reason" "SeatReleaseReason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seat_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_seat_changes" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "change_type" "TicketSeatChangeType" NOT NULL,
    "from_seat_type" "SeatType" NOT NULL,
    "to_seat_type" "SeatType" NOT NULL,
    "from_seat_id" TEXT,
    "to_seat_id" TEXT,
    "reason" TEXT NOT NULL,
    "changed_by" TEXT NOT NULL,
    "ended_session_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_seat_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seat_assignments_ticket_id_status_idx" ON "seat_assignments"("ticket_id", "status");

-- CreateIndex
CREATE INDEX "seat_assignments_order_item_id_idx" ON "seat_assignments"("order_item_id");

-- CreateIndex
CREATE INDEX "ticket_seat_changes_ticket_id_changed_at_idx" ON "ticket_seat_changes"("ticket_id", "changed_at");

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_seat_changes" ADD CONSTRAINT "ticket_seat_changes_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_seat_changes" ADD CONSTRAINT "ticket_seat_changes_from_seat_id_fkey" FOREIGN KEY ("from_seat_id") REFERENCES "seats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_seat_changes" ADD CONSTRAINT "ticket_seat_changes_to_seat_id_fkey" FOREIGN KEY ("to_seat_id") REFERENCES "seats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_seat_changes" ADD CONSTRAINT "ticket_seat_changes_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 좌석당 유효 지정(선점 HELD·확정 ACTIVE)은 하나만 허용 (동시 구매 시 한 건만 성공)
CREATE UNIQUE INDEX "seat_assignments_seat_id_valid_key" ON "seat_assignments"("seat_id") WHERE "status" IN ('HELD', 'ACTIVE');

-- 이용권당 확정 지정(ACTIVE)은 하나만 허용 (모든 이용권은 좌석 1개만 소유)
CREATE UNIQUE INDEX "seat_assignments_ticket_id_active_key" ON "seat_assignments"("ticket_id") WHERE "status" = 'ACTIVE';
