-- 결제 전체 대상 환불(PAYMENT)의 PG 취소 요청은 대상 상품이 없다 (data-model §4, US6 사용자 결정)
-- AlterTable
ALTER TABLE "payment_cancels" ALTER COLUMN "order_item_id" DROP NOT NULL;
