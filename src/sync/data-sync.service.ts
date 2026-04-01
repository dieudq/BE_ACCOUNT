import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ERPClientService, ERPMonthlyEmployee } from '../common/services/erp-client.service';

@Injectable()
export class DataSyncService {
  private readonly logger = new Logger(DataSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly erpClient: ERPClientService,
  ) {}

  /**
   * Sync monthly workload report from ERP → local DB.
   * Stores per-project rows in ProjectParticipation (multi-project per employee).
   * Falls back to empty result if ERP is unavailable.
   */
  async syncMonthlyWorkloadReport(
    year: number,
    month: number,
    deptCode?: string,
  ): Promise<{ synced: number; atRisk: number; message: string }> {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    console.log(month);
    try {
      const healthy = await this.erpClient.healthCheck();
      if (!healthy) {
        this.logger.warn(`⚠️ ERP unavailable — skipping workload sync for ${monthStr}`);
        return { synced: 0, atRisk: 0, message: '⚠️ ERP unavailable' };
      }

      const report = await this.erpClient.getMonthlyWorkloadReport(monthStr, deptCode);

      let synced = 0;

      for (const emp of report.employees) {
        try {
          await this.upsertEmployee(emp);
          await this.upsertEmployeeHours(emp, year, month);
          await this.upsertProjectParticipations(emp, year, month);
          synced++;
        } catch (err: any) {
          this.logger.error(
            `❌ Sync error for employee ${emp.employeeId} (${emp.fullName}): ${err.message}`,
          );
        }
      }

      this.logger.log(
        `✅ Workload sync complete: ${synced}/${report.employees.length} employees, atRisk=${report.summary.atRiskCount}`,
      );

      return {
        synced,
        atRisk: report.summary.atRiskCount,
        message: `✅ Synced ${synced} employees from ERP (${monthStr})`,
      };
    } catch (err: any) {
      this.logger.error(`❌ Workload sync failed: ${err.message}`);
      return { synced: 0, atRisk: 0, message: `❌ Sync failed: ${err.message}` };
    }
  }

  /**
   * Sync employees from ERP
   */
  async syncEmployees(): Promise<{ synced: number; message: string }> {
    try {
      const healthy = await this.erpClient.healthCheck();
      if (!healthy) {
        return { synced: 0, message: '⚠️ ERP unavailable' };
      }

      // Re-use workload report for current month to get employee list
      const now = new Date();
      const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const report = await this.erpClient.getMonthlyWorkloadReport(monthStr);

      let synced = 0;
      for (const emp of report.employees) {
        await this.upsertEmployee(emp);
        synced++;
      }

      return { synced, message: `✅ Synced ${synced} employees from ERP` };
    } catch (err: any) {
      return { synced: 0, message: `❌ Employee sync failed: ${err.message}` };
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async upsertEmployee(emp: ERPMonthlyEmployee): Promise<void> {
    // Use employeeId as stable external identifier mapped to local User
    const existing = await this.prisma.user.findFirst({
      where: { email: `${emp.employeeId}@erp` },
    });

    if (!existing) {
      await this.prisma.user.create({
        data: {
          name: emp.fullName ?? emp.employeeId,
          email: `${emp.employeeId}@erp`,
          department: emp.department ?? undefined,
          role: 'employee',
        },
      });
    } else {
      await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          name: emp.fullName ?? existing.name,
          department: emp.department ?? existing.department,
        },
      });
    }
  }

  private async getLocalUserId(employeeId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { email: `${employeeId}@erp` },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  private async upsertEmployeeHours(
    emp: ERPMonthlyEmployee,
    year: number,
    month: number,
  ): Promise<void> {
    const userId = await this.getLocalUserId(emp.employeeId);
    if (!userId) return;

    await this.prisma.employeeHours.upsert({
      where: { userId_year_month: { userId, year, month } },
      create: {
        userId,
        year,
        month,
        loggedHours: emp.actualLoggedHours.toString(),
        stdHours: emp.effectiveStandardHours.toString(),
        selfLearningHours: emp.selfLearningHours.toString(),
        syncedAt: new Date(),
      },
      update: {
        loggedHours: emp.actualLoggedHours.toString(),
        stdHours: emp.effectiveStandardHours.toString(),
        selfLearningHours: emp.selfLearningHours.toString(),
        syncedAt: new Date(),
      },
    });

    // Store alert if at risk
    if (emp.isAtRisk) {
      await this.prisma.alert.upsert({
        where: {
          // No unique constraint on alert — use findFirst + create pattern
          id: `placeholder`,
        },
        create: {
          alertType: 'SELF_LEARNING_EXCEEDED',
          userId,
          message: `⚠️ Self-learning ${emp.selfLearningHours.toFixed(1)}h > threshold (${year}/${month})`,
        },
        update: {},
      }).catch(async () => {
        // Upsert not ideal here — just create if not already alerted this month
        const existing = await this.prisma.alert.findFirst({
          where: {
            userId,
            alertType: 'SELF_LEARNING_EXCEEDED',
            createdAt: {
              gte: new Date(year, month - 1, 1),
              lte: new Date(year, month, 0),
            },
          },
        });
        if (!existing) {
          await this.prisma.alert.create({
            data: {
              alertType: 'SELF_LEARNING_EXCEEDED',
              userId,
              message: `⚠️ Self-learning ${emp.selfLearningHours.toFixed(1)}h > threshold (${year}/${month})`,
            },
          });
        }
      });
    }
  }

  private async upsertProjectParticipations(
    emp: ERPMonthlyEmployee,
    year: number,
    month: number,
  ): Promise<void> {
    const userId = await this.getLocalUserId(emp.employeeId);
    if (!userId) return;

    for (const proj of emp.projects) {
      // Ensure project exists locally
      const localProject = await this.prisma.project.upsert({
        where: { code: proj.projectKey },
        create: {
          code: proj.projectKey,
          name: proj.projectName,
          status: 'active',
        },
        update: { name: proj.projectName },
      });

      await this.prisma.projectParticipation.upsert({
        where: {
          userId_projectId_year_month: {
            userId,
            projectId: localProject.id,
            year,
            month,
          },
        },
        create: {
          userId,
          projectId: localProject.id,
          year,
          month,
          loggedHours: proj.hours.toString(),
          participationPercent: proj.percent.toString(),
        },
        update: {
          loggedHours: proj.hours.toString(),
          participationPercent: proj.percent.toString(),
        },
      });
    }
  }
}
