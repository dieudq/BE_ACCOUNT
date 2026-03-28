import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { VouchersModule } from './modules/vouchers/vouchers.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { GroqModule } from './groq/groq.module';
import { ChatModule } from './chat/chat.module';
import { TelegramModule } from './telegram/telegram.module';
import { PoliciesModule } from './policies/policies.module';
import { AgentModule } from './agent/agent.module';
import { ReportsModule } from './reports/reports.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    PrismaModule,
    VouchersModule,
    WebhooksModule,
    GroqModule,
    ChatModule,
    TelegramModule,
    PoliciesModule,
    AgentModule,
    ReportsModule,
    SchedulerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
