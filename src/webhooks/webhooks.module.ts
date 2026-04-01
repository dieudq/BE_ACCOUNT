import { Module, forwardRef } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { WebhooksController } from './webhooks.controller';
import { ApprovalsModule } from '../approvals/approvals.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ERPModule } from '../erp/erp.module';
import { TelegramModule } from '../telegram/telegram.module'; // 1. Thêm import này

@Module({
  imports: [
    CommonModule,
    PrismaModule,
    ERPModule,
    forwardRef(() => ApprovalsModule),
    forwardRef(() => TelegramModule),
  ],
  controllers: [WebhooksController],
  providers: [],
})
export class WebhooksModule {}
