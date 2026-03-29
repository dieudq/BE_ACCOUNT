import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ERPAdapter } from '../adapters/erp.adapter';
import { JiraAdapter } from '../adapters/jira.adapter';

@Injectable()
export class DataSyncService {
  constructor(
    private prisma: PrismaService,
    private erp: ERPAdapter,
    private jira: JiraAdapter,
  ) {}

  /**
   * Sync worklogs from ERP → Database
   * Falls back to Jira (local DB) if ERP unavailable
   */
  async syncMonthlyWorklogs(year: number, month: number): Promise<{
    source: 'erp' | 'local';
    synced: number;
    message: string;
  }> {
    try {
      // Try ERP first
      const erpHealth = await this.erp.healthCheck();

      if (erpHealth) {
        console.log('✅ ERP online, fetching worklogs...');
        const erpWorklogs = await this.erp.getEmployeeWorklogs(year, month);

        if (erpWorklogs.length > 0) {
          // Save to local DB
          for (const log of erpWorklogs) {
            // Find or create user
            let user = await this.prisma.user.findFirst({
              where: { email: log.employeeName + '@erp' },
            });

            if (!user) {
              user = await this.prisma.user.create({
                data: {
                  name: log.employeeName,
                  email: log.employeeName + '@erp',
                  department: 'ERP Sync',
                  role: 'employee',
                },
              });
            }

            // Find or create project
            let project = await this.prisma.project.findFirst({
              where: { code: log.projectCode },
            });

            if (!project) {
              project = await this.prisma.project.create({
                data: {
                  code: log.projectCode,
                  name: log.projectName,
                  status: 'active',
                },
              });
            }

            // Upsert employee hours
            await this.prisma.employeeHours.upsert({
              where: {
                userId_year_month: {
                  userId: user.id,
                  year,
                  month,
                },
              },
              create: {
                userId: user.id,
                projectId: project.id,
                year,
                month,
                loggedHours: log.loggedHours.toString(),
                stdHours: '160.00',
                selfLearningHours: Math.max(0, 160 - log.loggedHours).toString(),
                syncedAt: new Date(),
              },
              update: {
                loggedHours: log.loggedHours.toString(),
                selfLearningHours: Math.max(0, 160 - log.loggedHours).toString(),
                syncedAt: new Date(),
              },
            });
          }

          return {
            source: 'erp',
            synced: erpWorklogs.length,
            message: `✅ Synced ${erpWorklogs.length} worklogs from ERP`,
          };
        }
      }

      // Fallback to local Jira/DB
      console.log('⚠️ ERP unavailable, using local database...');
      const localWorklogs = await this.jira.getWorklogsByMonth(year, month);

      return {
        source: 'local',
        synced: localWorklogs.length,
        message: `⚠️ Using local database (${localWorklogs.length} worklogs)`,
      };
    } catch (error) {
      console.error('❌ Sync error:', error.message);
      return {
        source: 'local',
        synced: 0,
        message: `❌ Sync failed: ${error.message}`,
      };
    }
  }

  /**
   * Sync employees from ERP → Database
   */
  async syncEmployees(): Promise<{
    synced: number;
    message: string;
  }> {
    try {
      const erpHealth = await this.erp.healthCheck();

      if (!erpHealth) {
        return {
          synced: 0,
          message: '⚠️ ERP unavailable',
        };
      }

      const erpEmployees = await this.erp.getEmployees();

      if (erpEmployees.length === 0) {
        return {
          synced: 0,
          message: 'No employees from ERP',
        };
      }

      let syncedCount = 0;

      for (const emp of erpEmployees) {
        await this.prisma.user.upsert({
          where: { email: emp.email },
          create: {
            name: emp.name,
            email: emp.email,
            department: emp.department,
            role: 'employee',
          },
          update: {
            name: emp.name,
            department: emp.department,
          },
        });
        syncedCount++;
      }

      return {
        synced: syncedCount,
        message: `✅ Synced ${syncedCount} employees from ERP`,
      };
    } catch (error) {
      console.error('❌ Employee sync error:', error.message);
      return {
        synced: 0,
        message: `❌ Employee sync failed: ${error.message}`,
      };
    }
  }

  /**
   * Sync projects from ERP → Database
   */
  async syncProjects(): Promise<{
    synced: number;
    message: string;
  }> {
    try {
      const erpHealth = await this.erp.healthCheck();

      if (!erpHealth) {
        return {
          synced: 0,
          message: '⚠️ ERP unavailable',
        };
      }

      const erpProjects = await this.erp.getProjects();

      if (erpProjects.length === 0) {
        return {
          synced: 0,
          message: 'No projects from ERP',
        };
      }

      let syncedCount = 0;

      for (const proj of erpProjects) {
        await this.prisma.project.upsert({
          where: { code: proj.code },
          create: {
            name: proj.name,
            code: proj.code,
            status: 'active',
          },
          update: {
            name: proj.name,
          },
        });
        syncedCount++;
      }

      return {
        synced: syncedCount,
        message: `✅ Synced ${syncedCount} projects from ERP`,
      };
    } catch (error) {
      console.error('❌ Project sync error:', error.message);
      return {
        synced: 0,
        message: `❌ Project sync failed: ${error.message}`,
      };
    }
  }
}
