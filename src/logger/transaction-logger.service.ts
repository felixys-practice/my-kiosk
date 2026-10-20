import { Injectable, Inject } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

/**
 * 거래 전용 로거 서비스
 *
 * 결제·주문·배송·환불 이벤트를 logs/transactions/ 파일에 별도 기록합니다.
 * 전자상거래법 준수를 위한 30일 보관 정책이 적용됩니다.
 *
 * 사용 방법:
 * 1. 사용할 모듈의 imports에 LoggerModule 추가
 *    @Module({ imports: [LoggerModule], providers: [YourService] })
 *
 * 2. 서비스 생성자에서 주입
 *    constructor(private readonly txLogger: TransactionLoggerService) {}
 *
 * 3. 이벤트 발생 시점에 호출
 *    this.txLogger.logOrderCreated(orderId, userId, amount);
 *    this.txLogger.logPaymentCompleted(orderId, userId, amount, 'card');
 *    this.txLogger.logRefund(orderId, userId, amount, '구매자 요청');
 */
export interface TransactionLog {
  transactionId: string;
  type: 'ORDER' | 'PAYMENT' | 'SHIPMENT' | 'REFUND' | 'PAYOUT';
  userId: string;
  orderId?: string;
  orderItemId?: string;
  amount?: number;
  status: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class TransactionLoggerService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  logTransaction(log: TransactionLog): void {
    // 'TransactionLogger' 컨텍스트 → logger.config.ts의 transactionOnly 필터가 별도 파일로 라우팅
    this.logger.log(
      JSON.stringify({ timestamp: new Date().toISOString(), ...log }),
      'TransactionLogger',
    );
  }

  logOrderCreated(
    orderId: string,
    orderItemId: string,
    userId: string,
    amount: number,
  ): void {
    this.logTransaction({
      transactionId: `ORDER-${orderId}-${Date.now()}`,
      type: 'ORDER',
      userId,
      orderId,
      orderItemId,
      amount,
      status: 'CREATED',
    });
  }

  logPaymentCompleted(
    orderId: string,
    orderItemId: string,
    userId: string,
    amount: number,
    paymentMethod: string,
  ): void {
    this.logTransaction({
      transactionId: `PAY-${orderId}-${Date.now()}`,
      type: 'PAYMENT',
      userId,
      orderId,
      orderItemId,
      amount,
      status: 'COMPLETED',
      metadata: { paymentMethod },
    });
  }

  logPaymentRequest(
    orderId: string,
    userId: string,
    amount: number,
    paymentMethod: string,
  ): void {
    this.logTransaction({
      transactionId: `PAY-${orderId}-${Date.now()}`,
      type: 'PAYMENT',
      userId,
      orderId,
      amount,
      status: 'REQUEST',
      metadata: { paymentMethod },
    });
  }

  logRefund(
    paymentCancelId: string,
    orderId: string,
    orderItemId: string,
    userId: string,
    amount: number,
    reason: string,
  ): void {
    this.logTransaction({
      transactionId: `REFUND-${paymentCancelId}-${Date.now()}`,
      type: 'REFUND',
      userId,
      orderId,
      orderItemId,
      amount,
      status: 'REFUNDED',
      metadata: { reason },
    });
  }

  logRefundRequest(
    paymentCancelId: string,
    orderId: string,
    orderItemId: string,
    userId: string,
    amount: number,
  ): void {
    this.logTransaction({
      transactionId: `REFUND-${paymentCancelId}-${Date.now()}`,
      type: 'REFUND',
      userId,
      orderId,
      orderItemId,
      amount,
      status: 'REQUEST',
      metadata: {},
    });
  }
}
