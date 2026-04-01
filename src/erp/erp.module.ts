import { forwardRef, Module } from '@nestjs/common'; // Thêm forwardRef
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ERPEventListenerService } from './erp-event-listener.service';
import { ERPEventSimulatorService } from './erp-event-simulator.service';
import { ERPWebhookController } from './erp-webhook.controller';
import { ErpClientService } from './erp-client.service';

@Module({
  imports: [
    PrismaModule,
    // 🛡️ Dùng forwardRef ở đây vì TelegramModule cũng đang import ERPModule
    forwardRef(() => TelegramModule),
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
  ],
  providers: [
    ERPEventListenerService,
    ERPEventSimulatorService,
    ErpClientService,
  ],
  controllers: [ERPWebhookController],
  exports: [
    ERPEventListenerService,
    ERPEventSimulatorService,
    ErpClientService,
  ],
})
export class ERPModule {}
