import { Controller, Get, Post, Query, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ParticipationReportService } from './participation.service';
import { ExcelExportService } from './excel-export.service';

@Controller('api/reports')
export class ReportsController {
  constructor(
    private readonly participationService: ParticipationReportService,
    private readonly excelService: ExcelExportService,
  ) {}

  /**
   * GET /api/reports/participation?year=2026&month=3
   * Returns JSON participation report (from synced local DB).
   */
  @Get('participation')
  async getParticipationReport(
    @Query('year') year = String(new Date().getFullYear()),
    @Query('month') month = String(new Date().getMonth() + 1),
    @Query('threshold') threshold = '30',
  ) {
    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10);
    const thresholdNum = parseInt(threshold, 10);

    const report = await this.participationService.generateMonthlyReport(
      yearNum,
      monthNum,
      thresholdNum,
    );
    const errors = this.participationService.validateReport(report.rows);

    return {
      success: true,
      month: monthNum,
      year: yearNum,
      totalEmployees: report.rows.length,
      alertCount: report.alerts.length,
      validationErrors: errors.length > 0 ? errors : [],
      rows: report.rows,
      alerts: report.alerts,
    };
  }

  /**
   * GET /api/reports/participation/download?year=2026&month=3
   * Download XLSX participation report.
   */
  @Get('participation/download')
  async downloadParticipationReport(
    @Query('year') year = String(new Date().getFullYear()),
    @Query('month') month = String(new Date().getMonth() + 1),
    @Res() res: Response,
  ) {
    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10);

    const report = await this.participationService.generateMonthlyReport(yearNum, monthNum);
    const buffer = await this.excelService.exportParticipationReport(
      report.rows,
      yearNum,
      monthNum,
    );

    const filename = `workload-report-${yearNum}-${String(monthNum).padStart(2, '0')}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length.toString(),
    });

    res.status(HttpStatus.OK).send(buffer);
  }

  /**
   * GET /api/reports/at-risk?year=2026&month=3&threshold=30
   * Returns employees approaching self-learning threshold.
   */
  @Get('at-risk')
  async getAtRiskEmployees(
    @Query('year') year = String(new Date().getFullYear()),
    @Query('month') month = String(new Date().getMonth() + 1),
    @Query('threshold') threshold = '30',
  ) {
    const risks = await this.participationService.getAtRiskEmployees(
      parseInt(year, 10),
      parseInt(month, 10),
      parseInt(threshold, 10),
    );

    return { success: true, count: risks.length, risks };
  }
}
