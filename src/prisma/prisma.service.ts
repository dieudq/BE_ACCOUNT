import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private isMock = false;

  constructor() {
    super();
    this.isMock = process.env.USE_MOCK_DB === 'true';
  }

  async onModuleInit() {
    if (this.isMock) {
      console.log('🎭 [MOCK MODE] PrismaService initialized without DB connection');
      this.initMockData();
    } else {
      try {
        await this.$connect();
        console.log('✅ Prisma connected to database');
      } catch (error) {
        console.warn('⚠️ Failed to connect to database, falling back to mock mode');
        this.isMock = true;
        this.initMockData();
      }
    }
  }

  private initMockData() {
    // Setup mock data providers (see prisma.service.mock.ts for implementation)
    this.setupMockUser();
    this.setupMockProject();
    this.setupMockEmployeeHours();
    this.setupMockBotLog();
  }

  private setupMockUser() {
    const mockUsers = [
      {
        id: 'emp001',
        name: 'Nguyễn Văn A',
        email: 'a@company.com',
        telegramId: '5377791753',
        department: 'Engineering',
        role: 'employee',
      },
      {
        id: 'emp002',
        name: 'Trần Thị B',
        email: 'b@company.com',
        telegramId: null,
        department: 'Design',
        role: 'employee',
      },
      {
        id: 'emp003',
        name: 'Lê Văn C',
        email: 'c@company.com',
        telegramId: null,
        department: 'Engineering',
        role: 'manager',
      },
    ];

    (this as any).user = {
      findUnique: ({ where }: any) => mockUsers.find((u) => u.id === where.id),
      findMany: ({ where }: any = {}) => {
        if (!where) return mockUsers;
        if (where.role?.in) {
          return mockUsers.filter((u) => where.role.in.includes(u.role));
        }
        return mockUsers;
      },
    };
  }

  private setupMockProject() {
    const mockProjects = [
      {
        id: 'proj001',
        name: 'Project Alpha',
        code: 'ALPHA',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: 'active',
      },
      {
        id: 'proj002',
        name: 'Project Beta',
        code: 'BETA',
        startDate: new Date('2026-02-01'),
        endDate: null,
        status: 'active',
      },
    ];

    (this as any).project = {
      findUnique: ({ where }: any) => mockProjects.find((p) => p.id === where.id),
      findMany: () => mockProjects,
    };
  }

  private setupMockEmployeeHours() {
    const mockEmployeeHours = [
      {
        id: 'eh001',
        userId: 'emp001',
        projectId: 'proj001',
        year: 2026,
        month: 3,
        loggedHours: { toNumber: () => 120 },
        stdHours: '160.00',
        selfLearningHours: '40.00',
      },
      {
        id: 'eh002',
        userId: 'emp002',
        projectId: 'proj002',
        year: 2026,
        month: 3,
        loggedHours: { toNumber: () => 140 },
        stdHours: '160.00',
        selfLearningHours: '20.00',
      },
      {
        id: 'eh003',
        userId: 'emp003',
        projectId: 'proj001',
        year: 2026,
        month: 3,
        loggedHours: { toNumber: () => 100 },
        stdHours: '160.00',
        selfLearningHours: '60.00',
      },
    ];

    const mockUsers = [
      { id: 'emp001', name: 'Nguyễn Văn A' },
      { id: 'emp002', name: 'Trần Thị B' },
      { id: 'emp003', name: 'Lê Văn C' },
    ];

    const mockProjects = [
      { id: 'proj001', code: 'ALPHA', name: 'Project Alpha' },
      { id: 'proj002', code: 'BETA', name: 'Project Beta' },
    ];

    (this as any).employeeHours = {
      findUnique: ({ where }: any) => {
        const { userId_year_month } = where;
        const eh = mockEmployeeHours.find(
          (e) =>
            e.userId === userId_year_month.userId &&
            e.year === userId_year_month.year &&
            e.month === userId_year_month.month,
        );
        if (eh && where.include?.project) {
          return {
            ...eh,
            user: mockUsers.find((u) => u.id === eh.userId),
            project: mockProjects.find((p) => p.id === eh.projectId),
          };
        }
        return eh;
      },
      findMany: ({ where, include }: any = {}) => {
        let results = mockEmployeeHours;
        if (where?.year) results = results.filter((e) => e.year === where.year);
        if (where?.month) results = results.filter((e) => e.month === where.month);

        if (include?.user || include?.project) {
          return results.map((eh) => ({
            ...eh,
            user: mockUsers.find((u) => u.id === eh.userId),
            project: mockProjects.find((p) => p.id === eh.projectId),
          }));
        }
        return results;
      },
    };
  }

  private setupMockBotLog() {
    const logs: any[] = [];

    (this as any).botLog = {
      create: ({ data }: any) => {
        const log = { id: `log_${Date.now()}`, createdAt: new Date(), ...data };
        logs.push(log);
        return log;
      },
      findMany: () => logs,
    };
  }

  async onModuleDestroy() {
    if (!this.isMock) {
      await this.$disconnect();
    }
  }
}
