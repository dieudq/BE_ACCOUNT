import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class JournalEntryService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a journal entry (double-entry bookkeeping)
   * Validates: Debit = Credit
   */
  async createEntry(
    periodId: string,
    entryDate: Date,
    description: string,
    debitAccountId: string,
    debitAmount: number,
    creditAccountId: string,
    creditAmount: number,
    costCenterId?: string,
    reference?: string,
    createdBy?: string,
  ): Promise<any> {
    // Validate double-entry: debit must equal credit
    if (Math.abs(Number(debitAmount) - Number(creditAmount)) > 0.01) {
      throw new Error(
        `Double-entry validation failed: Debit ${debitAmount} ≠ Credit ${creditAmount}`,
      );
    }

    // Check if period is locked
    const period = await this.prisma.financialPeriod.findUnique({
      where: { id: periodId },
    });

    if (!period) {
      throw new Error('Period not found');
    }

    if (period.isClosed) {
      throw new Error(`Period ${period.code} is locked. Cannot post entries.`);
    }

    // Generate entry number
    const entryNumber = `JE-${period.fiscalYear}-${String(period.fiscalMonth || 0).padStart(2, '0')}-${await this.getNextEntryNumber(periodId)}`;

    return this.prisma.journalEntry.create({
      data: {
        periodId,
        entryNumber,
        entryDate,
        description,
        debitAccountId,
        debitAmount: new Decimal(debitAmount),
        creditAccountId,
        creditAmount: new Decimal(creditAmount),
        costCenterId,
        reference,
        createdBy,
        status: 'pending', // Needs approval
      },
      include: {
        debitAccount: true,
        creditAccount: true,
      },
    });
  }

  /**
   * Approve and post a journal entry
   */
  async approveAndPost(entryId: string, approvedBy: string): Promise<any> {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id: entryId },
      include: { period: true },
    });

    if (!entry) {
      throw new Error('Journal entry not found');
    }

    if (entry.period.isClosed) {
      throw new Error(`Period ${entry.period.code} is locked`);
    }

    // Update entry status
    const updated = await this.prisma.journalEntry.update({
      where: { id: entryId },
      data: {
        status: 'posted',
        approvedBy,
        approvedAt: new Date(),
      },
    });

    // Update GL balances
    await this.updateGLBalances(entry.periodId, entry.debitAccountId, entry.creditAccountId);

    return updated;
  }

  /**
   * Reverse a journal entry (creates offsetting entry)
   */
  async reverseEntry(entryId: string, reason: string, createdBy?: string): Promise<any> {
    const originalEntry = await this.prisma.journalEntry.findUnique({
      where: { id: entryId },
      include: { period: true },
    });

    if (!originalEntry) {
      throw new Error('Journal entry not found');
    }

    if (originalEntry.period.isClosed) {
      throw new Error(`Period ${originalEntry.period.code} is locked`);
    }

    const period = originalEntry.period;
    const entryNumber = `JE-${period.fiscalYear}-${String(period.fiscalMonth).padStart(2, '0')}-${await this.getNextEntryNumber(period.id)}`;

    // Create reverse entry (swap debit/credit)
    const reversalEntry = await this.prisma.journalEntry.create({
      data: {
        periodId: originalEntry.periodId,
        entryNumber,
        entryDate: new Date(),
        description: `REVERSAL: ${originalEntry.description} - ${reason}`,
        debitAccountId: originalEntry.creditAccountId,
        debitAmount: originalEntry.creditAmount,
        creditAccountId: originalEntry.debitAccountId,
        creditAmount: originalEntry.debitAmount,
        costCenterId: originalEntry.costCenterId,
        reference: `REVERSAL-${originalEntry.entryNumber}`,
        createdBy,
        status: 'posted',
        approvedBy: createdBy,
        approvedAt: new Date(),
      },
    });

    // Mark original as reversed
    await this.prisma.journalEntry.update({
      where: { id: entryId },
      data: {
        status: 'reversed',
        reversedAt: new Date(),
      },
    });

    return reversalEntry;
  }

  /**
   * Get entries for a period
   */
  async getEntriesByPeriod(periodId: string, status?: string): Promise<any[]> {
    return this.prisma.journalEntry.findMany({
      where: {
        periodId,
        status: status ? status : undefined,
      },
      include: {
        debitAccount: true,
        creditAccount: true,
      },
      orderBy: { entryDate: 'asc' },
    });
  }

  /**
   * Validate cân bằng (Debit = Credit for period)
   */
  async validateBalance(periodId: string): Promise<{
    isBalanced: boolean;
    totalDebit: number;
    totalCredit: number;
    variance: number;
  }> {
    const entries = await this.getEntriesByPeriod(periodId, 'posted');

    let totalDebit = 0;
    let totalCredit = 0;

    entries.forEach((entry) => {
      totalDebit += Number(entry.debitAmount);
      totalCredit += Number(entry.creditAmount);
    });

    const variance = Math.abs(totalDebit - totalCredit);
    const isBalanced = variance < 0.01;

    return {
      isBalanced,
      totalDebit,
      totalCredit,
      variance,
    };
  }

  /**
   * Private helper: Get next entry sequence
   */
  private async getNextEntryNumber(periodId: string): Promise<string> {
    const lastEntry = await this.prisma.journalEntry.findMany({
      where: { periodId },
      take: 1,
      orderBy: { entryNumber: 'desc' },
    });

    if (lastEntry.length === 0) {
      return '001';
    }

    const parts = lastEntry[0].entryNumber.split('-');
    const lastNum = parseInt(parts[parts.length - 1] || '0', 10);
    return String(lastNum + 1).padStart(3, '0');
  }

  /**
   * Update GL Account balances after posting
   */
  private async updateGLBalances(
    periodId: string,
    debitAccountId: string,
    creditAccountId: string,
  ): Promise<void> {
    // Fetch all entries for these accounts in the period
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        periodId,
        status: 'posted',
      },
    });

    // Recalculate GL balances
    const debitEntries = entries.filter((e) => e.debitAccountId === debitAccountId);
    const creditEntries = entries.filter((e) => e.creditAccountId === debitAccountId);

    const debitSum = debitEntries.reduce((sum, e) => sum + Number(e.debitAmount), 0);
    const creditSum = creditEntries.reduce((sum, e) => sum + Number(e.creditAmount), 0);

    await this.prisma.generalLedger.upsert({
      where: {
        accountId_periodId: {
          accountId: debitAccountId,
          periodId,
        },
      },
      create: {
        accountId: debitAccountId,
        periodId,
        debitAmount: new Decimal(debitSum),
        creditAmount: new Decimal(creditSum),
        closingBalance: new Decimal(debitSum - creditSum),
      },
      update: {
        debitAmount: new Decimal(debitSum),
        creditAmount: new Decimal(creditSum),
        closingBalance: new Decimal(debitSum - creditSum),
      },
    });
  }
}
