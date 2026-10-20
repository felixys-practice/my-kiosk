import { Body, Controller, Post } from '@nestjs/common';
import { PayoutCommandService } from './command/payout-command.service';
import { RequestPayoutDto } from './dto/request-payout.dto';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly commandService: PayoutCommandService) {}

  // 관리자가 완료된 정산 배치에 대해 매장 송금을 수동으로 트리거
  @Post()
  async requestPayout(@Body() dto: RequestPayoutDto): Promise<void> {
    await this.commandService.requestPayout(
      dto.settlementBatchId,
      dto.shopId,
      dto.requestedBy,
    );
  }
}
