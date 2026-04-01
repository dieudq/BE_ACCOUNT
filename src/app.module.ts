import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { VouchersModule as LegacyVouchersModule } from './modules/vouchers/vouchers.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { LLMGatewayModule } from './llm-gateway/llm-gateway.module';
import { ChatModule } from './chat/chat.module';
import { TelegramModule } from './telegram/telegram.module';
import { PoliciesModule } from './policies/policies.module';
import { AgentModule } from './agent/agent.module';
import { ReportsModule } from './reports/reports.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { SyncModule } from './sync/sync.module';
import { FinancialModule } from './financial/financial.module';
import { ERPModule } from './erp/erp.module';
import { WorkloadModule } from './workload/workload.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    PrismaModule,
    LegacyVouchersModule,
    WebhooksModule,
    LLMGatewayModule,
    ChatModule,
    TelegramModule,
    PoliciesModule,
    AgentModule,
    ReportsModule,
    SchedulerModule,
    ApprovalsModule,
    SyncModule,
    FinancialModule,
    ERPModule,
    WorkloadModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
