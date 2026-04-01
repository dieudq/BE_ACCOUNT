import { forwardRef, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { GroqService } from './groq.service';
import { CashflowTemplateService } from '../financial/cashflow-template.service';
import { TelegramGroupService } from './telegram-group.service';
import { BotCommandService } from './bot-command.service';
import { BotCommandsService } from './bot-commands.service';
import { TelegramController } from './telegram.controller';
import { CommonModule } from '../common/common.module';
import { ChatModule } from '../chat/chat.module';
import { PrismaModule } from '../prisma/prisma.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { FinancialModule } from '../financial/financial.module';
import { TelegramNotiService } from '../common/services/telegram-noti.service';
import { WorkloadModule } from '../workload/workload.module';

@Module({
  imports: [
    CommonModule,
    ChatModule,
    PrismaModule,
    VouchersModule,
    forwardRef(() => ApprovalsModule),
    FinancialModule,
    WorkloadModule,
  ],
  providers: [
    TelegramService,
    GroqService,
    CashflowTemplateService,
    TelegramGroupService,
    BotCommandService,
    BotCommandsService,
    TelegramNotiService,
  ],
  controllers: [TelegramController],
  exports: [
    TelegramService,
    TelegramGroupService,
    BotCommandsService,
    TelegramNotiService,
  ],
})
export class TelegramModule {}