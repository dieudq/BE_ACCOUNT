import { Module } from '@nestjs/common';
import { AgentOrchestrator } from './agent.orchestrator';
import { ChatModule } from '../chat/chat.module';
import { PoliciesModule } from '../policies/policies.module';
import { ReportsModule } from '../reports/reports.module';
import { SyncModule } from '../sync/sync.module';
import { WorkloadModule } from '../workload/workload.module';

@Module({
  imports: [ChatModule, PoliciesModule, ReportsModule, SyncModule, WorkloadModule],
  providers: [AgentOrchestrator],
  exports: [AgentOrchestrator],
})
export class AgentModule {}
