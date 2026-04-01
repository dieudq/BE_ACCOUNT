import { Module } from '@nestjs/common';
import { LLMGatewayModule } from '../llm-gateway/llm-gateway.module';
import { ReportsModule } from '../reports/reports.module';
import { SyncModule } from '../sync/sync.module';
import { WorkloadAnalysisService } from './workload-analysis.service';
import { WorkloadController } from './workload.controller';

@Module({
  imports: [LLMGatewayModule, ReportsModule, SyncModule],
  controllers: [WorkloadController],
  providers: [WorkloadAnalysisService],
  exports: [WorkloadAnalysisService],
})
export class WorkloadModule {}
