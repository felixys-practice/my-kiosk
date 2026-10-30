import { Injectable } from '@nestjs/common';
import { TransactionLoggerService } from '../logger/transaction-logger.service';
import { BankTransferResponse, BankTransferResult } from './payout.types';

@Injectable()
export class PayoutService {
  constructor(
    private readonly transactionLoggerService: TransactionLoggerService,
  ) {}

  // 은행(오픈뱅킹/펌뱅킹) 송금 API 요청 - 매장 계좌로 정산 금액을 실제 이체
  async requestTransfer(
    payoutId: string,
    shopId: string,
    requestedBy: string,
    accountNumber: string,
    bankName: string,
    accountHolder: string,
    amount: number,
  ): Promise<BankTransferResponse> {
    // TODO: 실제 은행 송금 API 연동
    // 실제 은행에 연동하기 전이므로 송금 성공으로 처리하지 않고 실패를 반환한다.
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 500);
    });

    this.transactionLoggerService.logTransaction({
      transactionId: `PAYOUT-${payoutId}-${Date.now()}`,
      type: 'PAYOUT',
      userId: requestedBy,
      status: 'REQUEST',
      amount,
      metadata: { shopId, bankName, accountNumber, accountHolder, payoutId },
    });

    return {
      result: BankTransferResult.FAILED,
      failureReason: '은행 API 연동 전 - 실제 송금 미실행',
    };
  }
}
