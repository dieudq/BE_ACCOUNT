import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ParticipationReportService } from '../reports/participation.service';
import { ExcelExportService } from '../reports/excel-export.service';
import { TelegramService } from '../telegram/telegram.service';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class MonthlyScheduler {
  constructor(
    private participation: ParticipationReportService,
    private excel: ExcelExportService,
    private telegram: TelegramService,
    private prisma: PrismaService,
  ) {}

  /**
   * Generate and send participation report on the 1st of each month at 08:00 AM (Asia/Saigon)
   * Cron: 0 8 1 * * (1st day, 08:00)
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: 'Asia/Ho_Chi_Minh' })
  async generateMonthlyParticipationReport() {
    const now = new Date();

    // Only run on the 1st of the month
    if (now.getDate() !== 1) {
      return;
    }

    try {
      console.log('🔄 [Scheduler] Starting monthly participation report generation...');

      // Calculate previous month (report for last month)
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const year = lastMonth.getFullYear();
      const month = lastMonth.getMonth() + 1;

      // Generate report
      const report = await this.participation.generateMonthlyReport(year, month);

      // Validate
      const errors = this.participation.validateReport(report.rows);
      if (errors.length > 0) {
        console.warn('⚠️ Validation errors:', errors);
      }

      // Export Excel
      const summaryBuffer = await this.excel.exportParticipationReport(
        report.rows,
        year,
        month,
      );
      const breakdownBuffer = await this.excel.exportProjectBreakdown(report.rows, year, month);

      // Save files temporarily
      const reportsDir = path.join(process.cwd(), 'tmp_reports');
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const summaryPath = path.join(
        reportsDir,
        `participation_${year}_${month}_summary.xlsx`,
      );
      const breakdownPath = path.join(
        reportsDir,
        `participation_${year}_${month}_breakdown.xlsx`,
      );

      fs.writeFileSync(summaryPath, summaryBuffer);
      fs.writeFileSync(breakdownPath, breakdownBuffer);

      // Send to Telegram (to HR channel / admin group)
      const message = `
📊 **Monthly Participation Report** - ${year}/${month}

Total Employees: ${report.rows.length}
Alerts (Self-learning > 30h): ${report.alerts.length}

${
  report.alerts.length > 0
    ? `⚠️ Alerts:\n${report.alerts.map((a) => `• ${a.employeeId}: ${a.hours}h`).join('\n')}`
    : '✅ No alerts'
}

📁 Files attached:
- participation_${year}_${month}_summary.xlsx
- participation_${year}_${month}_breakdown.xlsx
      `;

      // Get HR/Management chat ID (store in .env or DB)
      const hrChatId = process.env.HR_TELEGRAM_CHAT_ID;
      if (hrChatId) {
        // Send to HR channel (would need file sending capability)
        console.log('📤 Sending report to Telegram channel...');
        await this.telegram.getBot().sendMessage(hrChatId, message);
      }

      // Save report metadata to DB (for audit)
      await this.prisma.botLog.create({
        data: {
          action: 'GENERATE_MONTHLY_PARTICIPATION_REPORT',
          status: 'success',
          details: {
            year,
            month,
            employeeCount: report.rows.length,
            alertCount: report.alerts.length,
            summaryFile: summaryPath,
            breakdownFile: breakdownPath,
            generatedAt: new Date().toISOString(),
          },
        },
      });

      console.log('✅ [Scheduler] Monthly participation report completed!');
    } catch (error) {
      console.error('❌ [Scheduler] Error generating monthly report:', error);

      // Log error
      await this.prisma.botLog.create({
        data: {
          action: 'GENERATE_MONTHLY_PARTICIPATION_REPORT',
          status: 'error',
          details: {
            error: error.message,
            stack: error.stack,
          },
        },
      });
    }
  }

  /**
   * Daily check for alerts (optional - for timely warnings)
   * Run daily at 09:00 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'Asia/Ho_Chi_Minh' })
  async checkDailyAlerts() {
    // This can be used to send daily notifications if needed
    // For now, just log
    console.log('🔄 [Scheduler] Daily alert check completed');
  }
}
