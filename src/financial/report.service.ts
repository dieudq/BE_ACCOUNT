import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class FinancialReportService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate Trial Balance
   */
  async generateTrialBalance(periodId: string): Promise<any> {
    const period = await this.prisma.financialPeriod.findUnique({
      where: { id: periodId },
    });

    if (!period) {
      throw new Error('Period not found');
    }

    // Get all GL entries for the period
    const glEntries = await this.prisma.generalLedger.findMany({
      where: { periodId },
      include: { account: true },
    });

    const trialBalanceRows = glEntries.map((entry) => ({
      accountCode: entry.account.accountCode,
      accountName: entry.account.accountName,
      debitBalance: Number(entry.debitAmount),
      creditBalance: Number(entry.creditAmount),
    }));

    // Calculate totals
    const totalDebit = trialBalanceRows.reduce((sum, row) => sum + row.debitBalance, 0);
    const totalCredit = trialBalanceRows.reduce((sum, row) => sum + row.creditBalance, 0);

    // Check balance
    const variance = Math.abs(totalDebit - totalCredit);
    const isBalanced = variance < 0.01;

    // Store in trial_balances table for audit
    for (const row of trialBalanceRows) {
      const glEntry = glEntries.find((e) => e.account.accountCode === row.accountCode);
      if (glEntry) {
        await this.prisma.trialBalance.upsert({
          where: {
            periodId_accountId: {
              periodId,
              accountId: glEntry.accountId,
            },
          },
          create: {
            periodId,
            accountId: glEntry.accountId,
            debitBalance: new Decimal(row.debitBalance),
            creditBalance: new Decimal(row.creditBalance),
          },
          update: {
            debitBalance: new Decimal(row.debitBalance),
            creditBalance: new Decimal(row.creditBalance),
          },
        });
      }
    }

    return {
      periodCode: period.code,
      periodDate: period.startDate,
      rows: trialBalanceRows,
      totals: {
        totalDebit,
        totalCredit,
        variance,
        isBalanced,
      },
    };
  }

  /**
   * Generate Income Statement
   */
  async generateIncomeStatement(periodId: string): Promise<any> {
    const period = await this.prisma.financialPeriod.findUnique({
      where: { id: periodId },
    });

    if (!period) {
      throw new Error('Period not found');
    }

    // Get revenue accounts (income type)
    const revenues = await this.prisma.generalLedger.findMany({
      where: {
        periodId,
        account: { accountType: 'income' },
      },
      include: { account: true },
    });

    // Get expense accounts (expense type)
    const expenses = await this.prisma.generalLedger.findMany({
      where: {
        periodId,
        account: { accountType: 'expense' },
      },
      include: { account: true },
    });

    const totalRevenue = revenues.reduce((sum, r) => sum + Number(r.creditAmount), 0);
    const totalExpense = expenses.reduce((sum, e) => sum + Number(e.debitAmount), 0);
    const netIncome = totalRevenue - totalExpense;

    return {
      reportType: 'income_statement',
      periodCode: period.code,
      revenues: revenues.map((r) => ({
        account: r.account.accountName,
        amount: Number(r.creditAmount),
      })),
      totalRevenue,
      expenses: expenses.map((e) => ({
        account: e.account.accountName,
        amount: Number(e.debitAmount),
      })),
      totalExpense,
      netIncome,
    };
  }

  /**
   * Generate Balance Sheet
   */
  async generateBalanceSheet(periodId: string): Promise<any> {
    const period = await this.prisma.financialPeriod.findUnique({
      where: { id: periodId },
    });

    if (!period) {
      throw new Error('Period not found');
    }

    // Assets
    const assets = await this.prisma.generalLedger.findMany({
      where: {
        periodId,
        account: { accountType: 'asset' },
      },
      include: { account: true },
    });

    // Liabilities
    const liabilities = await this.prisma.generalLedger.findMany({
      where: {
        periodId,
        account: { accountType: 'liability' },
      },
      include: { account: true },
    });

    // Equity
    const equity = await this.prisma.generalLedger.findMany({
      where: {
        periodId,
        account: { accountType: 'equity' },
      },
      include: { account: true },
    });

    const totalAssets = assets.reduce((sum, a) => sum + Number(a.debitAmount), 0);
    const totalLiabilities = liabilities.reduce((sum, l) => sum + Number(l.creditAmount), 0);
    const totalEquity = equity.reduce((sum, e) => sum + Number(e.creditAmount), 0);

    // Validate: Assets = Liabilities + Equity
    const isBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;

    return {
      reportType: 'balance_sheet',
      periodCode: period.code,
      assets: assets.map((a) => ({
        account: a.account.accountName,
        amount: Number(a.debitAmount),
      })),
      totalAssets,
      liabilities: liabilities.map((l) => ({
        account: l.account.accountName,
        amount: Number(l.creditAmount),
      })),
      totalLiabilities,
      equity: equity.map((e) => ({
        account: e.account.accountName,
        amount: Number(e.creditAmount),
      })),
      totalEquity,
      isBalanced,
    };
  }

  /**
   * Save generated report
   */
  async saveReport(
    periodId: string,
    reportType: string,
    reportData: any,
    createdBy?: string,
  ): Promise<any> {
    return this.prisma.financialReport.create({
      data: {
        periodId,
        reportType,
        reportDate: new Date(),
        jsonData: reportData,
        status: 'draft',
        createdBy,
      },
    });
  }

  /**
   * Approve and publish report
   */
  async approveReport(reportId: string, approvedBy: string): Promise<any> {
    return this.prisma.financialReport.update({
      where: { id: reportId },
      data: {
        status: 'approved',
        approvedBy,
        approvedAt: new Date(),
      },
    });
  }

  /**
   * Publish report (final)
   */
  async publishReport(reportId: string): Promise<any> {
    return this.prisma.financialReport.update({
      where: { id: reportId },
      data: {
        status: 'published',
        publishedAt: new Date(),
      },
    });
  }

  /**
   * Get report history
   */
  async getReportHistory(periodId: string, reportType?: string): Promise<any[]> {
    return this.prisma.financialReport.findMany({
      where: {
        periodId,
        reportType: reportType ? reportType : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
