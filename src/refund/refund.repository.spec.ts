import { vi } from 'vitest';
import { RefundSource } from '@prisma/client';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';
import { AcceptedRefundInput, RefundRepository } from './refund.repository';

describe('환불 확정의 전송 담당 정보', () => {
  const input: AcceptedRefundInput = {
    paymentId: 'payment',
    orderItemId: 'item',
    orderId: 'order',
    shopId: 'shop',
    source: RefundSource.CUSTOMER,
    amount: 10000,
    requestedById: 'customer',
    now: new Date('2026-11-17T00:00:00Z'),
  };

  it('양수 환불에서 전송 담당 정보가 누락되면 DB에 생성하기 전에 거절한다', async () => {
    const create = vi.fn();
    const tx = { refund: { create } } as unknown as TransactionClient;
    const repository = new RefundRepository({} as PrismaService);

    await expect(repository.createAcceptedRefund(input, tx)).rejects.toThrow(
      '양수 환불 생성에는 PG 전송 담당 토큰과 처리 기한이 필요합니다',
    );
    expect(create).not.toHaveBeenCalled();
  });
});
