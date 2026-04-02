import { Injectable, Logger } from '@nestjs/common';
import { LLMGatewayService } from '../llm-gateway/llm-gateway.service';
import { ParticipationReportService, ParticipationRow } from '../reports/participation.service';

@Injectable()
export class WorkloadAnalysisService {
  private readonly logger = new Logger(WorkloadAnalysisService.name);

  constructor(
    private readonly llm: LLMGatewayService,
    private readonly participation: ParticipationReportService,
  ) {}

  /**
   * Phân tích workload AI cho một nhân sự — hỗ trợ context hội thoại
   * ReAct flow: thu thập data → build context → LLM reasoning → kết quả hành động
   */
  async analyzeSelfLearning(
    employeeName: string,
    year: number,
    month: number,
    conversationContext?: string[],
  ): Promise<string> {
    const report = await this.participation.generateMonthlyReport(year, month);

    if (report.rows.length === 0) {
      return `Chưa có dữ liệu tháng ${month}/${year}. Hãy đồng bộ dữ liệu trước.`;
    }

    const emp = report.rows.find((r) =>
      r.employeeName.toLowerCase().includes(employeeName.toLowerCase()),
    );

    if (!emp) {
      const names = report.rows.map((r) => r.employeeName).join(', ');
      return (
        `Không tìm thấy "${employeeName}" trong tháng ${month}/${year}.\n\n` +
        `Nhân sự có dữ liệu: ${names}`
      );
    }

    // Lấy thêm data tháng trước để so sánh trend
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevReport = await this.participation.generateMonthlyReport(prevYear, prevMonth);
    const prevEmp = prevReport.rows.find((r) =>
      r.employeeName.toLowerCase().includes(employeeName.toLowerCase()),
    );

    const projectBreakdown =
      emp.projects.length > 0
        ? emp.projects
            .map(
              (p) =>
                `  - ${p.projectName || p.projectCode}: ${p.hours.toFixed(1)}h (${p.percent.toFixed(1)}%)`,
            )
            .join('\n')
        : '  - Không có dữ liệu dự án (chưa log Jira hoặc chưa phân công)';

    const trendSection = prevEmp
      ? `So sánh với tháng trước (${prevMonth}/${prevYear}):
- Giờ log dự án: ${prevEmp.projectHours.toFixed(1)}h → ${emp.projectHours.toFixed(1)}h (${emp.projectHours >= prevEmp.projectHours ? '+' : ''}${(emp.projectHours - prevEmp.projectHours).toFixed(1)}h)
- Self-learning: ${prevEmp.selfLearningHours.toFixed(1)}h → ${emp.selfLearningHours.toFixed(1)}h`
      : 'Không có dữ liệu tháng trước để so sánh.';

    const contextSection =
      conversationContext && conversationContext.length > 0
        ? `\nContext hội thoại gần nhất:\n${conversationContext.slice(-2).join('\n')}\n`
        : '';

    const severityLabel =
      emp.selfLearningHours > 50
        ? 'RẤT CAO (>50h)'
        : emp.selfLearningHours > 30
          ? 'CAO (vượt ngưỡng 30h)'
          : emp.selfLearningHours > 20
            ? 'TRUNG BÌNH (tiệm cận ngưỡng)'
            : 'BÌNH THƯỜNG';

    const trendArrow = prevEmp
      ? emp.selfLearningHours > prevEmp.selfLearningHours ? '📈' : '📉'
      : '';

    const prompt = `Dữ liệu nhân sự:
${contextSection}Tên: ${emp.employeeName} | ${month}/${year}
Log dự án: ${emp.projectHours.toFixed(1)}h (${emp.projectPercent.toFixed(1)}%) | Self-learning: ${emp.selfLearningHours.toFixed(1)}h — ${severityLabel}
${trendSection}
Dự án: ${projectBreakdown}

Viết phân tích NGẮN GỌN theo đúng format sau (dùng emoji, tối đa 80 từ):

🔴/🟡/🟢 Tình trạng: [1 câu tóm tắt mức độ]
${trendArrow} Xu hướng: [so tháng trước, 1 câu]
💡 Nguyên nhân: [1-2 bullet ngắn]
✅ Hành động: [1-2 bullet cụ thể cho HR/Manager]`;

    const systemPrompt = `Chuyên gia HR workload. Trả lời tiếng Việt, súc tích, dùng emoji, đúng format được yêu cầu. Không thêm mở đầu/kết luận dài dòng.`;

    try {
      const analysis = await this.llm.generateResponse(prompt, systemPrompt);
      return `🔍 ${emp.employeeName} — Tháng ${month}/${year}\n\n${analysis}`;
    } catch (error: any) {
      this.logger.warn(`LLM analysis failed, using rule-based fallback: ${error.message}`);
      return this.ruleBasedAnalysis(emp, prevEmp, month, year, prevMonth, prevYear);
    }
  }

  /**
   * AI insights tổng quan team — hỗ trợ context hội thoại
   */
  async generateTeamInsights(
    year: number,
    month: number,
    conversationContext?: string[],
  ): Promise<string> {
    const report = await this.participation.generateMonthlyReport(year, month);

    if (report.rows.length === 0) {
      return `Chưa có dữ liệu tháng ${month}/${year}. Hãy đồng bộ dữ liệu trước.`;
    }

    // Data tháng trước để so sánh trend
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevReport = await this.participation.generateMonthlyReport(prevYear, prevMonth);

    const avgSL = report.rows.reduce((sum, r) => sum + r.selfLearningHours, 0) / report.rows.length;
    const avgLog = report.rows.reduce((sum, r) => sum + r.projectHours, 0) / report.rows.length;
    const prevAvgSL =
      prevReport.rows.length > 0
        ? prevReport.rows.reduce((sum, r) => sum + r.selfLearningHours, 0) / prevReport.rows.length
        : null;

    // Phân loại nhân sự theo mức độ rủi ro
    const critical = report.rows.filter((r) => r.selfLearningHours > 50);
    const exceeded = report.rows.filter((r) => r.selfLearningHours > 30 && r.selfLearningHours <= 50);
    const approaching = report.rows.filter(
      (r) => r.selfLearningHours > 21 && r.selfLearningHours <= 30,
    );
    const healthy = report.rows.filter((r) => r.selfLearningHours <= 21);

    const alertDetails =
      report.alerts.length > 0
        ? report.alerts
            .map(
              (a) =>
                `  - ${a.employeeName}: ${a.hours.toFixed(1)}h self-learning` +
                (a.hours > 50 ? ' [RẤT CAO]' : ''),
            )
            .join('\n')
        : '  (Không có)';

    const trendNote =
      prevAvgSL !== null
        ? `Trung bình self-learning tháng trước: ${prevAvgSL.toFixed(1)}h → tháng này: ${avgSL.toFixed(1)}h (${avgSL >= prevAvgSL ? '+' : ''}${(avgSL - prevAvgSL).toFixed(1)}h)`
        : '';

    const contextSection =
      conversationContext && conversationContext.length > 0
        ? `\nContext hội thoại:\n${conversationContext.slice(-2).join('\n')}\n`
        : '';

    const healthIcon = report.alerts.length === 0 ? '🟢' : critical.length > 0 ? '🔴' : '🟡';

    const prompt = `Dữ liệu team tháng ${month}/${year}:
${contextSection}👥 ${report.rows.length} nhân sự | 🟢 ${healthy.length} bình thường | 🟡 ${approaching.length} tiệm cận | 🔴 ${exceeded.length + critical.length} vượt ngưỡng
📊 Avg log: ${avgLog.toFixed(1)}h | Avg SL: ${avgSL.toFixed(1)}h${trendNote ? ' | ' + trendNote : ''}
Vượt ngưỡng: ${alertDetails}

Viết nhận xét NGẮN GỌN theo format sau (emoji, tối đa 80 từ):

${healthIcon} Sức khỏe: [Tốt/Cần chú ý/Đáng lo ngại — 1 câu lý do]
📈/📉 Xu hướng: [so tháng trước, 1 câu]
🎯 Ưu tiên:
• [hành động 1]
• [hành động 2]`;

    const systemPrompt = `Chuyên gia HR workload. Trả lời tiếng Việt, súc tích, dùng emoji, đúng format. Không thêm lời mở đầu dài dòng.`;

    try {
      const insights = await this.llm.generateResponse(prompt, systemPrompt);
      return `📊 Team Insights — Tháng ${month}/${year}\n\n${insights}`;
    } catch (error: any) {
      this.logger.warn(`LLM insights failed, using rule-based fallback: ${error.message}`);
      return this.ruleBasedTeamInsights(report, month, year);
    }
  }

  // ─── Rule-based fallbacks ─────────────────────────────────────────────────

  private ruleBasedAnalysis(
    emp: ParticipationRow,
    prevEmp: ParticipationRow | undefined,
    month: number,
    year: number,
    prevMonth: number,
    prevYear: number,
  ): string {
    const statusIcon = emp.selfLearningHours > 50 ? '🔴' : emp.selfLearningHours > 30 ? '🟠' : emp.selfLearningHours > 21 ? '🟡' : '🟢';
    let msg = `🔍 ${emp.employeeName} — Tháng ${month}/${year}\n\n`;
    msg += `${statusIcon} Log: ${emp.projectHours.toFixed(1)}h (${emp.projectPercent.toFixed(0)}%) | SL: ${emp.selfLearningHours.toFixed(1)}h (${emp.selfLearningPercent.toFixed(0)}%)\n`;

    if (prevEmp) {
      const diff = emp.selfLearningHours - prevEmp.selfLearningHours;
      const arrow = diff > 0 ? '📈' : '📉';
      msg += `${arrow} vs T${prevMonth}/${prevYear}: SL ${diff > 0 ? '+' : ''}${diff.toFixed(1)}h\n`;
    }

    msg += '\n';

    if (emp.selfLearningHours > 30) {
      msg += `💡 Nguyên nhân:\n`;
      if (emp.projects.length === 0) {
        msg += `• Không có dự án nào được log\n`;
      } else if (emp.projectHours < emp.standardHours * 0.5) {
        msg += `• Giờ log chỉ ${emp.projectPercent.toFixed(0)}% — thấp hơn chuẩn\n`;
      } else {
        msg += `• Phân bổ dự án chưa tối ưu\n`;
      }
      msg += `\n✅ Hành động:\n• Kiểm tra phân công & nhắc log Jira\n• Review lại assignment tuần này`;
    } else if (emp.selfLearningHours > 21) {
      msg += `⚠️ Tiệm cận ngưỡng 30h — cần theo dõi thêm.`;
    } else {
      msg += `✅ Workload bình thường.`;
    }

    return msg;
  }

  private ruleBasedTeamInsights(report: any, month: number, year: number): string {
    const avgSL = report.rows.reduce((s: number, r: any) => s + r.selfLearningHours, 0) / report.rows.length;
    const critical = report.rows.filter((r: any) => r.selfLearningHours > 50).length;
    const healthIcon = report.alerts.length === 0 ? '🟢' : critical > 0 ? '🔴' : '🟡';

    let msg = `📊 Team Insights — Tháng ${month}/${year}\n\n`;
    msg += `${healthIcon} ${report.rows.length} nhân sự | Avg SL: ${avgSL.toFixed(1)}h | 🔴 Vượt ngưỡng: ${report.alerts.length}`;
    if (critical > 0) msg += ` (${critical} rất cao >50h)`;
    msg += '\n\n';

    if (report.alerts.length > 0) {
      msg += `🎯 Ưu tiên:\n• Review phân công cho ${report.alerts.length} nhân sự vượt ngưỡng\n• Nhắc log Jira đầy đủ trước cuối tháng`;
    } else {
      msg += `✅ Team trong ngưỡng an toàn.`;
    }

    return msg;
  }
}
