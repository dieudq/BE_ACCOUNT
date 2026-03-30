import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ERPEventListenerService } from './erp-event-listener.service';
import { ERPWebhookController } from './erp-webhook.controller';

@Module({
  imports: [PrismaModule, TelegramModule],
  providers: [ERPEventListenerService],
  controllers: [ERPWebhookController],
  exports: [ERPEventListenerService],
})
export class ERPModule {}
