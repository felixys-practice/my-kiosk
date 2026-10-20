import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { PayoutService } from '../payout.service';
import { BankTransferResult } from '../payout.types';

@Injectable()
export class PayoutCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payoutService: PayoutService,
  ) {}

  // 관리자가 완료된 정산 배치에 대해 매장 송금을 수동으로 트리거한다.
  // Payout row 생성(PENDING) -> 은행 API 요청(PROCESSING) -> 응답에 따라
  // SUCCEEDED/FAILED 확정까지를 담당한다. 장부 확정(SettlementBatch.settle)과는
  // 별개 단계이므로 이미 COMPLETED된 배치에 대해서만 실행한다.
  async requestPayout(
    settlementBatchId: string,
    shopId: string,
    requestedBy: string,
  ): Promise<void> {
    const batch = await this.prisma.settlementBatch.findUnique({
      where: { id: settlementBatchId },
    });
    if (!batch) {
      throw new NotFoundException('정산 배치를 찾을 수 없습니다');
    }
    if (batch.status !== 'COMPLETED') {
      throw new BadRequestException('완료되지 않은 정산 배치입니다');
    }

    const account = await this.prisma.shopSettlementAccount.findUnique({
      where: { shopId },
    });
    if (!account) {
      throw new BadRequestException('매장에 등록된 정산 계좌가 없습니다');
    }

    // 이 배치에서 해당 매장으로 귀속된 SETTLED 금액 합계 - 실제 지급할 금액
    const aggregate = await this.prisma.ledger.aggregate({
      where: { settlementBatchId, shopId, status: 'SETTLED' },
      _sum: { amount: true },
    });
    const amount = aggregate._sum.amount ?? 0;
    if (amount <= 0) {
      throw new BadRequestException('지급할 금액이 없습니다');
    }

    const payout = await this.prisma.payout.create({
      data: {
        shopId,
        settlementBatchId,
        amount,
        requestedBy,
        status: 'PENDING',
      },
    });

    await this.prisma.payout.update({
      where: { id: payout.id },
      data: { status: 'PROCESSING', requestedAt: new Date() },
    });

    const response = await this.payoutService.requestTransfer(
      payout.id,
      shopId,
      requestedBy,
      account.accountNumber,
      account.bankName,
      account.accountHolder,
      amount,
    );

    if (response.result === BankTransferResult.SUCCEEDED) {
      await this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: 'SUCCEEDED',
          bankTransactionId: response.bankTransactionId,
          completedAt: new Date(),
        },
      });
    } else {
      await this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: 'FAILED',
          failureReason: response.failureReason ?? '알 수 없는 사유',
          completedAt: new Date(),
        },
      });
    }
  }
}
