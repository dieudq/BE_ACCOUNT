import { Module } from '@nestjs/common';
import { ApprovalWorkflowService } from './approval-workflow.service';
import { ApprovalController } from './approval.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LLMGatewayModule } from '../llm-gateway/llm-gateway.module';

@Module({
  imports: [PrismaModule, LLMGatewayModule],
  providers: [ApprovalWorkflowService],
  controllers: [ApprovalController],
  exports: [ApprovalWorkflowService],
})
export class ApprovalsModule {}
