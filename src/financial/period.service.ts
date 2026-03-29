import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class FinancialPeriodService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new financial period
   */
  async createPeriod(
    code: string,
    description: string,
    startDate: Date,
    endDate: Date,
    fiscalYear: number,
    fiscalMonth?: number,
  ): Promise<any> {
    return this.prisma.financialPeriod.create({
      data: {
        code,
        description,
        startDate,
        endDate,
        status: 'open',
        fiscalYear,
        fiscalMonth,
      },
    });
  }

  /**
   * Get current open period
   */
  async getCurrentPeriod(): Promise<any> {
    return this.prisma.financialPeriod.findFirst({
      where: { status: 'open' },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * Get period by code
   */
  async getPeriodByCode(code: string): Promise<any> {
    return this.prisma.financialPeriod.findUnique({
      where: { code },
    });
  }

  /**
   * Close a period (lock it from new entries)
   */
  async closePeriod(periodId: string): Promise<any> {
    return this.prisma.financialPeriod.update({
      where: { id: periodId },
      data: {
        status: 'closed',
        isClosed: true,
      },
    });
  }

  /**
   * Check if period is locked
   */
  async isPeriodLocked(periodId: string): Promise<boolean> {
    const period = await this.prisma.financialPeriod.findUnique({
      where: { id: periodId },
    });
    return period?.isClosed || false;
  }

  /**
   * List all periods
   */
  async listPeriods(fiscalYear?: number): Promise<any[]> {
    return this.prisma.financialPeriod.findMany({
      where: fiscalYear ? { fiscalYear } : {},
      orderBy: { startDate: 'desc' },
    });
  }
}
