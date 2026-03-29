import { Module } from '@nestjs/common';
import { DataSyncService } from './data-sync.service';
import { SyncController } from './sync.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ERPAdapter } from '../adapters/erp.adapter';
import { JiraAdapter } from '../adapters/jira.adapter';

@Module({
  imports: [PrismaModule],
  providers: [DataSyncService, ERPAdapter, JiraAdapter],
  controllers: [SyncController],
  exports: [DataSyncService],
})
export class SyncModule {}
