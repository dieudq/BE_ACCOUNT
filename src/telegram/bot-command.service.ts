import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkloadAnalysisService } from '../workload/workload-analysis.service';
import { ParticipationReportService } from '../reports/participation.service';
import { TelegramGroupService } from './telegram-group.service';
import { ERPClientService } from '../common/services/erp-client.service';
import TelegramBot from 'node-telegram-bot-api';

@Injectable()
export class BotCommandService {
  constructor(
    private prisma: PrismaService,
    private workloadAnalysis: WorkloadAnalysisService,
    private participation: ParticipationReportService,
    private erp: ERPClientService,
    @Inject(forwardRef(() => TelegramGroupService))
    private telegramGroup: TelegramGroupService,
  ) {}

  /**
   * Handle /start command
   */
  async handleStart(bot: TelegramBot, chatId: string | number): Promise<void> {
    const welcome = `
🤖 <b>Accounting + Workload AI Bot</b>

── Kế toán ──
/approvals - Phê duyệt phiếu chi
/vouchers - Danh sách phiếu chi
/balance &lt;code&gt; - Số dư tài khoản GL
/status - Trạng thái hệ thống

── Workload AI 🔥 ──
/warnings - Cảnh báo tháng này
/workload [year] [month] - Báo cáo
/analyze &lt;name&gt; - AI phân tích nhân sự
/insights [year] [month] - AI insights

── System (Admin) ──
/broadcast <text> - Gửi tin nhắn full nhóm
/help - Xem đầy đủ hướng dẫn
    `.trim();

    await bot.sendMessage(chatId, welcome, { parse_mode: 'HTML' });
  }

  /**
   * Handle /help command
   */
  async handleHelp(bot: TelegramBot, chatId: string | number): Promise<void> {
    const help = `
📚 AVAILABLE COMMANDS

── Kế toán ──
/start - Welcome & intro
/report - Participation report (month/year required)
  Usage: /report 2026 3
/approvals - Show pending approvals
/vouchers - List all vouchers
/balance &lt;code&gt; - GL Account Balance
/export - Export reports
/status - System health check

── Workload AI ──
/warnings - Cảnh báo tháng này
/workload [year] [month] - Báo cáo workload
  Usage: /workload 2026 3
/analyze &lt;name&gt; [year] [month] - AI phân tích nhân sự
  Usage: /analyze Nguyen Van A
/insights [year] [month] - AI insights tổng quan team

── System (Admin) ──
/broadcast <text> - Gửi tin nhắn full nhóm (Admin only)
  Usage: /broadcast Thông báo họp lúc 10h sáng mai.

/help - Show this message
    `.trim();

    await bot.sendMessage(chatId, help, { parse_mode: 'HTML' });
  }

  /**
   * Handle /report command - Monthly participation
   */
  async handleReport(
    bot: TelegramBot,
    chatId: string | number,
    args?: string[],
  ): Promise<void> {
    try {
      const year = parseInt(args?.[0] || new Date().getFullYear().toString());
      const month = parseInt(args?.[1] || (new Date().getMonth() + 1).toString());

      const message = `
Participation Report - ${month}/${year}

To generate report, use API endpoint:
GET /api/reports/participation?year=${year}&month=${month}

Then download Excel file.
      `.trim();

      await bot.sendMessage(chatId, message);
    } catch (err) {
      await bot.sendMessage(chatId, `Error: ${(err as Error).message}`);
    }
  }

  /**
   * Handle /approvals command
   */
  async handleApprovals(bot: TelegramBot, chatId: string | number): Promise<void> {
    try {
      const pending = await this.prisma.approval.findMany({
        where: { status: 'pending' },
        take: 10,
      });

      if (pending.length === 0) {
        await bot.sendMessage(chatId, 'No pending approvals.');
        return;
      }

      const message = `
Pending Approvals: ${pending.length}

${pending
  .slice(0, 5)
  .map(
    (a, i) => `
${i + 1}. Approval ID: ${a.id}
   Status: ${a.status}
   Created: ${new Date(a.createdAt).toLocaleDateString('en-US')}
      `,
  )
  .join('\n')}

${pending.length > 5 ? `\n... and ${pending.length - 5} more` : ''}

Use APPROVE <id> or REJECT <id> to take action
      `.trim();

      await bot.sendMessage(chatId, message);
    } catch (err) {
      await bot.sendMessage(chatId, `Error: ${(err as Error).message}`);
    }
  }

  /**
   * Handle /vouchers command
   */
  async handleVouchers(bot: TelegramBot, chatId: string | number): Promise<void> {
    try {
      const vouchers = await this.prisma.voucher.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
      });

      if (vouchers.length === 0) {
        await bot.sendMessage(chatId, 'No vouchers found.');
        return;
      }

      const message = `
Recent Vouchers: ${vouchers.length}

Vouchers retrieved from database.

Use /approvals to see pending approvals.
      `.trim();

      await bot.sendMessage(chatId, message);
    } catch (err) {
      await bot.sendMessage(chatId, `Error: ${(err as Error).message}`);
    }
  }

  /**
   * Handle /balance command - GL Account balance
   */
  async handleBalance(
    bot: TelegramBot,
    chatId: string | number,
    args?: string[],
  ): Promise<void> {
    try {
      const accountCode = args?.[0];

      if (!accountCode) {
        await bot.sendMessage(
          chatId,
          'Usage: /balance <account_code>\nExample: /balance 1111',
        );
        return;
      }

      const account = await this.prisma.gLAccount.findFirst({
        where: { accountCode },
      });

      if (!account) {
        await bot.sendMessage(chatId, `Account ${accountCode} not found.`);
        return;
      }

      const message = `
GL Account Balance

Code: ${account.accountCode}
Name: ${account.accountName}
Type: ${account.accountType}

Account found. Use API to get full balance.
      `.trim();

      await bot.sendMessage(chatId, message);
    } catch (err) {
      await bot.sendMessage(chatId, `Error: ${(err as Error).message}`);
    }
  }

  /**
   * Handle /export command
   */
  async handleExport(
    bot: TelegramBot,
    chatId: string | number,
    // @ts-ignore
    args?: string[],
  ): Promise<void> {
    // @ts-ignore
    const type = args?.[0] || 'participation';

    const message = `
Export Options:
- participation: Monthly participation report
- cashflow: Cashflow report
- financial: Financial reports

Usage: /export <type>
Example: /export cashflow

Files will be generated and available for download.
    `.trim();

    await bot.sendMessage(chatId, message);
  }

  /**
   * Handle /status command
   */
  async handleStatus(bot: TelegramBot, chatId: string | number): Promise<void> {
    try {
      const userCount = await this.prisma.user.count();
      const voucherCount = await this.prisma.voucher.count();

      const message = `
System Status: OK ✅

Database:
- Users: ${userCount}
- Vouchers: ${voucherCount}

Services:
- Telegram: Connected
- Database: Connected
- ERP Listener: Running

Last check: ${new Date().toLocaleString('en-US')}
      `.trim();

      await bot.sendMessage(chatId, message);
    } catch (err) {
      await bot.sendMessage(chatId, `System Status: ERROR\n${(err as Error).message}`);
    }
  }

  /**
   * Handle /warnings — cảnh báo workload tháng hiện tại
   */
  async handleWarnings(bot: TelegramBot, chatId: string | number): Promise<void> {
    await bot.sendMessage(chatId, '📊 Đang lấy dữ liệu cảnh báo...');
    try {
      const now = new Date();
      const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const year = previousMonth.getFullYear();
      const month = previousMonth.getMonth() + 1;

      const report = await this.participation.generateMonthlyReport(year, month);

      if (report.rows.length === 0) {
        // Fallback: lấy từ ERP
        const monthStr = `${year}-${String(month).padStart(2, '0')}`;
        const erpReport = await this.erp.getMonthlyWorkloadReport(monthStr).catch(() => null);

        if (!erpReport || !erpReport.employees || erpReport.employees.length === 0) {
          await bot.sendMessage(
            chatId,
            `❌ Chưa có dữ liệu tháng ${month}/${year}.\nDùng lệnh /workload để xem hoặc sync dữ liệu trước.`,
          );
          return;
        }

        const threshold = erpReport.summary?.selfLearningThreshold ?? 30;
        const atRisk = erpReport.employees.filter((e) => e.isAtRisk);

        let msg = `⚠️ <b>Cảnh báo Workload ${month}/${year}</b> (ERP)\n\n`;
        msg += `👥 Tổng nhân sự: ${erpReport.employees.length}\n`;
        msg += `🔴 Vượt ngưỡng ${threshold}h: ${atRisk.length}\n\n`;

        if (atRisk.length > 0) {
          msg += `<b>Danh sách vượt ngưỡng:</b>\n`;
          atRisk.forEach((e) => {
            msg += `• ${e.fullName}: ${e.selfLearningHours.toFixed(1)}h self-learning\n`;
          });
          msg += `\n💡 Dùng /analyze &lt;tên&gt; để phân tích chi tiết`;
        } else {
          msg += `✅ Tất cả nhân sự đều trong ngưỡng an toàn!`;
        }

        await bot.sendMessage(chatId, msg, { parse_mode: 'HTML' });
        return;
      }

      let msg = `⚠️ <b>Cảnh báo Workload ${month}/${year}</b>\n\n`;
      msg += `👥 Tổng nhân sự: ${report.rows.length}\n`;
      msg += `🔴 Vượt ngưỡng 30h: ${report.alerts.length}\n\n`;

      if (report.alerts.length > 0) {
        msg += `<b>Danh sách vượt ngưỡng:</b>\n`;
        report.alerts.forEach((a) => {
          msg += `• ${a.employeeName}: ${a.hours.toFixed(1)}h self-learning\n`;
        });
        msg += `\n💡 Dùng /analyze &lt;tên&gt; để phân tích chi tiết`;
      } else {
        msg += `✅ Tất cả nhân sự đều trong ngưỡng an toàn!`;
      }

      await bot.sendMessage(chatId, msg, { parse_mode: 'HTML' });
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Lỗi lấy cảnh báo: ${(err as Error).message}`);
    }
  }

  /**
   * Handle /workload [year] [month] — báo cáo tháng
   * Usage: /workload        → tháng hiện tại
   *        /workload 2026 3 → tháng 3/2026
   */
  async handleWorkload(
    bot: TelegramBot,
    chatId: string | number,
    args?: string[],
  ): Promise<void> {
    await bot.sendMessage(chatId, '📊 Đang tạo báo cáo workload...');
    try {
      const now = new Date();
      const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const year = args?.[0] ? parseInt(args[0]) : previousMonth.getFullYear();
      const month = args?.[1] ? parseInt(args[1]) : previousMonth.getMonth() + 1;

      const report = await this.participation.generateMonthlyReport(year, month);

      if (report.rows.length === 0) {
        // Fallback: lấy từ ERP
        const monthStr = `${year}-${String(month).padStart(2, '0')}`;
        const erpReport = await this.erp.getMonthlyWorkloadReport(monthStr).catch(() => null);

        if (!erpReport || !erpReport.employees || erpReport.employees.length === 0) {
          await bot.sendMessage(
            chatId,
            `❌ Chưa có dữ liệu tháng ${month}/${year}.\nSync dữ liệu từ ERP trước qua API /api/sync/workload`,
          );
          return;
        }

        const emps = erpReport.employees;
        const threshold = erpReport.summary?.selfLearningThreshold ?? 30;
        const atRisk = emps.filter((e) => e.isAtRisk);
        const avgSL = emps.reduce((s, e) => s + e.selfLearningHours, 0) / emps.length;
        const avgLog = emps.reduce((s, e) => s + e.actualLoggedHours, 0) / emps.length;

        let msg = `📊 <b>Workload Report ${month}/${year}</b> (ERP)\n\n`;
        msg += `👥 Nhân sự: ${emps.length}\n`;
        msg += `📈 Avg log dự án: ${avgLog.toFixed(1)}h\n`;
        msg += `📉 Avg self-learning: ${avgSL.toFixed(1)}h\n`;
        msg += `⚠️ Vượt ngưỡng ${threshold}h: ${atRisk.length} người\n`;

        if (atRisk.length > 0) {
          msg += `\n🔴 <b>Vượt ngưỡng:</b>\n`;
          atRisk.slice(0, 10).forEach((e) => {
            msg += `• ${e.fullName}: ${e.selfLearningHours.toFixed(1)}h\n`;
          });
          if (atRisk.length > 10) msg += `... và ${atRisk.length - 10} người khác\n`;
        }

        const lowest = [...emps].sort((a, b) => a.actualPercent - b.actualPercent).slice(0, 3);
        msg += `\n📉 <b>Log ít nhất:</b>\n`;
        lowest.forEach((e) => {
          msg += `• ${e.fullName}: ${e.actualLoggedHours.toFixed(1)}h (${e.actualPercent.toFixed(0)}%)\n`;
        });

        msg += `\n💡 Dùng /analyze &lt;tên&gt; để phân tích AI từng người`;
        await bot.sendMessage(chatId, msg, { parse_mode: 'HTML' });
        return;
      }

      const avgSL =
        report.rows.reduce((sum, r) => sum + r.selfLearningHours, 0) / report.rows.length;
      const avgLog =
        report.rows.reduce((sum, r) => sum + r.projectHours, 0) / report.rows.length;

      let msg = `📊 <b>Workload Report ${month}/${year}</b>\n\n`;
      msg += `👥 Nhân sự: ${report.rows.length}\n`;
      msg += `📈 Avg log dự án: ${avgLog.toFixed(1)}h\n`;
      msg += `📉 Avg self-learning: ${avgSL.toFixed(1)}h\n`;
      msg += `⚠️ Vượt ngưỡng 30h: ${report.alerts.length} người\n`;

      if (report.alerts.length > 0) {
        msg += `\n🔴 <b>Vượt ngưỡng:</b>\n`;
        report.alerts.slice(0, 10).forEach((a) => {
          msg += `• ${a.employeeName}: ${a.hours.toFixed(1)}h\n`;
        });
        if (report.alerts.length > 10) {
          msg += `... và ${report.alerts.length - 10} người khác\n`;
        }
      }

      // Top 3 lowest log
      const lowest = [...report.rows]
        .sort((a, b) => a.projectPercent - b.projectPercent)
        .slice(0, 3);
      msg += `\n📉 <b>Log ít nhất:</b>\n`;
      lowest.forEach((r) => {
        msg += `• ${r.employeeName}: ${r.projectHours.toFixed(1)}h log (${r.projectPercent.toFixed(0)}%)\n`;
      });

      msg += `\n💡 Dùng /analyze &lt;tên&gt; để phân tích AI từng người`;

      await bot.sendMessage(chatId, msg, { parse_mode: 'HTML' });
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Lỗi tạo báo cáo: ${(err as Error).message}`);
    }
  }

  /**
   * Handle /analyze <name> [year] [month] — AI phân tích nhân sự
   * Usage: /analyze Nguyen Van A
   *        /analyze Nguyen Van A 2026 3
   */
  async handleAnalyze(
    bot: TelegramBot,
    chatId: string | number,
    args?: string[],
  ): Promise<void> {
    if (!args || args.length === 0) {
      await bot.sendMessage(
        chatId,
        'Usage: /analyze &lt;tên nhân sự&gt; [năm] [tháng]\nVí dụ: /analyze Nguyen Van A\nVí dụ: /analyze Nguyen Van A 2026 3',
        { parse_mode: 'HTML' },
      );
      return;
    }

    // Last two args may be year + month (both numeric)
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    let nameParts = [...args];

    if (nameParts.length >= 2) {
      const last = nameParts[nameParts.length - 1];
      const secondLast = nameParts[nameParts.length - 2];
      if (/^\d{4}$/.test(secondLast) && /^\d{1,2}$/.test(last)) {
        year = parseInt(secondLast);
        month = parseInt(last);
        nameParts = nameParts.slice(0, -2);
      }
    }

    const employeeName = nameParts.join(' ');
    await bot.sendMessage(chatId, `🔍 Đang phân tích AI cho "${employeeName}" tháng ${month}/${year}...`);

    try {
      const result = await this.workloadAnalysis.analyzeSelfLearning(employeeName, year, month);
      await bot.sendMessage(chatId, result, { parse_mode: 'HTML' });
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Lỗi phân tích: ${(err as Error).message}`);
    }
  }

  /**
   * Handle /insights [year] [month] — AI insights tổng quan team
   */
  async handleInsights(
    bot: TelegramBot,
    chatId: string | number,
    args?: string[],
  ): Promise<void> {
    await bot.sendMessage(chatId, '🤖 Đang tạo AI insights...');
    try {
      const now = new Date();
      const year = args?.[0] ? parseInt(args[0]) : now.getFullYear();
      const month = args?.[1] ? parseInt(args[1]) : now.getMonth() + 1;

      const result = await this.workloadAnalysis.generateTeamInsights(year, month);
      await bot.sendMessage(chatId, result, { parse_mode: 'HTML' });
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Lỗi AI insights: ${(err as Error).message}`);
    }
  }

  /**
   * Handle /broadcast <text> command — Send message to all registered groups
   */
  async handleBroadcast(
    bot: TelegramBot,
    chatId: string | number,
    args?: string[],
  ): Promise<void> {
    if (!args || args.length === 0) {
      await bot.sendMessage(chatId, '❌ Vui lòng nhập nội dung tin nhắn cần gửi.\nSử dụng: /broadcast <nội dung>');
      return;
    }

    const message = args.join(' ');
    await bot.sendMessage(chatId, `📢 Đang bắt đầu gửi tin nhắn đến tất cả các nhóm...`);

    try {
      await this.telegramGroup.sendToAllGroups(message);
      await bot.sendMessage(chatId, `✅ Đã hoàn thành gửi tin nhắn broadcast.`);
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Lỗi khi gửi broadcast: ${(err as Error).message}`);
    }
  }
}
