import { Controller, Get, Query } from '@nestjs/common';
import { ParticipationReportService } from './participation.service';

@Controller('api/reports')
export class ReportsController {
  constructor(private participationService: ParticipationReportService) {}

  /**
   * Generate mock participation report for testing
   * GET /api/reports/participation?year=2026&month=3
   */
  @Get('participation')
  async getParticipationReport(
    @Query('year') year: string = '2026',
    @Query('month') month: string = '3',
  ) {
    try {
      const yearNum = parseInt(year, 10);
      const monthNum = parseInt(month, 10);

      const report = await this.participationService.generateMonthlyReport(yearNum, monthNum);

      // Validate
      const errors = this.participationService.validateReport(report.rows);

      return {
        success: true,
        month: monthNum,
        year: yearNum,
        totalEmployees: report.rows.length,
        alertCount: report.alerts.length,
        errors: errors.length > 0 ? errors : [],
        rows: report.rows,
        alerts: report.alerts,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
