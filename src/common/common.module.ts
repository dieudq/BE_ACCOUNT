import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LLMGatewayModule } from '../llm-gateway/llm-gateway.module';
import { TelegramNotiService } from './services/telegram-noti.service';
import { SmartQueryService } from './services/smart-query.service';
import { ERPClientService } from './services/erp-client.service';
import { NlpIntentService } from './services/nlp-intent.service';
import { ConversationContextService } from './services/conversation-context.service';
import { ParticipationReportService } from '../reports/participation.service';

@Module({
  imports: [PrismaModule, LLMGatewayModule],
  providers: [
    TelegramNotiService,
    SmartQueryService,
    ERPClientService,
    ParticipationReportService,
    NlpIntentService,
    ConversationContextService,
  ],
  exports: [
    TelegramNotiService,
    SmartQueryService,
    ERPClientService,
    ParticipationReportService,
    NlpIntentService,
    ConversationContextService,
  ],
})
export class CommonModule {}
