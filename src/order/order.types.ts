import { SeatType, TicketType } from '@prisma/client';
import { OrderItemOutData } from 'src/order-item/order-item.types';
import { PaymentOutData } from 'src/payment/payment.types';
import { TicketSummaryOutData } from 'src/ticket/ticket.types';

export interface OrderOutData {
  id: string;
  shopId: string;
  userId: string;
  originalAmount: number;
  discountAmount: number;
  totalAmount: number;
  orderItems: OrderItemOutData[];
  payments: PaymentOutData[];
}

/** 주문 항목 저장 데이터(구매 시점 스냅샷) */
export interface CreateOrderItemData {
  id: string; // 선점과 연결하려고 서비스에서 미리 만든 주문 항목 ID
  ticketType: TicketType; // 구매 시점 티켓 타입(시간권, 기간권)
  seatType: SeatType; // 구매 시점 좌석 타입 스냅샷(고정석, 자유석)
  originalAmount: number; // 구매 시점 가격 스냅샷
  discountAmount: number; // 항목 할인액
  amount: number; // 실결제 금액 스냅샷(originalAmount - discountAmount)
  purchasedMinutes: number | null; // 시간권: 구매 시점 분 스냅샷
  purchasedDurationDays: number | null; // 정기권: 구매 시점 기간 스냅샷
  productId: string;
  usableDays: number;
}

/** 주문 저장 데이터 */
export interface CreateOrderWithItemsData {
  shopId: string;
  userId: string;
  originalAmount: number;
  discountAmount: number;
  totalAmount: number;
  orderItems: CreateOrderItemData[];
}
