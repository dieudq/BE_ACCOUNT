import { Module, forwardRef } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { WebhooksController } from './webhooks.controller';
import { ApprovalsModule } from '../approvals/approvals.module'; // Chứa VoucherApprovalService
import { PrismaModule } from '../prisma/prisma.module';
import { ERPModule } from '../erp/erp.module';

@Module({
  imports: [
    CommonModule,
    PrismaModule,
    ERPModule, // Để lấy ERPClientService
    forwardRef(() => ApprovalsModule), // Để lấy VoucherApprovalService
  ],
  controllers: [WebhooksController],
  providers: [], // Không khai báo VoucherApprovalService ở đây nữa
})
export class WebhooksModule {}