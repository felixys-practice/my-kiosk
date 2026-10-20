import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { LedgerModule } from './ledger/ledger.module';
import { ShopModule } from './shop/shop.module';
import { SeatModule } from './seat/seat.module';
import { UsageSessionModule } from './usage-session/usage-session.module';
import { PaymentModule } from './payment/payment.module';
import { ProductModule } from './product/product.module';
import { TicketModule } from './ticket/ticket.module';
import { BullModule } from '@nestjs/bullmq';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RoleGuard } from './auth/guards/roles.guard';
import { RedisModule } from './database/redis/redis.module';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { winstonConfig } from './logger/logger.config';
import { LoggerModule } from './logger/logger.module';
import { RefundModule } from './refund/refund.module';
import { PayoutModule } from './payout/payout.module';

@Module({
  imports: [
    // .env 로드 — 반드시 가장 앞에
    ConfigModule.forRoot({
      isGlobal: true, // 전역 등록 — 모든 모듈에서 import 없이 ConfigService 주입 가능
      load: [configuration], // configuration.ts 팩토리 함수 등록
      validationSchema, // joi 스키마로 앱 기동 시 검증
      validationOptions: {
        allowUnknown: true, // 스키마에 없는 env 변수 허용 (CI/CD 변수 등)
        abortEarly: false, // 오류 전체 수집 후 보고
      },
    }), // .env 로드 — 반드시 가장 앞에
    WinstonModule.forRoot(winstonConfig), // Winston 전역 로거
    LoggerModule, // 커스텀 로거 서비스 (거래 로그 등)
    RedisModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('database.redis.host'),
          port: config.get<number>('database.redis.port'),
        },
      }),
    }),
    PrismaModule, // @Global()이므로 한 번만 등록
    LedgerModule,
    ShopModule,
    SeatModule,
    UsageSessionModule,
    PaymentModule,
    ProductModule,
    TicketModule,
    AuthModule,
    UserModule,
    RefundModule,
    PayoutModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RoleGuard,
    },
  ],
})
export class AppModule {}
