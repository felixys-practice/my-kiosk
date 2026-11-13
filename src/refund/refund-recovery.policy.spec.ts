import { inquiryBackoffSeconds } from './refund-recovery.policy';

describe('inquiryBackoffSeconds', () => {
  it('계산한 간격이 상한을 넘으면 상한 간격이다', () => {
    // 연속 오류 6회째: 15 × 2^5 = 480초 > 300초
    expect(inquiryBackoffSeconds(6, 15, 300)).toBe(300);
  });

  it('상한 안이면 기준 간격의 2^(n-1)배다', () => {
    expect(inquiryBackoffSeconds(5, 15, 300)).toBe(240);
  });
});
