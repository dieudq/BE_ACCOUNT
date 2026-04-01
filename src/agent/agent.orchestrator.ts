import { Injectable, Logger } from '@nestjs/common';
import { ChatService } from '../chat/chat.service';
import { PolicyEngine, ActionRisk, PolicyContext } from '../policies/policy.engine';
import { IdempotencyService } from '../policies/idempotency.service';
import { ParticipationReportService } from '../reports/participation.service';
import { ExcelExportService } from '../reports/excel-export.service';
import { DataSyncService } from '../sync/data-sync.service';
import { WorkloadAnalysisService } from '../workload/workload-analysis.service';

export interface AgentRequest {
  userId: string;
  userRole: string;
  message: string;
  actionType?: string;
  riskLevel?: ActionRisk;
  confirmationToken?: string;
}

export interface AgentResponse {
  success: boolean;
  message?: string;
  action?: string;
  requiresConfirmation?: boolean;
  confirmationToken?: string;
  auditId?: string;
  result?: any;
  error?: string;
}

@Injectable()
export class AgentOrchestrator {
  private readonly logger = new Logger(AgentOrchestrator.name);

  constructor(
    private readonly chat: ChatService,
    private readonly policy: PolicyEngine,
    private readonly idempotency: IdempotencyService,
    private readonly participation: ParticipationReportService,
    private readonly excel: ExcelExportService,
    private readonly sync: DataSyncService,
    private readonly workloadAnalysis: WorkloadAnalysisService,
  ) {}

  /**
   * Main orchestration entry point.
   * Parses intent, validates policy, executes tool.
   */
  async process(request: AgentRequest): Promise<AgentResponse> {
    try {
      const intent = this.parseIntent(request.message);

      const policyCtx: PolicyContext = {
        userId: request.userId,
        userRole: request.userRole,
        action: intent.action,
        riskLevel: this.getRiskLevel(intent.action),
        resourceId: intent.resourceId,
        metadata: intent.metadata,
      };

      const policyResult = await this.policy.validateAction(policyCtx);
      if (!policyResult.allowed) {
        return { success: false, error: policyResult.reason };
      }

      if (policyResult.requiresConfirmation) {
        const idempotencyKey = this.idempotency.generateKey(
          request.userId,
          intent.action,
          intent.resourceId,
        );

        if (await this.idempotency.isDuplicate(idempotencyKey)) {
          return { success: false, error: 'Duplicate action detected. Please try again.' };
        }

        const confirmationToken = this.generateConfirmationToken();
        return {
          success: true,
          action: intent.action,
          requiresConfirmation: true,
          message: `Xác nhận thực hiện: ${intent.action}?`,
          confirmationToken,
        };
      }

      const result = await this.executeAction(intent, request.userId);
      return {
        success: true,
        message: result.summary,
        result: result.data,
        auditId: `audit_${Date.now()}`,
      };
    } catch (error: any) {
      this.logger.error(`[Agent] Error: ${error.message}`, error.stack);
      return { success: false, error: error.message };
    }
  }

  // ─── Intent parsing ────────────────────────────────────────────────────────

  private parseIntent(message: string): {
    action: string;
    month?: number;
    year?: number;
    threshold?: number;
    resourceId?: string;
    employeeName?: string;
    metadata?: any;
  } {
    const lowerMsg = message.toLowerCase();
    const now = new Date();

    const monthMatch = lowerMsg.match(/tháng\s*(\d{1,2})/);
    const yearMatch = lowerMsg.match(/năm\s*(\d{4})|(\d{4})/);
    const month = monthMatch ? parseInt(monthMatch[1], 10) : now.getMonth() + 1;
    const year = yearMatch
      ? parseInt(yearMatch[1] || yearMatch[2], 10)
      : now.getFullYear();

    // Analyze employee (must check before general workload)
    if (
      lowerMsg.includes('phân tích') ||
      lowerMsg.includes('tại sao') ||
      lowerMsg.includes('vì sao') ||
      lowerMsg.includes('analyze')
    ) {
      // Try to extract employee name: "phân tích Nguyen Van A" → "Nguyen Van A"
      const nameMatch = message.match(/(?:phân tích|tại sao|vì sao|analyze)\s+(.+?)(?:\s+tháng|\s+năm|$)/i);
      const employeeName = nameMatch ? nameMatch[1].trim() : '';
      return { action: 'analyze_employee', month, year, employeeName };
    }

    // Team insights
    if (lowerMsg.includes('insights') || lowerMsg.includes('tổng quan team') || lowerMsg.includes('nhận xét team')) {
      return { action: 'team_insights', month, year };
    }

    // Workload report
    if (
      lowerMsg.includes('báo cáo') ||
      lowerMsg.includes('workload') ||
      lowerMsg.includes('tham gia dự án') ||
      lowerMsg.includes('self-learning') ||
      lowerMsg.includes('self learning')
    ) {
      if (lowerMsg.includes('download') || lowerMsg.includes('excel') || lowerMsg.includes('xuất')) {
        return { action: 'download_report', month, year };
      }
      if (
        lowerMsg.includes('sắp') ||
        lowerMsg.includes('ngưỡng') ||
        lowerMsg.includes('at-risk') ||
        lowerMsg.includes('cảnh báo')
      ) {
        return { action: 'get_at_risk', month, year, threshold: 30 };
      }
      return { action: 'get_workload_report', month, year };
    }

    // Sync
    if (lowerMsg.includes('sync') || lowerMsg.includes('đồng bộ')) {
      return { action: 'sync_workload', month, year };
    }

    // Default: free-form chat
    return { action: 'chat', metadata: { message } };
  }

  private getRiskLevel(action: string): ActionRisk {
    if (action.includes('create_voucher') || action.includes('approve')) {
      return ActionRisk.FINANCIAL;
    }
    if (action.includes('update') || action.includes('create') || action.includes('sync')) {
      return ActionRisk.WRITE;
    }
    return ActionRisk.READ;
  }

  // ─── Action execution ──────────────────────────────────────────────────────

  private async executeAction(
    intent: ReturnType<typeof this.parseIntent>,
    _userId: string,
  ): Promise<{ summary: string; data: any }> {
    const { action, month, year, threshold, employeeName } = intent;
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();

    switch (action) {
      case 'get_workload_report': {
        const report = await this.participation.generateMonthlyReport(y, m);
        return {
          summary: `📊 Báo cáo workload ${m}/${y}: ${report.rows.length} nhân sự, ${report.alerts.length} cảnh báo`,
          data: report,
        };
      }

      case 'get_at_risk': {
        const risks = await this.participation.getAtRiskEmployees(y, m, threshold ?? 30);
        return {
          summary: `⚠️ Tháng ${m}/${y}: ${risks.length} nhân sự có nguy cơ vượt ngưỡng ${threshold ?? 30}h`,
          data: risks,
        };
      }

      case 'download_report': {
        const report = await this.participation.generateMonthlyReport(y, m);
        const buffer = await this.excel.exportParticipationReport(report.rows, y, m);
        return {
          summary: `📁 Excel report ${m}/${y} sẵn sàng tải (${report.rows.length} nhân sự)`,
          data: { buffer: buffer.toString('base64'), filename: `workload-${y}-${String(m).padStart(2, '0')}.xlsx` },
        };
      }

      case 'sync_workload': {
        const result = await this.sync.syncMonthlyWorkloadReport(y, m);
        return {
          summary: result.message,
          data: result,
        };
      }

      case 'analyze_employee': {
        const empName = employeeName || '';
        if (!empName) {
          return {
            summary: 'Vui lòng chỉ định tên nhân sự. Ví dụ: "Phân tích Nguyen Van A tháng 3"',
            data: null,
          };
        }
        const analysis = await this.workloadAnalysis.analyzeSelfLearning(empName, y, m);
        return { summary: analysis, data: { employeeName: empName, year: y, month: m } };
      }

      case 'team_insights': {
        const insights = await this.workloadAnalysis.generateTeamInsights(y, m);
        return { summary: insights, data: { year: y, month: m } };
      }

      default: {
        const response = await this.chat.processQuery(intent.metadata?.message ?? action, _userId);
        return { summary: response, data: null };
      }
    }
  }

  private generateConfirmationToken(): string {
    return `confirm_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}
