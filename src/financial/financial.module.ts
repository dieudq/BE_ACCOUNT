import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FinancialPeriodService } from './period.service';
import { JournalEntryService } from './journal-entry.service';
import { FinancialReportService } from './report.service';
import { CashflowExportService } from './cashflow-export.service';
import { FinancialController } from './financial.controller';
import { ExportController } from './export.controller';

@Module({
  imports: [PrismaModule],
  providers: [FinancialPeriodService, JournalEntryService, FinancialReportService, CashflowExportService],
  controllers: [FinancialController, ExportController],
  exports: [FinancialPeriodService, JournalEntryService, FinancialReportService, CashflowExportService],
})
export class FinancialModule {}
