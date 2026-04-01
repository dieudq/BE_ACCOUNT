import { Injectable, Logger } from '@nestjs/common';
import { LLMGatewayService } from '../llm-gateway/llm-gateway.service';
import { ParticipationReportService } from '../reports/participation.service';

@Injectable()
export class WorkloadAnalysisService {
  private readonly logger = new Logger(WorkloadAnalysisService.name);

  constructor(
    private readonly llm: LLMGatewayService,
    private readonly participation: ParticipationReportService,
  ) {}

  /**
   * AI-powered root cause analysis: WHY does an employee have high self-learning?
   * Fetches report data, builds context, asks LLM for insights.
   */
  async analyzeSelfLearning(employeeName: string, year: number, month: number): Promise<string> {
    const report = await this.participation.generateMonthlyReport(year, month);

    if (report.rows.length === 0) {
      return `❌ Chưa có dữ liệu tháng ${month}/${year}. Hãy sync dữ liệu trước.`;
    }

    // Case-insensitive partial name match
    const emp = report.rows.find((r) =>
      r.employeeName.toLowerCase().includes(employeeName.toLowerCase()),
    );

    if (!emp) {
      const names = report.rows.map((r) => r.employeeName).join(', ');
      return `❌ Không tìm thấy nhân sự "${employeeName}" trong tháng ${month}/${year}.\n\nDanh sách có dữ liệu: ${names}`;
    }

    const projectBreakdown =
      emp.projects.length > 0
        ? emp.projects
            .map((p) => `  - ${p.projectName || p.projectCode}: ${p.hours.toFixed(1)}h (${p.percent.toFixed(1)}%)`)
            .join('\n')
        : '  - Không có dữ liệu dự án';

    const prompt = `Phân tích workload của nhân sự sau và đưa ra nguyên nhân + khuyến nghị cụ thể:

Nhân sự: ${emp.employeeName}
Tháng: ${month}/${year}

Giờ làm việc:
- Giờ chuẩn (effective): ${emp.standardHours.toFixed(1)}h
- Giờ log dự án: ${emp.projectHours.toFixed(1)}h (${emp.projectPercent.toFixed(1)}%)
- Self-learning: ${emp.selfLearningHours.toFixed(1)}h (${emp.selfLearningPercent.toFixed(1)}%)
- Cảnh báo vượt ngưỡng 30h: ${emp.alert ? 'CÓ' : 'Không'}

Phân bổ dự án:
${projectBreakdown}

Phân tích 3 điểm sau:
1. Nguyên nhân chính tại sao self-learning ${emp.selfLearningHours > 30 ? 'vượt ngưỡng 30h' : `cao (${emp.selfLearningHours.toFixed(1)}h)`}
2. Các vấn đề tiềm ẩn (thiếu dự án, chưa log Jira, underallocation, v.v.)
3. Hành động cụ thể cho HR/Manager

Viết ngắn gọn, tiếng Việt, dùng emoji, tối đa 200 từ.`;

    const systemPrompt =
      'Bạn là chuyên gia phân tích workload HR. Đưa ra nhận xét thực tế, có giá trị hành động.';

    try {
      const analysis = await this.llm.generateResponse(prompt, systemPrompt);
      return `🔍 <b>Phân tích AI: ${emp.employeeName}</b> (${month}/${year})\n\n${analysis}`;
    } catch (error: any) {
      this.logger.warn(`LLM analysis failed, using rule-based fallback: ${error.message}`);
      return this.ruleBasedAnalysis(emp, month, year);
    }
  }

  /**
   * AI-powered team insights: overall workload health for a month.
   */
  async generateTeamInsights(year: number, month: number): Promise<string> {
    const report = await this.participation.generateMonthlyReport(year, month);

    if (report.rows.length === 0) {
      return `❌ Chưa có dữ liệu tháng ${month}/${year}. Hãy sync dữ liệu trước.`;
    }

    const avgSL = report.rows.reduce((sum, r) => sum + r.selfLearningHours, 0) / report.rows.length;
    const avgLog = report.rows.reduce((sum, r) => sum + r.projectHours, 0) / report.rows.length;
    const alertList =
      report.alerts.length > 0
        ? report.alerts.map((a) => `  - ${a.employeeName}: ${a.hours.toFixed(1)}h`).join('\n')
        : '  (Không có)';

    const prompt = `Phân tích tổng quan workload team tháng ${month}/${year}:

Thống kê:
- Tổng nhân sự: ${report.rows.length}
- Vượt ngưỡng 30h self-learning: ${report.alerts.length} người
- Trung bình giờ log dự án: ${avgLog.toFixed(1)}h
- Trung bình self-learning: ${avgSL.toFixed(1)}h

Nhân sự vượt ngưỡng:
${alertList}

Đưa ra:
1. Nhận xét tổng quan sức khỏe workload team
2. Xu hướng đáng lo ngại (nếu có)
3. 2-3 hành động ưu tiên cho HR tháng tới

Ngắn gọn, tiếng Việt, emoji, tối đa 200 từ.`;

    const systemPrompt =
      'Bạn là chuyên gia HR phân tích workload nhân sự. Đưa ra nhận xét thực tế, có giá trị.';

    try {
      const insights = await this.llm.generateResponse(prompt, systemPrompt);
      return `🤖 <b>AI Insights — Team ${month}/${year}</b>\n\n${insights}`;
    } catch (error: any) {
      this.logger.warn(`LLM insights failed, using rule-based fallback: ${error.message}`);
      return this.ruleBasedTeamInsights(report, month, year);
    }
  }

  // ─── Rule-based fallbacks ─────────────────────────────────────────────────

  private ruleBasedAnalysis(emp: any, month: number, year: number): string {
    let msg = `📊 <b>${emp.employeeName}</b> — Tháng ${month}/${year}\n\n`;
    msg += `• Giờ chuẩn: ${emp.standardHours.toFixed(1)}h\n`;
    msg += `• Giờ log: ${emp.projectHours.toFixed(1)}h (${emp.projectPercent.toFixed(1)}%)\n`;
    msg += `• Self-learning: ${emp.selfLearningHours.toFixed(1)}h (${emp.selfLearningPercent.toFixed(1)}%)\n\n`;

    if (emp.selfLearningHours > 30) {
      msg += `🔴 <b>Vượt ngưỡng 30h!</b>\n\n`;
      if (emp.projects.length === 0) {
        msg += `Nguyên nhân: Không có dữ liệu dự án — có thể chưa được phân công hoặc chưa log Jira.\n`;
      } else if (emp.projectHours < emp.standardHours * 0.5) {
        msg += `Nguyên nhân: Giờ log dự án rất thấp so với giờ chuẩn.\n`;
        msg += `Khuyến nghị: Kiểm tra lại lịch phân công và nhắc log Jira đầy đủ.\n`;
      }
    } else {
      msg += `✅ Workload bình thường.`;
    }

    return msg;
  }

  private ruleBasedTeamInsights(report: any, month: number, year: number): string {
    const avgSL = report.rows.reduce((sum: number, r: any) => sum + r.selfLearningHours, 0) / report.rows.length;
    let msg = `📊 <b>Workload Team ${month}/${year}</b>\n\n`;
    msg += `👥 Nhân sự: ${report.rows.length}\n`;
    msg += `📈 Trung bình self-learning: ${avgSL.toFixed(1)}h\n`;
    msg += `⚠️ Vượt ngưỡng 30h: ${report.alerts.length} người\n\n`;

    if (report.alerts.length > 0) {
      msg += `🔴 <b>Cần chú ý:</b>\n`;
      report.alerts.forEach((a: any) => {
        msg += `• ${a.employeeName}: ${a.hours.toFixed(1)}h\n`;
      });
      msg += `\nKhuyến nghị: Review phân công dự án cho các nhân sự trên.`;
    } else {
      msg += `✅ Tất cả nhân sự trong ngưỡng an toàn.`;
    }

    return msg;
  }
}
