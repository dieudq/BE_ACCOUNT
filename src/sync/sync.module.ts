import { Module } from '@nestjs/common';
import { DataSyncService } from './data-sync.service';
import { SyncController } from './sync.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ERPClientService } from '../common/services/erp-client.service';

@Module({
  imports: [PrismaModule],
  providers: [DataSyncService, ERPClientService],
  controllers: [SyncController],
  exports: [DataSyncService],
})
export class SyncModule {}
