import { Module } from '@nestjs/common';
import { LoggerModule } from 'src/logger/logger.module';
import { PayoutCommandService } from './command/payout-command.service';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';

@Module({
  imports: [LoggerModule],
  controllers: [PayoutController],
  providers: [PayoutCommandService, PayoutService],
  exports: [PayoutService],
})
export class PayoutModule {}
