import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JiraAdapter } from '../adapters/jira.adapter';
import { AttendanceAdapter } from '../adapters/attendance.adapter';

export interface ParticipationRow {
  employeeId: string;
  employeeName: string;
  standardHours: number;
  projectHours: number;
  selfLearningHours: number;
  projectPercent: number;
  selfLearningPercent: number;
  alert: boolean; // true if selfLearning > 30
  projects: Array<{
    projectCode: string;
    projectName: string;
    hours: number;
    percent: number;
  }>;
}

@Injectable()
export class ParticipationReportService {
  constructor(
    private prisma: PrismaService,
    private jira: JiraAdapter,
    private attendance: AttendanceAdapter,
  ) {}

  /**
   * Generate participation report for all employees in a month
   */
  async generateMonthlyReport(year: number, month: number): Promise<{
    month: number;
    year: number;
    reportDate: Date;
    rows: ParticipationRow[];
    alerts: Array<{ employeeId: string; hours: number; message: string }>;
  }> {
    try {
      // Get all users (employees)
      const users = await this.prisma.user.findMany({
        where: {
          role: { in: ['employee', 'manager'] },
        },
        select: { id: true, name: true, joinDate: true },
      });

      const rows: ParticipationRow[] = [];
      const alerts: Array<{ employeeId: string; hours: number; message: string }> = [];

      // Process each employee
      for (const emp of users) {
        // ✅ FIX P4: Calculate standard hours considering join date
        const periodStart = new Date(year, month - 1, 1);
        const periodEnd = new Date(year, month, 0);
        
        let adjustedStdHours = 160; // Default: full month
        if (emp.joinDate) {
          const joinDate = new Date(emp.joinDate);
          if (joinDate > periodStart && joinDate <= periodEnd) {
            // Employee joined within this month
            const daysWorked = Math.ceil(
              (periodEnd.getTime() - joinDate.getTime()) / (1000 * 60 * 60 * 24),
            );
            const totalDaysInMonth = Math.ceil(
              (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24),
            );
            adjustedStdHours = Math.round((160 * daysWorked) / totalDaysInMonth);
          }
        }

        // Get standard hours (after subtracting leave)
        const leaveStats = await this.attendance.calculateStandardWorkHours(emp.id, year, month);
        const stdHours = Math.min(leaveStats.standardWorkHours, adjustedStdHours); // Use lower value

        // Get employee hours (logged from Jira or manual entry)
        const empHours = await this.prisma.employeeHours.findUnique({
          where: {
            userId_year_month: {
              userId: emp.id,
              year,
              month,
            },
          },
          include: {
            project: true,
          },
        });

        let totalProjectHours = 0;
        const projectMap = new Map<string, { code: string; name: string; hours: number }>();

        if (empHours) {
          totalProjectHours = empHours.loggedHours 
            ? typeof empHours.loggedHours === 'object' && 'toNumber' in empHours.loggedHours
              ? (empHours.loggedHours as any).toNumber()
              : parseFloat((empHours.loggedHours as any).toString())
            : 0;

          if (empHours.project) {
            projectMap.set(empHours.project.id, {
              code: empHours.project.code,
              name: empHours.project.name,
              hours: totalProjectHours,
            });
          }
        }

        // Calculate self-learning
        const selfLearningHours = Math.max(0, leaveStats.standardWorkHours - totalProjectHours);
        const projectPercent =
          leaveStats.standardWorkHours > 0
            ? Math.round((totalProjectHours / leaveStats.standardWorkHours) * 10000) / 100
            : 0;
        const selfLearningPercent =
          leaveStats.standardWorkHours > 0
            ? Math.round((selfLearningHours / leaveStats.standardWorkHours) * 10000) / 100
            : 0;

        // Check alert
        const hasAlert = selfLearningHours > 30;

        if (hasAlert) {
          alerts.push({
            employeeId: emp.id,
            hours: selfLearningHours,
            message: `⚠️ Self-learning hours exceeded 30h: ${selfLearningHours.toFixed(2)}h`,
          });
        }

        const row: ParticipationRow = {
          employeeId: emp.id,
          employeeName: emp.name,
          standardHours: leaveStats.standardWorkHours,
          projectHours: Math.round(totalProjectHours * 100) / 100,
          selfLearningHours: Math.round(selfLearningHours * 100) / 100,
          projectPercent,
          selfLearningPercent,
          alert: hasAlert,
          projects: Array.from(projectMap.values()).map((p) => ({
            projectCode: p.code,
            projectName: p.name,
            hours: Math.round(p.hours * 100) / 100,
            percent: Math.round((p.hours / leaveStats.standardWorkHours) * 10000) / 100,
          })),
        };

        rows.push(row);
      }

      return {
        month,
        year,
        reportDate: new Date(),
        rows: rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
        alerts,
      };
    } catch (error) {
      console.error('Error generating participation report:', error);
      throw error;
    }
  }

  /**
   * Validate report: total % should = 100% (allow 0.5% error due to rounding)
   */
  validateReport(rows: ParticipationRow[]): Array<{ employeeId: string; error: string }> {
    const errors: Array<{ employeeId: string; error: string }> = [];

    for (const row of rows) {
      const total = row.projectPercent + row.selfLearningPercent;
      const diff = Math.abs(total - 100);

      if (diff > 0.5) {
        errors.push({
          employeeId: row.employeeId,
          error: `Total % = ${total}% (expected 100%, max error 0.5%)`,
        });
      }
    }

    return errors;
  }
}
