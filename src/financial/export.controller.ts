import { Controller, Get, Post, Query, Res, BadRequestException } from '@nestjs/common';
import { CashflowExportService } from './cashflow-export.service';
import type { Response } from 'express';
import * as path from 'path';

@Controller('api/exports')
export class ExportController {
  constructor(private cashflowService: CashflowExportService) {}

  /**
   * GET /api/exports/cashflow-report
   * Generate and return cashflow report
   */
  @Get('cashflow-report')
  async getCashflowReport(
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    try {
      const y = parseInt(year || new Date().getFullYear().toString());
      const m = parseInt(month || (new Date().getMonth() + 1).toString());

      if (m < 1 || m > 12) {
        throw new BadRequestException('Month must be 1-12');
      }

      const report = await this.cashflowService.generateCashflowReport(y, m);
      return {
        success: true,
        data: report,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  }

  /**
   * POST /api/exports/cashflow-excel
   * Export cashflow to Excel file
   */
  @Post('cashflow-excel')
  async exportCashflowToExcel(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Res() res?: Response,
  ) {
    try {
      const y = parseInt(year || new Date().getFullYear().toString());
      const m = parseInt(month || (new Date().getMonth() + 1).toString());

      if (m < 1 || m > 12) {
        throw new BadRequestException('Month must be 1-12');
      }

      const filepath = await this.cashflowService.exportToExcel(y, m);
      const filename = path.basename(filepath);

      if (res) {
        res.download(filepath, filename, (err) => {
          if (err) {
            console.error('Download error:', err);
          }
        });
      }
    } catch (err) {
      if (res) {
        res.status(500).json({
          success: false,
          error: (err as Error).message,
        });
      }
    }
  }
}
