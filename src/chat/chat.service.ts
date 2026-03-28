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

    // Get participations
    const participations = await this.prisma.projectParticipation.findMany({
      where: { userId: user.id },
      include: { project: true },
    });

    const context = {
      userName: user.name,
      department: user.department,
      role: user.role,
      projects: participations.map(p => ({
        projectName: p.project.name,
        participationPercent: p.participationPercent,
      })),
    };

    // Query Groq
    try {
      const response = await this.groq.analyze(context, message);
      return response;
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }
}
