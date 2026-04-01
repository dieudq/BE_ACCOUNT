import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WorkloadAnalysisService } from './workload-analysis.service';
import { ParticipationReportService } from '../reports/participation.service';
import { DataSyncService } from '../sync/data-sync.service';

interface NlpQueryDto {
  question: string;
  userId?: string;
}

@Controller('workload')
export class WorkloadController {
  constructor(
    private readonly analysis: WorkloadAnalysisService,
    private readonly participation: ParticipationReportService,
    private readonly sync: DataSyncService,
  ) {}

  /**
   * GET /workload/warnings?year=2026&month=4
   * Danh sách nhân sự vượt ngưỡng self-learning
   */
  @Get('warnings')
  async getWarnings(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('threshold') threshold?: string,
  ) {
    const now = new Date();
    const y = year ? parseInt(year) : now.getFullYear();
    const m = month ? parseInt(month) : now.getMonth() + 1;
    const t = threshold ? parseInt(threshold) : 30;

    const report = await this.participation.generateMonthlyReport(y, m);
    return {
      year: y,
      month: m,
      threshold: t,
      total: report.rows.length,
      alertCount: report.alerts.length,
      alerts: report.alerts,
    };
  }

  /**
   * GET /workload/report?year=2026&month=4
   * Báo cáo workload đầy đủ (tất cả nhân sự)
   */
  @Get('report')
  async getReport(
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const now = new Date();
    const y = year ? parseInt(year) : now.getFullYear();
    const m = month ? parseInt(month) : now.getMonth() + 1;

    return await this.participation.generateMonthlyReport(y, m);
  }

  /**
   * GET /workload/at-risk?year=2026&month=4&threshold=30
   * Nhân sự có nguy cơ vượt ngưỡng (>= 70% threshold)
   */
  @Get('at-risk')
  async getAtRisk(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('threshold') threshold?: string,
  ) {
    const now = new Date();
    const y = year ? parseInt(year) : now.getFullYear();
    const m = month ? parseInt(month) : now.getMonth() + 1;
    const t = threshold ? parseInt(threshold) : 30;

    const risks = await this.participation.getAtRiskEmployees(y, m, t);
    return { year: y, month: m, threshold: t, count: risks.length, employees: risks };
  }

  /**
   * GET /workload/analyze/:employeeName?year=2026&month=4
   * AI phân tích workload của một nhân sự cụ thể
   */
  @Get('analyze/:employeeName')
  async analyzeEmployee(
    @Param('employeeName') employeeName: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const now = new Date();
    const y = year ? parseInt(year) : now.getFullYear();
    const m = month ? parseInt(month) : now.getMonth() + 1;

    const analysis = await this.analysis.analyzeSelfLearning(
      decodeURIComponent(employeeName),
      y,
      m,
    );
    return { employeeName, year: y, month: m, analysis };
  }

  /**
   * GET /workload/insights?year=2026&month=4
   * AI insights tổng quan team
   */
  @Get('insights')
  async getTeamInsights(
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const now = new Date();
    const y = year ? parseInt(year) : now.getFullYear();
    const m = month ? parseInt(month) : now.getMonth() + 1;

    const insights = await this.analysis.generateTeamInsights(y, m);
    return { year: y, month: m, insights };
  }

  /**
   * POST /workload/query
   * NLP query — hỏi tự nhiên về workload
   * Body: { "question": "Tháng 3 có bao nhiêu người vượt ngưỡng?" }
   */
  @Post('query')
  async nlpQuery(@Body() body: NlpQueryDto) {
    const { question } = body;
    if (!question?.trim()) {
      return { success: false, error: 'question is required' };
    }

    const lowerQ = question.toLowerCase();
    const now = new Date();

    const monthMatch = lowerQ.match(/tháng\s*(\d{1,2})/);
    const yearMatch = lowerQ.match(/năm\s*(\d{4})|(\d{4})/);
    const month = monthMatch ? parseInt(monthMatch[1]) : now.getMonth() + 1;
    const year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : now.getFullYear();

    // Route intent
    if (lowerQ.includes('phân tích') || lowerQ.includes('tại sao') || lowerQ.includes('vì sao')) {
      const nameMatch = question.match(/(?:phân tích|tại sao|vì sao)\s+(.+?)(?:\s+tháng|\s+năm|$)/i);
      const employeeName = nameMatch ? nameMatch[1].trim() : '';
      if (employeeName) {
        const analysis = await this.analysis.analyzeSelfLearning(employeeName, year, month);
        return { success: true, type: 'employee_analysis', year, month, answer: analysis };
      }
    }

    if (lowerQ.includes('insights') || lowerQ.includes('tổng quan') || lowerQ.includes('nhận xét team')) {
      const insights = await this.analysis.generateTeamInsights(year, month);
      return { success: true, type: 'team_insights', year, month, answer: insights };
    }

    if (
      lowerQ.includes('vượt ngưỡng') ||
      lowerQ.includes('cảnh báo') ||
      lowerQ.includes('warning')
    ) {
      const report = await this.participation.generateMonthlyReport(year, month);
      return {
        success: true,
        type: 'warnings',
        year,
        month,
        answer: `Tháng ${month}/${year}: ${report.alerts.length}/${report.rows.length} nhân sự vượt ngưỡng 30h self-learning.`,
        data: report.alerts,
      };
    }

    if (lowerQ.includes('at-risk') || lowerQ.includes('at risk') || lowerQ.includes('sắp vượt')) {
      const risks = await this.participation.getAtRiskEmployees(year, month, 30);
      return {
        success: true,
        type: 'at_risk',
        year,
        month,
        answer: `Tháng ${month}/${year}: ${risks.length} nhân sự có nguy cơ vượt ngưỡng.`,
        data: risks,
      };
    }

    // Default: full report summary
    const report = await this.participation.generateMonthlyReport(year, month);
    return {
      success: true,
      type: 'report_summary',
      year,
      month,
      answer: `Tháng ${month}/${year}: ${report.rows.length} nhân sự, ${report.alerts.length} vượt ngưỡng 30h.`,
      data: { rowCount: report.rows.length, alertCount: report.alerts.length },
    };
  }

  /**
   * POST /workload/sync?year=2026&month=4
   * Trigger sync dữ liệu từ ERP
   */
  @Post('sync')
  async syncWorkload(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('deptCode') deptCode?: string,
  ) {
    const now = new Date();
    const y = year ? parseInt(year) : now.getFullYear();
    const m = month ? parseInt(month) : now.getMonth() + 1;

    return await this.sync.syncMonthlyWorkloadReport(y, m, deptCode);
  }
}
