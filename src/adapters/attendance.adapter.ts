import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AttendanceAdapter {
  constructor(private prisma: PrismaService) {}

  /**
   * Calculate standard working hours for employee in a given month
   * Simplified: 160 hours (20 working days * 8 hours/day)
   * TODO: Integrate with actual calendar when extended models are added
   */
  async getStandardHours(
    employeeId: string,
    year: number,
    month: number,
  ): Promise<{
    standardHours: number;
  }> {
    try {
      // Verify employee exists
      const user = await this.prisma.user.findUnique({
        where: { id: employeeId },
      });

      if (!user) {
        throw new Error(`Employee not found: ${employeeId}`);
      }

      // Return simplified 160 hours (20 working days * 8 hours/day)
      return { standardHours: 160 };
    } catch (error) {
      console.error('Error calculating standard hours:', error);
      return { standardHours: 160 };
    }
  }

  /**
   * Get employee basic info
   */
  async getEmployeeBasicInfo(employeeId: string): Promise<any> {
    return this.prisma.user.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
  }
}
