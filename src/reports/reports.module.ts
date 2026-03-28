import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ParticipationReportService } from './participation.service';
import { ExcelExportService } from './excel-export.service';
import { ReportsController } from './reports.controller';
import { JiraAdapter } from '../adapters/jira.adapter';
import { AttendanceAdapter } from '../adapters/attendance.adapter';

@Module({
  imports: [PrismaModule],
  controllers: [ReportsController],
  providers: [
    ParticipationReportService,
    ExcelExportService,
    JiraAdapter,
    AttendanceAdapter,
  ],
  exports: [ParticipationReportService, ExcelExportService],
})
export class ReportsModule {}
