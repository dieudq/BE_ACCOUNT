import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TelegramNotiService } from './services/telegram-noti.service';
import { SmartQueryService } from './services/smart-query.service';
import { ERPClientService } from './services/erp-client.service';
import { ParticipationReportService } from '../reports/participation.service';

@Module({
  imports: [PrismaModule],
  providers: [TelegramNotiService, SmartQueryService, ERPClientService, ParticipationReportService],
  exports: [TelegramNotiService, SmartQueryService, ERPClientService, ParticipationReportService],
})
export class CommonModule {}
