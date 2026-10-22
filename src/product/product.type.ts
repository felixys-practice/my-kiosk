import { SeatType, TicketType } from '@prisma/client';

interface BaseProductData {
  name: string;
  amount: number;
  // shopId: string;
  usableDays: number;
  isActive: boolean;
  seatType: SeatType; // 좌석 타입(고정석·자유석)
}

export interface CreateTimeProductData extends BaseProductData {
  ticketType: typeof TicketType.TIME;
  purchasedMinutes: number;
}

export interface CreatePeriodProductData extends BaseProductData {
  ticketType: typeof TicketType.PERIOD;
  purchasedDurationDays: number;
}

/** 수정 대상 상품의 현재 값(변경 비교·이용권 종류 확인용) */
export interface ProductForUpdate {
  id: string;
  name: string;
  ticketType: TicketType;
  amount: number;
  usableDays: number;
  isActive: boolean;
  purchasedMinutes: number | null;
  purchasedDurationDays: number | null;
  seatType: SeatType;
}

/** 상품 수정에서 바꿀 수 있는 필드 */
export type UpdatableProductFields = Partial<
  Pick<
    ProductForUpdate,
    | 'name'
    | 'amount'
    | 'usableDays'
    | 'isActive'
    | 'purchasedMinutes'
    | 'purchasedDurationDays'
    | 'seatType'
  >
>;

/** 상품 변경 이력 1행 */
export interface ProductHistoryRow {
  changeGroupId: string;
  changedField: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
}
