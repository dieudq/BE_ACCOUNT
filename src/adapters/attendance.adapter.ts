import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

interface LeaveRecord {
  leaveType: string;
  startDate: Date;
  endDate: Date;
  numDays: Decimal;
  status: string;
}

interface LeaveStats {
  userId: string;
  year: number;
  month: number;
  totalLeaves: number;
  paidLeaves: number;
  unpaidLeaves: number;
  sickLeaves: number;
  otherLeaves: number;
  stdHours: number; // 160 hours/month as standard
  leaveHours: number; // calculated: (totalLeaves * 8) assuming 8h/day
  standardWorkHours: number; // 160 - leaveHours
}

@Injectable()
export class AttendanceAdapter {
  constructor(private prisma: PrismaService) {}

  /**
   * Get all leaves for a user in a specific month/year
   */
  async getLeavesByMonth(
    userId: string,
    year: number,
    month: number,
  ): Promise<LeaveRecord[]> {
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0);

    const leaves = await this.prisma.leave.findMany({
      where: {
        userId,
        status: 'approved',
        startDate: {
          lte: endOfMonth,
        },
        endDate: {
          gte: startOfMonth,
        },
      },
      select: {
        leaveType: true,
        startDate: true,
        endDate: true,
        numDays: true,
        status: true,
      },
    });

    return leaves;
  }

  /**
   * Get leave quota for a user in a specific year
   */
  async getLeaveQuota(
    userId: string,
    year: number,
    leaveType: string = 'paid',
  ): Promise<any> {
    const quota = await this.prisma.leaveQuota.findUnique({
      where: {
        userId_year_leaveType: {
          userId,
          year,
          leaveType,
        },
      },
    });

    return quota || { totalDays: 0, usedDays: 0, leaveType };
  }

  /**
   * Get all leave types used by user in a month
   */
  async getLeaveBreakdown(
    userId: string,
    year: number,
    month: number,
  ): Promise<Record<string, number>> {
    const leaves = await this.getLeavesByMonth(userId, year, month);

    const breakdown: Record<string, number> = {
      paid: 0,
      unpaid: 0,
      sick: 0,
      maternity: 0,
      personal: 0,
      other: 0,
    };

    leaves.forEach((leave) => {
      const type = leave.leaveType || 'other';
      breakdown[type] = (breakdown[type] || 0) + Number(leave.numDays);
    });

    return breakdown;
  }

  /**
   * Calculate standard work hours minus leave hours for a month
   */
  async calculateStandardWorkHours(
    userId: string,
    year: number,
    month: number,
  ): Promise<LeaveStats> {
    // Get holidays for the month (hardcoded for now, can be external data)
    const holidayDays = await this.getHolidayDaysInMonth(year, month);

    // Get all approved leaves for the month
    const leaves = await this.getLeavesByMonth(userId, year, month);
    const totalLeaves = leaves.reduce((sum, l) => sum + Number(l.numDays), 0);

    // Break down by type
    const breakdown = await this.getLeaveBreakdown(userId, year, month);

    // Standard: 160 hours/month = 20 working days * 8h/day
    // Adjust for holidays
    const workingDaysInMonth = 20 - holidayDays;
    const stdHours = workingDaysInMonth * 8;

    // Leave hours: each day = 8 hours
    const leaveHours = totalLeaves * 8;

    return {
      userId,
      year,
      month,
      totalLeaves,
      paidLeaves: breakdown.paid,
      unpaidLeaves: breakdown.unpaid,
      sickLeaves: breakdown.sick,
      otherLeaves: breakdown.other,
      stdHours,
      leaveHours,
      standardWorkHours: Math.max(0, stdHours - leaveHours),
    };
  }

  /**
   * Get user's remaining leave quota for a year
   */
  async getRemainingLeaveQuota(userId: string, year: number): Promise<any> {
    const quotas = await this.prisma.leaveQuota.findMany({
      where: { userId, year },
    });

    const remaining: Record<string, number> = {};

    for (const quota of quotas) {
      remaining[quota.leaveType] = Number(quota.totalDays) - Number(quota.usedDays);
    }

    return remaining;
  }

  /**
   * Record a new leave request (will be auto-approved for testing)
   */
  async createLeaveRequest(
    userId: string,
    leaveType: string,
    startDate: Date,
    endDate: Date,
    numDays: number,
    reason?: string,
  ): Promise<any> {
    return this.prisma.leave.create({
      data: {
        userId,
        leaveType,
        startDate,
        endDate,
        numDays: new Decimal(numDays),
        reason,
        status: 'approved', // Auto-approve for testing
        approvedAt: new Date(),
      },
    });
  }

  /**
   * Get holiday days in a month (Vietnam holidays hardcoded)
   */
  private async getHolidayDaysInMonth(year: number, month: number): Promise<number> {
    // Vietnam holidays (simplified - Lunar New Year, National Day, etc.)
    // For now, assume 2 public holidays per month on average (can be external)
    if (month === 1) return 3; // Tết (Lunar New Year)
    if (month === 9) return 2; // National Day
    return 0;
  }

  /**
   * Update leave quota for a user (admin function)
   */
  async updateLeaveQuota(
    userId: string,
    year: number,
    leaveType: string,
    totalDays: number,
  ): Promise<any> {
    return this.prisma.leaveQuota.upsert({
      where: {
        userId_year_leaveType: { userId, year, leaveType },
      },
      create: {
        userId,
        year,
        leaveType,
        totalDays: new Decimal(totalDays),
        usedDays: new Decimal(0),
      },
      update: {
        totalDays: new Decimal(totalDays),
      },
    });
  }

  /**
   * Sync used leaves and update quota
   */
  async syncLeaveUsage(userId: string, year: number): Promise<void> {
    // Get all approved leaves for the year
    const leaves = await this.prisma.leave.findMany({
      where: {
        userId,
        status: 'approved',
        startDate: {
          gte: new Date(year, 0, 1),
          lt: new Date(year + 1, 0, 1),
        },
      },
    });

    // Group by leave type and sum
    const usedByType: Record<string, number> = {};
    leaves.forEach((leave) => {
      const type = leave.leaveType;
      usedByType[type] = (usedByType[type] || 0) + Number(leave.numDays);
    });

    // Update quotas
    for (const [leaveType, usedDays] of Object.entries(usedByType)) {
      await this.prisma.leaveQuota.update({
        where: {
          userId_year_leaveType: { userId, year, leaveType },
        },
        data: {
          usedDays: new Decimal(usedDays),
        },
      });
    }
  }
}
