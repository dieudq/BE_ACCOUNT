import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FinancialPeriodService } from './period.service';
import { JournalEntryService } from './journal-entry.service';
import { FinancialReportService } from './report.service';
import { FinancialController } from './financial.controller';

@Module({
  imports: [PrismaModule],
  providers: [FinancialPeriodService, JournalEntryService, FinancialReportService],
  controllers: [FinancialController],
  exports: [FinancialPeriodService, JournalEntryService, FinancialReportService],
})
export class FinancialModule {}
