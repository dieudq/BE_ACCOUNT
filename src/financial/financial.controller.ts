import { Controller, Get, Post, Body, Param, Query, HttpCode } from '@nestjs/common';
import { FinancialPeriodService } from './period.service';
import { JournalEntryService } from './journal-entry.service';
import { FinancialReportService } from './report.service';
import { CashflowAgentService } from './cashflow-agent.service';

@Controller('api/financial')
export class FinancialController {
  constructor(
    private periodService: FinancialPeriodService,
    private journalService: JournalEntryService,
    private reportService: FinancialReportService,
    private cashflowAgent: CashflowAgentService,
  ) {}

  // ============ PERIOD ENDPOINTS ============

  @Get('periods')
  async listPeriods(@Query('year') year?: number) {
    return this.periodService.listPeriods(year ? parseInt(year.toString()) : undefined);
  }

  @Get('periods/current')
  async getCurrentPeriod() {
    return this.periodService.getCurrentPeriod();
  }

  @Post('periods')
  @HttpCode(201)
  async createPeriod(
    @Body()
    data: {
      code: string;
      description?: string;
      startDate: string;
      endDate: string;
      fiscalYear: number;
      fiscalMonth?: number;
    },
  ) {
    return this.periodService.createPeriod(
      data.code,
      data.description || '',
      new Date(data.startDate),
      new Date(data.endDate),
      data.fiscalYear,
      data.fiscalMonth,
    );
  }

  @Post('periods/:id/close')
  async closePeriod(@Param('id') periodId: string) {
    return this.periodService.closePeriod(periodId);
  }

  // ============ JOURNAL ENTRY ENDPOINTS ============

  @Post('journal-entries')
  @HttpCode(201)
  async createJournalEntry(
    @Body()
    data: {
      periodId: string;
      entryDate: string;
      description: string;
      debitAccountId: string;
      debitAmount: number;
      creditAccountId: string;
      creditAmount: number;
      costCenterId?: string;
      reference?: string;
      createdBy?: string;
    },
  ) {
    return this.journalService.createEntry(
      data.periodId,
      new Date(data.entryDate),
      data.description,
      data.debitAccountId,
      data.debitAmount,
      data.creditAccountId,
      data.creditAmount,
      data.costCenterId,
      data.reference,
      data.createdBy,
    );
  }

  @Get('journal-entries')
  async getJournalEntries(
    @Query('periodId') periodId: string,
    @Query('status') status?: string,
  ) {
    return this.journalService.getEntriesByPeriod(periodId, status);
  }

  @Post('journal-entries/:id/approve')
  async approveJournalEntry(@Param('id') entryId: string, @Body() data: { approvedBy: string }) {
    return this.journalService.approveAndPost(entryId, data.approvedBy);
  }

  @Post('journal-entries/:id/reverse')
  async reverseJournalEntry(
    @Param('id') entryId: string,
    @Body() data: { reason: string; createdBy?: string },
  ) {
    return this.journalService.reverseEntry(entryId, data.reason, data.createdBy);
  }

  @Post('journal-entries/:periodId/validate-balance')
  async validatePeriodBalance(@Param('periodId') periodId: string) {
    return this.journalService.validateBalance(periodId);
  }

  // ============ REPORT ENDPOINTS ============

  @Post('reports/trial-balance')
  async generateTrialBalance(@Body() data: { periodId: string }) {
    return this.reportService.generateTrialBalance(data.periodId);
  }

  @Post('reports/income-statement')
  async generateIncomeStatement(@Body() data: { periodId: string }) {
    return this.reportService.generateIncomeStatement(data.periodId);
  }

  @Post('reports/balance-sheet')
  async generateBalanceSheet(@Body() data: { periodId: string }) {
    return this.reportService.generateBalanceSheet(data.periodId);
  }

  @Get('reports/history')
  async getReportHistory(
    @Query('periodId') periodId: string,
    @Query('reportType') reportType?: string,
  ) {
    return this.reportService.getReportHistory(periodId, reportType);
  }

  @Post('reports/save')
  @HttpCode(201)
  async saveReport(
    @Body()
    data: {
      periodId: string;
      reportType: string;
      reportData: any;
      createdBy?: string;
    },
  ) {
    return this.reportService.saveReport(
      data.periodId,
      data.reportType,
      data.reportData,
      data.createdBy,
    );
  }

  @Post('reports/:id/approve')
  async approveReport(@Param('id') reportId: string, @Body() data: { approvedBy: string }) {
    return this.reportService.approveReport(reportId, data.approvedBy);
  }

  @Post('reports/:id/publish')
  async publishReport(@Param('id') reportId: string) {
    return this.reportService.publishReport(reportId);
  }

  // ============ CASHFLOW E2E ENDPOINTS ============

  @Post('cashflow/auto-generate')
  async autoGenerateCashflow(
    @Body() data: { sourceFilePath?: string },
  ) {
    const generated = await this.cashflowAgent.generateAutoReport(data?.sourceFilePath);
    return {
      success: true,
      message: `Đã tạo báo cáo cashflow tự động kỳ ${generated.period}`,
      data: generated,
    };
  }

  @Post('cashflow/qa')
  async cashflowQa(
    @Body() data: { question: string; year?: number; month?: number },
  ) {
    const answer = await this.cashflowAgent.answerQuestion(
      data.question,
      data.year,
      data.month,
    );

    return {
      success: true,
      answer,
    };
  }

  // ============ HEALTH CHECK ============

  @Get('health')
  async health() {
    const period = await this.periodService.getCurrentPeriod();
    return {
      status: 'ok',
      currentPeriod: period?.code || 'none',
      timestamp: new Date(),
    };
  }
}
