import { Injectable } from '@nestjs/common';
import { GroqService } from '../groq/groq.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(
    private groq: GroqService,
    private prisma: PrismaService,
  ) {}

  async processQuery(message: string, userId: string): Promise<string> {
    try {
      // Get or create user from DB
      let user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        // Auto-create if user not found (for Telegram testing)
        user = await this.prisma.user.create({
          data: {
            id: userId,
            name: `User ${userId}`,
            telegramId: userId,
            role: 'employee',
          },
        });
      }

      // Fetch actual data from database
      const employees = await this.prisma.user.findMany({
        where: { role: 'employee' },
        select: { id: true, name: true, email: true, department: true },
      });

      const projects = await this.prisma.project.findMany({
        select: { id: true, code: true, name: true, status: true },
      });

      const employeeHours = await this.prisma.employeeHours.findMany({
        include: {
          user: { select: { name: true } },
          project: { select: { code: true, name: true } },
        },
      });

      const context = {
        currentUser: {
          name: user.name,
          email: user.email,
          department: user.department,
          role: user.role,
        },
        companyData: {
          employees: employees.map(e => ({
            name: e.name,
            email: e.email,
            department: e.department,
          })),
          projects: projects.map(p => ({
            code: p.code,
            name: p.name,
            status: p.status,
          })),
          employeeHours: employeeHours.map(h => ({
            employee: h.user.name,
            project: h.project?.code || 'UNKNOWN',
            month: `${h.year}-${String(h.month).padStart(2, '0')}`,
            loggedHours: h.loggedHours,
            standardHours: h.stdHours,
          })),
        },
      };

      // Query Groq with real data
      const response = await this.groq.analyze(context, message);
      return response;
    } catch (error) {
      console.error('Chat error:', error);
      return `Error: ${error.message}`;
    }
  }
}
