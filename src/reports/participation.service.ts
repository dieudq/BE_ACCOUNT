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
        select: { id: true, name: true },
      });

      const rows: ParticipationRow[] = [];
      const alerts: Array<{ employeeId: string; hours: number; message: string }> = [];

      // Process each employee
      for (const emp of users) {
        // Get standard hours
        const stdHours = await this.attendance.getStandardHours(emp.id, year, month);

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
          totalProjectHours = empHours.loggedHours ? parseFloat(empHours.loggedHours.toString()) : 0;

          if (empHours.project) {
            projectMap.set(empHours.project.id, {
              code: empHours.project.code,
              name: empHours.project.name,
              hours: totalProjectHours,
            });
          }
        }

        // Calculate self-learning
        const selfLearningHours = Math.max(0, stdHours.standardHours - totalProjectHours);
        const projectPercent =
          stdHours.standardHours > 0
            ? Math.round((totalProjectHours / stdHours.standardHours) * 10000) / 100
            : 0;
        const selfLearningPercent =
          stdHours.standardHours > 0
            ? Math.round((selfLearningHours / stdHours.standardHours) * 10000) / 100
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
          standardHours: stdHours.standardHours,
          projectHours: Math.round(totalProjectHours * 100) / 100,
          selfLearningHours: Math.round(selfLearningHours * 100) / 100,
          projectPercent,
          selfLearningPercent,
          alert: hasAlert,
          projects: Array.from(projectMap.values()).map((p) => ({
            projectCode: p.code,
            projectName: p.name,
            hours: Math.round(p.hours * 100) / 100,
            percent: Math.round((p.hours / stdHours.standardHours) * 10000) / 100,
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
