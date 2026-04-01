import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ERPEventListenerService } from './erp-event-listener.service';
import { ERPEventSimulatorService } from './erp-event-simulator.service';
import { ERPWebhookController } from './erp-webhook.controller';
import { ERPClientService } from '../common/services/erp-client.service';

@Module({
  imports: [PrismaModule, TelegramModule],
  providers: [ERPEventListenerService, ERPEventSimulatorService, ERPClientService], // <--- THÊM VÀO ĐÂY
  controllers: [ERPWebhookController],
  exports: [ERPEventListenerService, ERPEventSimulatorService, ERPClientService], // <--- EXPORT RA NGOÀI
})
export class ERPModule {}
