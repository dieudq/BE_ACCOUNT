import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramGroupService } from './telegram-group.service';
import { TelegramController } from './telegram.controller';
import { ChatModule } from '../chat/chat.module';
import { PrismaModule } from '../prisma/prisma.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [ChatModule, PrismaModule, VouchersModule, ApprovalsModule],
  providers: [TelegramService, TelegramGroupService],
  controllers: [TelegramController],
  exports: [TelegramService, TelegramGroupService],
})
export class TelegramModule {}
