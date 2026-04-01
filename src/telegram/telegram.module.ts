import { forwardRef, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramGroupService } from './telegram-group.service';
import { BotCommandService } from './bot-command.service';
import { TelegramController } from './telegram.controller';
import { CommonModule } from '../common/common.module';
import { ChatModule } from '../chat/chat.module';
import { PrismaModule } from '../prisma/prisma.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { FinancialModule } from '../financial/financial.module';
import { TelegramNotiService } from '../common/services/telegram-noti.service';

@Module({
  imports: [
    CommonModule,
    ChatModule,
    PrismaModule,
    VouchersModule,
    forwardRef(() => ApprovalsModule),
    FinancialModule,
  ],
  providers: [
    TelegramService,
    TelegramGroupService,
    BotCommandService,
    TelegramNotiService, // <--- THÊM VÀO ĐÂY
  ],
  controllers: [TelegramController],
  exports: [
    TelegramService,
    TelegramGroupService,
    TelegramNotiService, // <--- EXPORT ĐỂ ApprovalsModule NHÌN THẤY
  ],
})
export class TelegramModule {}