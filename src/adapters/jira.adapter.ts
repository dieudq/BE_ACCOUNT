import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JiraAdapter {
  constructor(private prisma: PrismaService) {}

  /**
   * Fetch worklogs from DB by month (simplified version using EmployeeHours)
   * Groups by user + project
   */
  async getWorklogsByMonth(year: number, month: number): Promise<
    Array<{
      projectId: string;
      projectCode: string;
      projectName: string;
      userId: string;
      userName: string;
      totalHours: number;
    }>
  > {
    try {
      const hours = await this.prisma.employeeHours.findMany({
        where: {
          year,
          month,
        },
        include: {
          user: true,
          project: true,
        },
      });

      // Transform to worklog format
      return hours.map((h) => ({
        projectId: h.projectId || 'unknown',
        projectCode: h.project?.code || 'UNKNOWN',
        projectName: h.project?.name || 'Unknown Project',
        userId: h.userId,
        userName: h.user.name,
        totalHours: h.loggedHours ? parseFloat(h.loggedHours.toString()) : 0,
      }));
    } catch (error) {
      console.error('Error fetching worklogs:', error);
      return [];
    }
  }

  /**
   * Get project details
   */
  async getProject(projectId: string): Promise<any> {
    return this.prisma.project.findUnique({
      where: { id: projectId },
    });
  }
}
