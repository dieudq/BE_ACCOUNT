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

    const billableRate = emp.standardHours > 0
      ? ((emp.projectHours / emp.standardHours) * 100).toFixed(1)
      : '0';
    const nonBillableHours = emp.selfLearningHours.toFixed(1);

    const prompt = `Dữ liệu nhân sự (dùng để làm bảng công/tính lương):
${contextSection}Tên: ${emp.employeeName} | Tháng ${month}/${year}
Giờ chuẩn: ${emp.standardHours.toFixed(1)}h | Log dự án: ${emp.projectHours.toFixed(1)}h (${billableRate}%) | Chưa phân bổ: ${nonBillableHours}h — ${severityLabel}
${trendSection}
Phân bổ theo dự án:
${projectBreakdown}

Viết phân tích ngắn gọn (tối đa 120 từ, vibe chill thân thiện, hài hước nhẹ, emoji phong phú) theo format:

🔴/🟡/🟢 Tình trạng bảng công: [1 câu — đánh giá mức độ hoàn chỉnh của dữ liệu để tính lương]
${trendArrow} Xu hướng: [so tháng trước, nhận xét vui nếu phù hợp]
💡 Lưu ý: [1-2 bullet về điểm cần chú ý khi hạch toán — giờ chưa phân bổ, dự án chiếm tỉ trọng cao,...]
✅ Cho kế toán: [1 bullet — về bảng công, hạch toán, xác nhận giờ trước chốt lương]
👥 Cho HR/Manager: [1 bullet — về phân công, nhắc log Jira, hoặc review assignment]`;

    const systemPrompt = `Bạn là assistant kế toán - nhân sự thân thiện. Bot phục vụ kế toán làm bảng công tính lương (ưu tiên), nhưng cũng hỗ trợ HR/Manager theo dõi nhân sự. Luôn nhấn mạnh thông tin phân bổ giờ theo dự án và mức độ đầy đủ của dữ liệu. Viết tiếng Việt tự nhiên như đang nhắn tin với đồng nghiệp — chill, hài hước nhẹ, emoji đa dạng. Không nói chung chung kiểu báo cáo hành chính.`;

    try {
      const analysis = await this.llm.generateResponse(prompt, systemPrompt);
      if (this.isUnavailableResponse(analysis)) {
        this.logger.warn('LLM returned unavailable/rate-limit response, using rule-based fallback');
        return this.ruleBasedAnalysis(emp, prevEmp, month, year, prevMonth, prevYear);
      }
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

    const prompt = `Dữ liệu workload team tháng ${month}/${year} (kế toán dùng để làm bảng công):
${contextSection}👥 ${report.rows.length} nhân sự | 🟢 ${healthy.length} đủ dữ liệu | 🟡 ${approaching.length} cần bổ sung | 🔴 ${exceeded.length + critical.length} thiếu giờ log nghiêm trọng
📊 Avg giờ dự án: ${avgLog.toFixed(1)}h | Avg giờ chưa phân bổ: ${avgSL.toFixed(1)}h${trendNote ? ' | ' + trendNote : ''}
Nhân sự giờ chưa phân bổ cao: ${alertDetails}

Viết nhận xét tổng quan (tối đa 120 từ, tone chill thân thiện, hài hước nhẹ, emoji đa dạng) theo format:

${healthIcon} Tình trạng bảng công: [1 câu đánh giá mức độ sẵn sàng để chốt lương tháng này]
📈/📉 Xu hướng: [so tháng trước, bình luận vui nếu phù hợp]
✅ Cho kế toán: [1 bullet — mức độ sẵn sàng chốt bảng công, ai cần xác nhận thêm]
👥 Cho HR/Manager: [1 bullet — về phân công dự án hoặc nhắc log Jira]`;

    const systemPrompt = `Bạn là assistant kế toán - nhân sự thân thiện. Dữ liệu workload phục vụ kế toán làm bảng công tính lương (ưu tiên), đồng thời hỗ trợ HR/Manager theo dõi nhân sự. Nhận xét phải thiết thực cho cả 2 đối tượng. Viết tiếng Việt tự nhiên như đang nhắn tin, chill, hài hước nhẹ, emoji sáng tạo. Không nói chung chung.`;

    try {
      const insights = await this.llm.generateResponse(prompt, systemPrompt);
      if (this.isUnavailableResponse(insights)) {
        this.logger.warn('LLM returned unavailable/rate-limit response, using team rule-based fallback');
        return this.ruleBasedTeamInsights(report, month, year);
      }
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
    const billableRate = emp.standardHours > 0
      ? ((emp.projectHours / emp.standardHours) * 100).toFixed(0)
      : '0';

    let msg = `🔍 ${emp.employeeName} — Tháng ${month}/${year}\n\n`;
    msg += `${statusIcon} Giờ chuẩn: ${emp.standardHours.toFixed(0)}h | Log dự án: ${emp.projectHours.toFixed(1)}h (${billableRate}%) | Chưa phân bổ: ${emp.selfLearningHours.toFixed(1)}h\n`;

    if (emp.projects.length > 0) {
      msg += `\n📂 Phân bổ dự án:\n`;
      emp.projects.forEach((p) => {
        msg += `  • ${p.projectName || p.projectCode}: ${p.hours.toFixed(1)}h (${p.percent.toFixed(0)}%)\n`;
      });
    }

    if (prevEmp) {
      const diff = emp.selfLearningHours - prevEmp.selfLearningHours;
      const arrow = diff > 0 ? '📈' : '📉';
      const comment = diff > 0 ? 'giờ chưa phân bổ tăng thêm 😬' : 'đã cải thiện hơn tháng trước 😮‍💨';
      msg += `\n${arrow} So T${prevMonth}/${prevYear}: ${diff > 0 ? '+' : ''}${diff.toFixed(1)}h — ${comment}\n`;
    }

    msg += '\n';

    if (emp.selfLearningHours > 30) {
      msg += `💡 Lưu ý khi làm bảng công:\n`;
      if (emp.projects.length === 0) {
        msg += `• Chưa có giờ log dự án nào cả 😳 — không thể phân bổ chi phí!\n`;
        msg += `• Cần nhắc nhân sự bổ sung Jira trước khi chốt lương\n`;
      } else if (emp.projectHours < emp.standardHours * 0.5) {
        msg += `• Chỉ phân bổ được ${billableRate}% giờ vào dự án — ${emp.selfLearningHours.toFixed(1)}h còn lại không có project\n`;
        msg += `• Xác nhận với nhân sự trước khi hạch toán\n`;
      } else {
        msg += `• Phần chưa phân bổ (${emp.selfLearningHours.toFixed(1)}h) hơi nhiều so chuẩn\n`;
      }
      msg += `\n✅ Cho kế toán: Chưa nên chốt bảng công — cần bổ sung giờ log trước\n`;
      msg += `👥 Cho HR/Manager: Nhắc nhân sự log Jira & xác nhận lại assignment với PM`;
    } else if (emp.selfLearningHours > 21) {
      msg += `⚠️ Giờ chưa phân bổ đang tiệm cận 30h — để mắt thêm chút nhé 😅\n`;
      msg += `✅ Cho kế toán: Tạm ổn, nhưng nên xác nhận lại trước khi chốt\n`;
      msg += `👥 Cho HR/Manager: Theo dõi thêm, tránh để vọt qua ngưỡng cuối tháng`;
    } else {
      msg += `✅ Cho kế toán: Dữ liệu đủ, sẵn sàng làm bảng công tháng này 🎉\n`;
      msg += `👥 Cho HR/Manager: Workload trong ngưỡng an toàn, không cần action gì thêm`;
    }

    return msg;
  }

  private ruleBasedTeamInsights(report: any, month: number, year: number): string {
    const rows: any[] = report.rows;
    const avgSL = rows.reduce((s: number, r: any) => s + r.selfLearningHours, 0) / rows.length;
    const avgLog = rows.reduce((s: number, r: any) => s + r.projectHours, 0) / rows.length;
    const critical = rows.filter((r: any) => r.selfLearningHours > 50).length;
    const noLog = rows.filter((r: any) => r.projectHours === 0).length;
    const healthIcon = report.alerts.length === 0 ? '🟢' : critical > 0 ? '🔴' : '🟡';

    const statusText = report.alerts.length === 0
      ? 'Bảng công tháng này trông ổn — sẵn sàng chốt lương 🎉'
      : critical > 0
        ? `Có ${critical} bạn chưa phân bổ được giờ — chưa nên chốt lương vội 😬`
        : `Cần xác nhận thêm ${report.alerts.length} bạn trước khi chốt bảng công 👀`;

    let msg = `📊 Team Insights — Tháng ${month}/${year}\n\n`;
    msg += `${healthIcon} Tình trạng bảng công: ${statusText}\n`;
    msg += `\n📋 Tổng quan:\n`;
    msg += `  • ${rows.length} nhân sự | Avg log dự án: ${avgLog.toFixed(1)}h | Avg chưa phân bổ: ${avgSL.toFixed(1)}h\n`;
    msg += `  • 🔴 Giờ chưa phân bổ cao (>30h): ${report.alerts.length} bạn\n`;
    if (noLog > 0) msg += `  • ⚠️ Chưa log dự án nào: ${noLog} bạn — không hạch toán được chi phí!\n`;
    if (critical > 0) msg += `  • 🚨 Rất nghiêm trọng (>50h chưa phân bổ): ${critical} bạn\n`;

    msg += `\n✅ Cho kế toán:\n`;
    if (report.alerts.length > 0) {
      msg += `• Chưa nên chốt — cần ${report.alerts.length} bạn bổ sung giờ log trước ngày chốt công\n`;
      if (noLog > 0) msg += `• Ưu tiên ${noLog} bạn chưa có giờ dự án nào (không hạch toán được)\n`;
    } else {
      msg += `• Dữ liệu đủ, sẵn sàng làm bảng công tháng này 🌱\n`;
    }
    msg += `\n👥 Cho HR/Manager:\n`;
    if (report.alerts.length > 0) {
      msg += `• Nhắc nhở nhân sự log Jira đầy đủ trước cuối tháng\n`;
      if (critical > 0) msg += `• Xem xét lại phân công cho ${critical} bạn >50h chưa phân bổ được\n`;
    } else {
      msg += `• Workload team trong ngưỡng ổn, không cần action khẩn 👍\n`;
    }

    return msg;
  }

  private isUnavailableResponse(text: string): boolean {
    const normalized = (text || '').toLowerCase();
    if (!normalized) return true;

    return (
      normalized.includes('tam thoi khong kha dung') ||
      normalized.includes('tạm thời không khả dụng') ||
      normalized.includes('all llm providers unavailable') ||
      normalized.includes('rate limit') ||
      normalized.includes('quota exceeded') ||
      normalized.includes('provider unavailable')
    );
  }
}
