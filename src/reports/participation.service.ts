import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ProjectBreakdown {
  projectCode: string;
  projectName: string;
  hours: number;
  percent: number;
}

export interface ParticipationRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  standardHours: number;
  projectHours: number;
  selfLearningHours: number;
  projectPercent: number;
  selfLearningPercent: number;
  alert: boolean; // true if selfLearning > threshold
  projects: ProjectBreakdown[];
}

@Injectable()
export class ParticipationReportService {
  private readonly logger = new Logger(ParticipationReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate participation report from synced local DB data.
   * Primary source: ProjectParticipation (multi-project breakdown).
   * Fallback: EmployeeHours (single-row summary if no ProjectParticipation data).
   */
  async generateMonthlyReport(
    year: number,
    month: number,
    selfLearningThreshold = 30,
  ): Promise<{
    month: number;
    year: number;
    reportDate: Date;
    rows: ParticipationRow[];
    alerts: Array<{ employeeId: string; employeeName: string; hours: number; message: string }>;
  }> {
    // Load all employees that have hours data for this month
    const employeeHoursList = await this.prisma.employeeHours.findMany({
      where: { year, month },
      include: {
        user: { select: { id: true, name: true, email: true, department: true } },
      },
    });

    const rows: ParticipationRow[] = [];
    const alerts: Array<{ employeeId: string; employeeName: string; hours: number; message: string }> = [];

    for (const eh of employeeHoursList) {
      const userId = eh.userId;
      const stdHours = eh.stdHours ? parseFloat(eh.stdHours.toString()) : 160;
      const loggedHours = eh.loggedHours ? parseFloat(eh.loggedHours.toString()) : 0;
      const selfLearningHours = Math.max(0, stdHours - loggedHours);

      // Load project breakdown from ProjectParticipation
      const participations = await this.prisma.projectParticipation.findMany({
        where: { userId, year, month },
        include: {
          project: { select: { code: true, name: true } },
        },
        orderBy: { loggedHours: 'desc' },
      });

      const projects: ProjectBreakdown[] = participations.map((p) => ({
        projectCode: p.project.code,
        projectName: p.project.name,
        hours: parseFloat(p.loggedHours.toString()),
        percent: parseFloat(p.participationPercent.toString()),
      }));

      const projectHours = projects.reduce((sum, p) => sum + p.hours, 0) || loggedHours;
      const projectPercent =
        stdHours > 0 ? Math.round((projectHours / stdHours) * 10000) / 100 : 0;
      const selfLearningPercent =
        stdHours > 0 ? Math.round((selfLearningHours / stdHours) * 10000) / 100 : 0;

      const hasAlert = selfLearningHours > selfLearningThreshold;

      if (hasAlert) {
        alerts.push({
          employeeId: userId,
          employeeName: eh.user.name,
          hours: Math.round(selfLearningHours * 100) / 100,
          message: `⚠️ Self-learning ${selfLearningHours.toFixed(1)}h > ${selfLearningThreshold}h threshold`,
        });
      }

      rows.push({
        employeeId: userId,
        employeeCode: eh.user.email?.replace('@erp', '') ?? userId,
        employeeName: eh.user.name,
        standardHours: Math.round(stdHours * 100) / 100,
        projectHours: Math.round(projectHours * 100) / 100,
        selfLearningHours: Math.round(selfLearningHours * 100) / 100,
        projectPercent,
        selfLearningPercent,
        alert: hasAlert,
        projects,
      });
    }

    return {
      month,
      year,
      reportDate: new Date(),
      rows: rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
      alerts: alerts.sort((a, b) => b.hours - a.hours),
    };
  }

  /**
   * Validate: projectPercent + selfLearningPercent should sum to ~100%
   */
  validateReport(rows: ParticipationRow[]): Array<{ employeeId: string; error: string }> {
    const errors: Array<{ employeeId: string; error: string }> = [];
    for (const row of rows) {
      const total = row.projectPercent + row.selfLearningPercent;
      if (Math.abs(total - 100) > 0.5) {
        errors.push({
          employeeId: row.employeeId,
          error: `Total % = ${total.toFixed(2)}% (expected ~100%)`,
        });
      }
    }
    return errors;
  }

  /**
   * Get employees approaching self-learning threshold (mid-month proactive check).
   * Returns employees where selfLearningHours > threshold * 0.7
   */
  async getAtRiskEmployees(
    year: number,
    month: number,
    threshold = 30,
  ): Promise<Array<{ employeeId: string; employeeName: string; selfLearningHours: number; threshold: number }>> {
    const report = await this.generateMonthlyReport(year, month, threshold);
    return report.rows
      .filter((r) => r.selfLearningHours >= threshold * 0.7)
      .map((r) => ({
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        selfLearningHours: r.selfLearningHours,
        threshold,
      }))
      .sort((a, b) => b.selfLearningHours - a.selfLearningHours);
  }
}
