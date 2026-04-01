import { Controller, Post, Get, Query } from '@nestjs/common';
import { DataSyncService } from './data-sync.service';

@Controller('api/sync')
export class SyncController {
  constructor(private syncService: DataSyncService) {}

  /**
   * POST /api/sync/workload?year=2026&month=3&deptCode=KT
   * Sync monthly workload report from ERP into local DB.
   */
  @Post('workload')
  async syncWorkload(
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('deptCode') deptCode?: string,
  ) {
    const now = new Date();
    const y = year ? parseInt(year, 10) : now.getFullYear();
    const m = month ? parseInt(month, 10) : now.getMonth() + 1;
    return this.syncService.syncMonthlyWorkloadReport(y, m, deptCode);
  }

  @Post('employees')
  async syncEmployees() {
    return this.syncService.syncEmployees();
  }

  @Post('all')
  async syncAll(
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('deptCode') deptCode?: string,
  ) {
    const now = new Date();
    const y = year ? parseInt(year, 10) : now.getFullYear();
    const m = month ? parseInt(month, 10) : now.getMonth() + 1;

    const [workload, employees] = await Promise.all([
      this.syncService.syncMonthlyWorkloadReport(y, m, deptCode),
      this.syncService.syncEmployees(),
    ]);

    return { workload, employees, timestamp: new Date() };
  }
}
