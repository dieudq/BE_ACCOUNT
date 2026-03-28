import { Module } from '@nestjs/common';
import { AgentOrchestrator } from './agent.orchestrator';
import { ChatModule } from '../chat/chat.module';
import { PoliciesModule } from '../policies/policies.module';

@Module({
  imports: [ChatModule, PoliciesModule],
  providers: [AgentOrchestrator],
  exports: [AgentOrchestrator],
})
export class AgentModule {}
