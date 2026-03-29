import { Controller, Post, Get, Query } from '@nestjs/common';
import { DataSyncService } from './data-sync.service';

@Controller('api/sync')
export class SyncController {
  constructor(private syncService: DataSyncService) {}

  @Post('worklogs')
  async syncWorklogs(
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.syncService.syncMonthlyWorklogs(parseInt(year), parseInt(month));
  }

  @Post('employees')
  async syncEmployees() {
    return this.syncService.syncEmployees();
  }

  @Post('projects')
  async syncProjects() {
    return this.syncService.syncProjects();
  }

  @Post('all')
  async syncAll(
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const [worklogs, employees, projects] = await Promise.all([
      this.syncService.syncMonthlyWorklogs(parseInt(year), parseInt(month)),
      this.syncService.syncEmployees(),
      this.syncService.syncProjects(),
    ]);

    return {
      worklogs,
      employees,
      projects,
      timestamp: new Date(),
    };
  }
}
