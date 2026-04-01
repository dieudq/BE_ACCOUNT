import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ParticipationReportService } from './participation.service';
import { ExcelExportService } from './excel-export.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ReportsController],
  providers: [ParticipationReportService, ExcelExportService],
  exports: [ParticipationReportService, ExcelExportService],
})
export class ReportsModule {}
