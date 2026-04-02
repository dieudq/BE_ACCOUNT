import { Module } from '@nestjs/common';
import { AgentOrchestrator } from './agent.orchestrator';
import { ChatModule } from '../chat/chat.module';
import { PoliciesModule } from '../policies/policies.module';
import { ReportsModule } from '../reports/reports.module';
import { SyncModule } from '../sync/sync.module';
import { WorkloadModule } from '../workload/workload.module';
import { CommonModule } from '../common/common.module';
import { LLMGatewayModule } from '../llm-gateway/llm-gateway.module';
import { FinancialModule } from '../financial/financial.module';

@Module({
  imports: [ChatModule, PoliciesModule, ReportsModule, SyncModule, WorkloadModule, CommonModule, LLMGatewayModule, FinancialModule],
  providers: [AgentOrchestrator],
  exports: [AgentOrchestrator],
})
export class AgentModule {}
