import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ParticipationReportService } from '../reports/participation.service';
import { ExcelExportService } from '../reports/excel-export.service';
import { TelegramService } from '../telegram/telegram.service';
import { DataSyncService } from '../sync/data-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class MonthlyScheduler {
  private readonly logger = new Logger(MonthlyScheduler.name);

  constructor(
    private readonly participation: ParticipationReportService,
    private readonly excel: ExcelExportService,
    private readonly telegram: TelegramService,
    private readonly sync: DataSyncService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Monthly report: ngày 1 hàng tháng lúc 08:00 VN
   * 1. Sync workload data từ ERP cho tháng trước
   * 2. Generate + export Excel
   * 3. Gửi Telegram
   */
  @Cron(CronExpression.EVERY_HOUR)
  async generateMonthlyParticipationReport() {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = lastMonth.getFullYear();
    const month = lastMonth.getMonth() + 1;

    this.logger.log(`🔄 [Scheduler] Monthly report start: ${year}/${month}`);

    try {
      // Step 1: Sync from ERP
      const syncResult = await this.sync.syncMonthlyWorkloadReport(year, month);
      this.logger.log(`📡 Sync result: ${syncResult.message}`);

      if (syncResult.synced === 0) {
        this.logger.warn('⚠️ No data synced — skipping report generation');
        return;
      }

      // Step 2: Generate report
      const report = await this.participation.generateMonthlyReport(
        year,
        month,
      );
      const errors = this.participation.validateReport(report.rows);

      if (errors.length > 0) {
        this.logger.warn(`⚠️ Validation errors: ${JSON.stringify(errors)}`);
      }

      // Step 3: Export Excel
      const buffer = await this.excel.exportParticipationReport(
        report.rows,
        year,
        month,
      );
      const reportsDir = path.join(process.cwd(), 'tmp_reports');
      if (!fs.existsSync(reportsDir))
        fs.mkdirSync(reportsDir, { recursive: true });

      const excelPath = path.join(
        reportsDir,
        `workload-${year}-${String(month).padStart(2, '0')}.xlsx`,
      );
      fs.writeFileSync(excelPath, buffer);

      // Step 4: Send Telegram
      const alertLines = report.alerts
        .map((a) => `• ${a.employeeName}: ${a.hours.toFixed(1)}h`)
        .join('\n');

      const message =
        `📊 <b>Báo cáo Workload ${month}/${year}</b>\n\n` +
        `👥 Tổng nhân sự: ${report.rows.length}\n` +
        `⚠️ Vượt ngưỡng 30h: ${report.alerts.length}\n` +
        (report.alerts.length > 0
          ? `\n🔴 <b>Danh sách:</b>\n${alertLines}\n`
          : '') +
        `\n📁 File: workload-${year}-${String(month).padStart(2, '0')}.xlsx`;

      const hrChatId = process.env.HR_TELEGRAM_CHAT_ID;
      if (hrChatId) {
        await this.telegram
          .getBot()
          .sendMessage(hrChatId, message, { parse_mode: 'HTML' });
        // Also send the Excel file
        await this.telegram
          .getBot()
          .sendDocument(hrChatId, excelPath, {
            caption: `Workload report ${month}/${year}`,
          })
          .catch((err) =>
            this.logger.warn(`⚠️ Failed to send Excel: ${err.message}`),
          );
      }

      await this.prisma.botLog.create({
        data: {
          action: 'MONTHLY_WORKLOAD_REPORT',
          status: 'success',
          details: {
            year,
            month,
            employeeCount: report.rows.length,
            alertCount: report.alerts.length,
            syncedEmployees: syncResult.synced,
            excelPath,
          },
        },
      });

      this.logger.log(
        `✅ [Scheduler] Monthly report done: ${report.rows.length} employees, ${report.alerts.length} alerts`,
      );
    } catch (error: any) {
      this.logger.error(
        `❌ [Scheduler] Monthly report failed: ${error.message}`,
        error.stack,
      );
      await this.prisma.botLog.create({
        data: {
          action: 'MONTHLY_WORKLOAD_REPORT',
          status: 'error',
          details: { error: error.message },
        },
      });
    }
  }

  /**
   * Proactive mid-month alert: ngày 20 hàng tháng lúc 09:00 VN
   * Sync và kiểm tra ai đang có nguy cơ vượt ngưỡng 30h trước cuối tháng.
   */
  @Cron('0 9 20 * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async checkMidMonthRisks() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    this.logger.log(`🔍 [Scheduler] Mid-month risk check: ${year}/${month}`);

    try {
      // Sync current month first
      await this.sync.syncMonthlyWorkloadReport(year, month);

      const risks = await this.participation.getAtRiskEmployees(
        year,
        month,
        30,
      );
      const exceeded = risks.filter((r) => r.selfLearningHours > 30);
      const approaching = risks.filter((r) => r.selfLearningHours <= 30);

      if (risks.length === 0) {
        this.logger.log('✅ No at-risk employees this month');
        return;
      }

      const lines: string[] = [];
      if (exceeded.length > 0) {
        lines.push('🔴 <b>Đã vượt ngưỡng:</b>');
        exceeded.forEach((r) =>
          lines.push(`• ${r.employeeName}: ${r.selfLearningHours.toFixed(1)}h`),
        );
      }
      if (approaching.length > 0) {
        lines.push('\n🟡 <b>Đang tiến gần ngưỡng:</b>');
        approaching.forEach((r) =>
          lines.push(
            `• ${r.employeeName}: ${r.selfLearningHours.toFixed(1)}h / 30h`,
          ),
        );
      }

      const message =
        `⚠️ <b>Cảnh báo Workload giữa tháng ${month}/${year}</b>\n\n` +
        lines.join('\n') +
        '\n\n📌 Còn ~10 ngày để các nhân sự log thêm giờ.';

      const hrChatId = process.env.HR_TELEGRAM_CHAT_ID;
      if (hrChatId) {
        await this.telegram
          .getBot()
          .sendMessage(hrChatId, message, { parse_mode: 'HTML' });
      }

      this.logger.log(
        `⚠️ [Scheduler] Mid-month: ${exceeded.length} exceeded, ${approaching.length} approaching`,
      );
    } catch (error: any) {
      this.logger.error(
        `❌ [Scheduler] Mid-month check failed: ${error.message}`,
      );
    }
  }
}
