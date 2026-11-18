import { ProductionPgClient } from './production-pg.client';

describe('ProductionPgClient', () => {
  it('취소 조회는 조회 결과 대신 실제 PG 미구현 오류로 거부한다', async () => {
    await expect(
      new ProductionPgClient().inquirePaymentCancel(
        { paymentCancelId: 'cancel-production' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('운영 PG의 결제 취소 조회가 구현되지 않았습니다');
  });
  it('취소 요청은 성공 결과 대신 실제 PG 미구현 오류로 거부한다', async () => {
    await expect(
      new ProductionPgClient().requestPaymentCancel(
        { paymentCancelId: 'cancel-production', amount: 12000 },
        new AbortController().signal,
      ),
    ).rejects.toThrow('운영 PG의 결제 취소 요청이 구현되지 않았습니다');
  });
  it('실제 PG 통신 미구현을 준비 상태 검사에 반환한다', () => {
    expect(new ProductionPgClient().validateConfiguration()).toEqual({
      ready: false,
      code: 'PG_IMPLEMENTATION_INCOMPLETE',
    });
  });
});
