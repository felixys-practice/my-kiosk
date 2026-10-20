import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CategoryBreakdownDto,
  SellerDashboardDto,
} from './dto/seller-dashboard.dto';

@Injectable()
export class LedgerQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getSellerDashboard(shopId: string): Promise<SellerDashboardDto> {
    const rows = await this.prisma.ledger.findMany({
      where: { shopId, status: 'SETTLED' },
    });

    return {
      totalAmount: rows.reduce((sum, r) => sum + r.amount, 0),
      tradeCount: rows.length,
      byCategory: this.groupByCategory(rows),
    };
  }

  private groupByCategory(rows: any[]) {
    // 화면이 필요로 하는 집계 로직 — 도메인 규칙과 무관
    return [
      {
        category: 'test',
        amount: 0,
        tradeCount: 0,
      },
    ];
  }
}
