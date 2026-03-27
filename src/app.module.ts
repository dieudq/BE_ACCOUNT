import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { VouchersModule } from './modules/vouchers/vouchers.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [ConfigModule.forRoot(), PrismaModule, VouchersModule, WebhooksModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
