import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ParticipationReportService } from '../reports/participation.service';
import { ExcelExportService } from '../reports/excel-export.service';
import { TelegramService } from '../telegram/telegram.service';
import { DataSyncService } from '../sync/data-sync.service';
import { WorkloadAnalysisService } from '../workload/workload-analysis.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
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
    private readonly workloadAnalysis: WorkloadAnalysisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Monthly report: Chạy định kỳ để tổng hợp dữ liệu
   */
  @Cron('0 8 1 * *') // Chạy vào 8h sáng ngày 1 hàng tháng
  async generateMonthlyParticipationReport() {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = lastMonth.getFullYear();
    const month = lastMonth.getMonth() + 1;

    this.logger.log(
      `🔄 [Scheduler] Bắt đầu tổng hợp báo cáo tháng: ${month}/${year}`,
    );

    try {
      // Step 1: Đồng bộ dữ liệu từ ERP
      const syncResult = await this.sync.syncMonthlyWorkloadReport(year, month);

      if (syncResult.synced === 0) {
        this.logger.warn('⚠️ Không có dữ liệu để đồng bộ - Bỏ qua báo cáo');
        return;
      }

      // Step 2: Tạo dữ liệu báo cáo
      const report = await this.participation.generateMonthlyReport(
        year,
        month,
      );

      // 🔥 BƯỚC QUAN TRỌNG: Lưu vào DB để Agent có thể trả lời câu hỏi
      await this.saveReportToDatabase(year, month, report.rows, 'MONTHLY');

      // Step 3: Xuất file Excel
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

      // Step 4: Gửi Telegram (Đã fix lỗi thẻ HTML lạ)
      await this.sendTelegramReport(year, month, report, excelPath);

      // Ghi Log thành công
      await this.prisma.botLog.create({
        data: {
          action: 'MONTHLY_WORKLOAD_REPORT',
          status: 'success',
          details: { year, month, alertCount: report.alerts.length, excelPath },
        },
      });

      this.logger.log(
        `✅ [Scheduler] Hoàn thành báo cáo tháng ${month}/${year}`,
      );
    } catch (error: any) {
      this.logger.error(`❌ [Scheduler] Lỗi báo cáo tháng: ${error.message}`);
    }
  }

  /**
   * Hàm lưu dữ liệu vào DB để Agent truy vấn
   */
  private async saveReportToDatabase(
    year: number,
    month: number,
    rows: any[],
    type: string,
  ) {
    this.logger.log(`💾 Đang lưu dữ liệu báo cáo vào Database cho Agent...`);

    const isMissingTableError = (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2021';

    // Xóa dữ liệu cũ của tháng đó (nếu có) để tránh trùng lặp khi chạy lại
    try {
      await this.prisma.workloadReport.deleteMany({
        where: { year, month, reportType: type },
      });
    } catch (error) {
      if (isMissingTableError(error)) {
        this.logger.warn(
          '⚠️ Bảng WorkloadReport chưa tồn tại. Bỏ qua lưu DB, vẫn tiếp tục gửi báo cáo.',
        );
        return;
      }
      throw error;
    }

    // Lưu dữ liệu mới
    const data = rows.map((row) => ({
      year,
      month,
      employeeName: row.employeeName,
      hours: row.selfLearningHours || 0,
      isAlert: (row.selfLearningHours || 0) > 30,
      reportType: type,
    }));

    try {
      await this.prisma.workloadReport.createMany({ data });
    } catch (error) {
      if (isMissingTableError(error)) {
        this.logger.warn(
          '⚠️ Bảng WorkloadReport chưa tồn tại. Không thể cập nhật dữ liệu cho Agent.',
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Hàm gửi Telegram hỗ trợ định dạng HTML an toàn
   */
  private async sendTelegramReport(
    year: number,
    month: number,
    report: any,
    excelPath: string,
  ) {
    const alertLines = report.alerts
      .map(
        (a) =>
          `• <code>${a.employeeName}</code>: <b>${a.hours.toFixed(1)}h</b>`,
      )
      .join('\n');

    const message =
      `📊 <b>BÁO CÁO WORKLOAD ${month}/${year}</b>\n\n` +
      `👥 Tổng nhân sự: <code>${report.rows.length}</code>\n` +
      `⚠️ Vượt ngưỡng 30h: <b>${report.alerts.length}</b>\n` +
      (report.alerts.length > 0
        ? `\n🔴 <b>Danh sách chi tiết:</b>\n${alertLines}\n`
        : '') +
      `\n📁 <i>File báo cáo đã được đính kèm bên dưới.</i>`;

    const hrChatId = process.env.HR_TELEGRAM_CHAT_ID;
    if (hrChatId) {
      const bot = this.telegram.getBot();
      await bot.sendMessage(hrChatId, message, { parse_mode: 'HTML' });
      await bot.sendDocument(hrChatId, excelPath).catch(() => {});
    }
  }

  /**
   * Cảnh báo + AI insights giữa tháng (Ngày 20 hàng tháng, 9h sáng)
   * Playbook: sync → detect at-risk → AI team insights → notify HR
   */
  @Cron('0 9 20 * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async checkMidMonthRisks() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    this.logger.log(`[Scheduler] Bắt đầu kiểm tra giữa tháng ${month}/${year}`);

    try {
      // Step 1: Sync dữ liệu mới nhất
      await this.sync.syncMonthlyWorkloadReport(year, month);

      // Step 2: Lấy danh sách at-risk
      const risks = await this.participation.getAtRiskEmployees(year, month, 30);

      // Lưu vào DB để Agent có thể trả lời câu hỏi về giữa tháng
      await this.saveReportToDatabase(year, month, risks, 'MID_MONTH');

      if (risks.length === 0) {
        this.logger.log(`[Scheduler] Giữa tháng ${month}/${year}: Không có nhân sự nào at-risk`);
        return;
      }

      const exceeded = risks.filter((r) => r.selfLearningHours > 30);
      const approaching = risks.filter((r) => r.selfLearningHours <= 30);

      // Xây dựng danh sách cảnh báo
      let alertBlock = '';
      if (exceeded.length > 0) {
        alertBlock += `🔴 <b>Đã vượt ngưỡng (${exceeded.length} người):</b>\n`;
        exceeded.forEach((r) => {
          alertBlock += `• ${r.employeeName}: ${r.selfLearningHours.toFixed(1)}h\n`;
        });
      }
      if (approaching.length > 0) {
        alertBlock += `\n🟡 <b>Tiệm cận ngưỡng (${approaching.length} người):</b>\n`;
        approaching.slice(0, 5).forEach((r) => {
          alertBlock += `• ${r.employeeName}: ${r.selfLearningHours.toFixed(1)}h\n`;
        });
        if (approaching.length > 5) alertBlock += `  ...và ${approaching.length - 5} người khác\n`;
      }

      // Step 3: AI team insights
      let aiInsights = '';
      try {
        aiInsights = await this.workloadAnalysis.generateTeamInsights(year, month);
        // Lấy phần sau header "AI Insights — Team X/Y\n\n"
        const insightBody = aiInsights.replace(/^AI Insights — Team \d+\/\d+\n\n/, '').trim();
        aiInsights = `\n\n💡 <b>AI Nhận xét:</b>\n${insightBody}`;
      } catch {
        // Không có insights thì vẫn gửi cảnh báo
      }

      const message =
        `⚠️ <b>CẢNH BÁO GIỮA THÁNG ${month}/${year}</b>\n\n` +
        `Tổng at-risk: <b>${risks.length}</b> nhân sự\n\n` +
        alertBlock +
        aiInsights +
        `\n\n📌 <i>Nhắn "phân tích [tên]" trên Telegram để xem nguyên nhân chi tiết.</i>`;

      const hrChatId = process.env.HR_TELEGRAM_CHAT_ID;
      if (hrChatId) {
        const bot = this.telegram.getBot();
        // Chia nhỏ nếu message dài
        if (message.length > 4096) {
          await bot.sendMessage(hrChatId,
            `⚠️ <b>CẢNH BÁO GIỮA THÁNG ${month}/${year}</b>\n\nTổng at-risk: <b>${risks.length}</b>\n\n${alertBlock}`,
            { parse_mode: 'HTML' });
          if (aiInsights) {
            await bot.sendMessage(hrChatId, `💡 <b>AI Nhận xét tháng ${month}/${year}:</b>\n\n${aiInsights.replace(/\n\n💡 <b>AI Nhận xét:<\/b>\n/, '')}`, { parse_mode: 'HTML' });
          }
        } else {
          await bot.sendMessage(hrChatId, message, { parse_mode: 'HTML' });
        }
      }

      this.logger.log(`[Scheduler] Đã gửi cảnh báo giữa tháng ${month}/${year}: ${risks.length} at-risk`);
    } catch (error: any) {
      this.logger.error(`[Scheduler] Mid-month check failed: ${error.message}`);
    }
  }
}
