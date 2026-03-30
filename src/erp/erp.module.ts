import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ERPEventListenerService } from './erp-event-listener.service';
import { ERPEventSimulatorService } from './erp-event-simulator.service';
import { ERPWebhookController } from './erp-webhook.controller';

@Module({
  imports: [PrismaModule, TelegramModule],
  providers: [ERPEventListenerService, ERPEventSimulatorService],
  controllers: [ERPWebhookController],
  exports: [ERPEventListenerService, ERPEventSimulatorService],
})
export class ERPModule {}
