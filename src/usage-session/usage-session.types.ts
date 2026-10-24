export type SortOrder = 'asc' | 'desc';

/**
 * 미사용(UNUSED) 이용권으로 첫 입실할 때 이용권에 기록할 값
 * - status를 ACTIVE로 바꾸는 것은 repository가 한다
 */
export type FirstEntryTicketUpdate = {
  activatedAt: Date; // 첫 입실 시각
  expiresAt?: Date; // 기간권만: 실제 만료 시각(activatedAt + purchasedDurationDays)
};
