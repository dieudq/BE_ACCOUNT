import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FinancialPeriodService } from './period.service';
import { JournalEntryService } from './journal-entry.service';
import { FinancialReportService } from './report.service';
import { CashflowExportService } from './cashflow-export.service';
import { GLFileParserService } from './gl-file-parser.service';
import { GLFileProcessorService } from './gl-file-processor.service';
import { CashflowTemplateService } from './cashflow-template.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { FinancialController } from './financial.controller';
import { ExportController } from './export.controller';
import { FileUploadController } from './file-upload.controller';

@Module({
  imports: [PrismaModule],
  providers: [
    FinancialPeriodService,
    JournalEntryService,
    FinancialReportService,
    CashflowExportService,
    GLFileParserService,
    GLFileProcessorService,
    CashflowTemplateService,
    ChartOfAccountsService,
  ],
  controllers: [FinancialController, ExportController, FileUploadController],
  exports: [
    FinancialPeriodService,
    JournalEntryService,
    FinancialReportService,
    CashflowExportService,
    GLFileParserService,
    GLFileProcessorService,
    CashflowTemplateService,
    ChartOfAccountsService,
  ],
})
export class FinancialModule {}

