import { forwardRef, Module } from '@nestjs/common';
import { ApprovalWorkflowService } from './approval-workflow.service';
import { ApprovalController } from './approval.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LLMGatewayModule } from '../llm-gateway/llm-gateway.module';
import { VoucherApprovalService } from './voucher-approval.service';
import { TelegramModule } from '../telegram/telegram.module';
import { ERPClientService } from '../common/services/erp-client.service';

@Module({
  imports: [PrismaModule, LLMGatewayModule , forwardRef(() => TelegramModule) ],
  providers: [ApprovalWorkflowService, VoucherApprovalService, ERPClientService],
  controllers: [ApprovalController],
  exports: [ApprovalWorkflowService, VoucherApprovalService, ERPClientService],
})
export class ApprovalsModule {}
