import { Module } from '@nestjs/common';
import { ApprovalWorkflowService } from './approval-workflow.service';
import { ApprovalController } from './approval.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { GroqModule } from '../groq/groq.module';

@Module({
  imports: [PrismaModule, GroqModule],
  providers: [ApprovalWorkflowService],
  controllers: [ApprovalController],
  exports: [ApprovalWorkflowService],
})
export class ApprovalsModule {}
