import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ChatService } from '../chat/chat.service';
import { PolicyEngine, ActionRisk, PolicyContext } from '../policies/policy.engine';
import { ParticipationReportService } from '../reports/participation.service';
import { ExcelExportService } from '../reports/excel-export.service';
import { DataSyncService } from '../sync/data-sync.service';
import { WorkloadAnalysisService } from '../workload/workload-analysis.service';
import { CashflowExportService } from '../financial/cashflow-export.service';
import { CashflowAgentService } from '../financial/cashflow-agent.service';
import { NlpIntentService } from '../common/services/nlp-intent.service';
import { ConversationContextService } from '../common/services/conversation-context.service';
import { LLMGatewayService } from '../llm-gateway/llm-gateway.service';

// ─── Types ────────────────────────────────────────────────────────────────────

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

/** Một bước trong kế hoạch hành động */
interface PlanStep {
  tool: string;
  params: {
    month?: number;
    year?: number;
    employeeName?: string;
    threshold?: number;
    sourceFilePath?: string;
    question?: string;
  };
  purpose: string;
}

/** Kế hoạch hành động do LLM tạo ra */
interface ActionPlan {
  reasoning: string;
  steps: PlanStep[];
  requiresUserInput: string | null; // câu hỏi làm rõ nếu thiếu context
}

/** Kết quả reflection sau mỗi bước */
interface ReflectionResult {
  sufficient: boolean;          // kết quả đủ để trả lời chưa?
  additionalSteps: PlanStep[];  // bước tiếp theo (nếu cần)
  insight: string;              // nhận xét ngắn để ghép vào response
}

/** Kết quả thực thi một tool */
interface ToolResult {
  tool: string;
  output: string;
  data?: any;
  error?: string;
}

// ─── Tool Schema (contract rõ ràng cho LLM planner) ──────────────────────────

const TOOL_SCHEMA = `
AVAILABLE_TOOLS:
- get_workload_report(month, year): Xem báo cáo % tham gia dự án & self-learning tháng
- get_at_risk_employees(month, year, threshold?): Danh sách nhân sự có nguy cơ vượt ngưỡng
- analyze_employee(employeeName, month, year): Phân tích AI sâu workload của một nhân sự
- analyze_top_at_risk(month, year): Tự động phân tích người vượt ngưỡng cao nhất
- team_insights(month, year): AI insights tổng quan sức khỏe workload cả team
- sync_workload(month, year): Đồng bộ dữ liệu workload từ ERP
- export_report(month, year): Xuất file Excel báo cáo tham gia dự án (workload/nhân sự)
- export_cashflow(month, year): Xuất file Excel cashflow/dòng tiền từ dữ liệu GL
- generate_cashflow_auto(sourceFilePath?): Tự xử lý file sổ chi tiết để sinh file cashflow theo tháng
- cashflow_qa(month, year, question): Trả lời Q&A từ dữ liệu file cashflow đã xuất
`;

const PLANNER_SYSTEM = `Bạn là planner của hệ thống HR agent. Nhiệm vụ: đọc yêu cầu người dùng và tạo kế hoạch hành động có cấu trúc.

${TOOL_SCHEMA}

NGUYÊN TẮC BẮT BUỘC:
1. Chỉ dùng tool phù hợp với yêu cầu, không gọi thừa. Tối đa 2 steps cho 1 request.
2. Nếu cần nhiều bước (sync rồi xem, cảnh báo rồi phân tích) → lên kế hoạch đa bước.
3. Nếu thiếu tên nhân sự cho analyze_employee → đặt requiresUserInput hỏi 1 lần rõ ràng.
4. NĂM: Luôn dùng năm từ context hoặc năm hiện tại (2026). KHÔNG ĐƯỢC tạo ra năm nào trước 2024.
5. THRESHOLD: Ngưỡng self-learning mặc định là 30h. "Top 5" hay "top N" là số lượng kết quả, KHÔNG phải threshold.
6. CASHFLOW AUTO REPORT: "tạo báo cáo cashflow", "sinh báo cáo tự động", "xử lý file sổ chi tiết", "so_chi_tiet_cac_tai_khoan" → dùng generate_cashflow_auto.
7. CASHFLOW EXPORT: "xuất cashflow", "export cashflow", "tải file cashflow", "cashflow excel" → dùng export_cashflow tool.
8. CASHFLOW Q&A: câu hỏi như "tổng thu chi tháng X", "dòng tiền tháng X", "vì sao dòng tiền âm", "chi tiết từng nhóm thu/chi", "cơ cấu thu chi", "nhóm thu", "nhóm chi", "breakdown cashflow", "kỳ YYYY-MM" → dùng cashflow_qa.
9. VOUCHER/KẾ TOÁN KHÁC: câu hỏi về phiếu chi, tài khoản GL mapping không phải Q&A cashflow theo tháng → steps=[] (handled by chat).
10. KHẢ NĂNG/GIỚI THIỆU: Nếu user hỏi "bạn có thể làm gì", "bot làm được gì", "giúp gì được", "có chức năng", "có tính năng", "bạn có thể", "hiện có" → trả về steps=[] requiresUserInput=null.
11. CONTEXT THEO TÊN: Nếu lịch sử có câu hỏi về employee cụ thể và user trả lời bằng 1 tên → đó là tên nhân sự cần dùng.
12. Trả về JSON hợp lệ, không có markdown wrap.
13. TÊN NHÂN SỰ CỤ THỂ: Nếu yêu cầu đề cập tên người (VD: "thống kê workload của Nguyễn Văn A", "xem giờ của Trần B", "bảng công của X") → BẮT BUỘC dùng analyze_employee với employeeName đó. KHÔNG ĐƯỢC dùng get_workload_report khi đã có tên cụ thể.
14. get_workload_report CHỈ dùng khi user hỏi tổng quan cả team/tất cả nhân sự, không đề cập tên cụ thể nào.

FORMAT JSON:
{
  "reasoning": "giải thích ngắn tại sao chọn các bước này",
  "steps": [
    {"tool": "tên_tool", "params": {"month": N, "year": YYYY, ...}, "purpose": "mục đích bước này"}
  ],
  "requiresUserInput": null
}`;

const REFLECTION_SYSTEM = `Bạn là evaluator của HR agent. Đánh giá kết quả vừa thực thi và quyết định bước tiếp theo.

${TOOL_SCHEMA}

Trả về JSON hợp lệ:
{
  "sufficient": true/false,
  "additionalSteps": [],
  "insight": "nhận xét ngắn về kết quả (1-2 câu, tiếng Việt)"
}`;

// ─── Orchestrator ─────────────────────────────────────────────────────────────

@Injectable()
export class AgentOrchestrator {
  private readonly logger = new Logger(AgentOrchestrator.name);
  private readonly MAX_REFLECTION_STEPS = 2;

  constructor(
    private readonly chat: ChatService,
    private readonly policy: PolicyEngine,
    private readonly participation: ParticipationReportService,
    private readonly excel: ExcelExportService,
    private readonly sync: DataSyncService,
    private readonly workloadAnalysis: WorkloadAnalysisService,
    private readonly cashflowExport: CashflowExportService,
    private readonly cashflowAgent: CashflowAgentService,
    private readonly nlp: NlpIntentService,
    private readonly context: ConversationContextService,
    private readonly llm: LLMGatewayService,
  ) {}

  /**
   * Entry point chính — nhận text tự nhiên, trả về text tự nhiên
   * Flow: Observe (lấy history) → Think/Plan (LLM planner) → Act (tool) → Reflect → Respond
   */
  async processMessage(userId: string, userRole: string, message: string): Promise<string> {
    try {
      // === OBSERVE: lấy context hội thoại ===
      const history = this.context.getContextSummary(userId);
      const inheritedParams = this.extractInheritedParams(history);

      // Phát hiện nếu người dùng đang trả lời câu hỏi làm rõ trước đó
      // → inject lại lần hỏi trước vào message để planner hiểu context đầy đủ
      const resolvedMessage = this.resolveIfClarificationAnswer(message, history);

      // === THINK: LLM tạo plan đa bước ===
      const plan = await this.planActions(resolvedMessage, history, inheritedParams);

      this.logger.log(
        `[Agent] user=${userId} reasoning="${plan.reasoning}" steps=${plan.steps.length}`,
      );

      // Nếu planner thấy thiếu thông tin → hỏi lại người dùng
      if (plan.requiresUserInput) {
        this.context.addTurn(userId, 'user', message);
        this.context.addTurn(userId, 'assistant', plan.requiresUserInput);
        return plan.requiresUserInput;
      }

      if (plan.steps.length === 0) {
        // Không phải workload intent → delegate sang ChatService (SmartQueryService)
        const fallback = await this.chat.processQuery(message, userId);
        this.context.addTurn(userId, 'user', message);
        this.context.addTurn(userId, 'assistant', fallback);
        return fallback;
      }

      // === ACT + REFLECT: thực thi từng bước, reflection sau mỗi bước ===
      const response = await this.executeWithReflection(plan, userId, userRole, message);

      // Lưu lịch sử
      this.context.addTurn(userId, 'user', message);
      this.context.addTurn(userId, 'assistant', response);

      return response;
    } catch (error: any) {
      this.logger.error(`[Agent] Error: ${error.message}`, error.stack);
      try {
        const fallback = await this.chat.processQuery(message, userId);
        this.context.addTurn(userId, 'user', message);
        this.context.addTurn(userId, 'assistant', fallback);
        return fallback;
      } catch (fallbackError: any) {
        this.logger.error(`[Agent] Fallback ChatService failed: ${fallbackError.message}`);
        return 'Xin lỗi, hệ thống AI đang gián đoạn. Tôi chưa xử lý được yêu cầu lúc này.';
      }
    }
  }

  /** Entry point REST API (backward compat) */
  async process(request: AgentRequest): Promise<AgentResponse> {
    try {
      const response = await this.processMessage(
        request.userId,
        request.userRole,
        request.message,
      );
      return { success: true, message: response, auditId: `audit_${Date.now()}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ─── Planner ────────────────────────────────────────────────────────────────

  /**
   * LLM tạo action plan từ message + context.
   * Fallback sang NLP-intent nếu LLM planner thất bại.
   */
  private async planActions(
    message: string,
    history: string[],
    inheritedParams: { month?: number; year?: number },
  ): Promise<ActionPlan> {
    const now = new Date();
    const explicitTime = this.extractTemporalHints(message);
    const defaultMonth = explicitTime.month ?? inheritedParams.month ?? now.getMonth() + 1;
    const defaultYear = explicitTime.year ?? inheritedParams.year ?? now.getFullYear();
    // Nếu user dùng cụm thời gian tương đối ("tháng trước", "tháng vừa rồi") → force giá trị,
    // không cho LLM override bằng tháng hiện tại
    const hasRelativeTime = /tháng trước|tháng vừa rồi|tháng vừa qua|tháng trước đó|last month/i.test(message);
    const hasAbsoluteTime = /tháng\s*\d|tháng này|\d{4}[-\/]\d{1,2}/.test(message.toLowerCase());

    const contextBlock =
      history.length > 0
        ? `\nLịch sử hội thoại gần nhất:\n${history.slice(-3).join('\n')}\n`
        : '';

    const prompt = `${contextBlock}
Ngày hiện tại: ${now.toLocaleDateString('vi-VN')} (tháng ${defaultMonth}/${defaultYear})
Yêu cầu người dùng: "${message}"

Tạo kế hoạch hành động:`;

    // Pre-check 1: cashflow Q&A (trước employee check để "thu/chi" không bị nhầm sang workload)
    const preCheckedCashflow = this.preCheckCashflowQuery(message, defaultMonth, defaultYear);
    if (preCheckedCashflow) return preCheckedCashflow;

    // Pre-check 2: export toàn bộ workload → export_report
    const preCheckedWorkloadExport = this.preCheckWorkloadExportQuery(
      message,
      defaultMonth,
      defaultYear,
    );
    if (preCheckedWorkloadExport) return preCheckedWorkloadExport;

    // Pre-check 3: team/all-employees query → get_workload_report (phải trước employee check)
    const preCheckedTeam = this.preCheckTeamQuery(message, defaultMonth, defaultYear);
    if (preCheckedTeam) return preCheckedTeam;

    // Pre-check 4: tên nhân sự cụ thể + ngữ cảnh workload → analyze_employee
    const preChecked = this.preCheckEmployeeQuery(message, defaultMonth, defaultYear);
    if (preChecked) return preChecked;

    try {
      const raw = await this.llm.generateResponse(prompt, PLANNER_SYSTEM);
      const plan = this.extractJSON<ActionPlan>(raw);
      if (plan && Array.isArray(plan.steps)) {
        // Điền params mặc định + validate year (chống hallucination)
        plan.steps = plan.steps.map((s) => {
          const rawYear = s.params?.year;
          const validYear =
            rawYear && rawYear >= 2024 && rawYear <= 2030 ? rawYear : defaultYear;
          // Nếu user nói "tháng trước/vừa rồi" → force defaultMonth, không cho LLM dùng tháng hiện tại
          const resolvedMonth = (hasRelativeTime || hasAbsoluteTime)
            ? defaultMonth
            : (s.params?.month ?? defaultMonth);
          const resolvedYear = (hasRelativeTime || hasAbsoluteTime)
            ? defaultYear
            : validYear;
          return {
            ...s,
            params: {
              month: resolvedMonth,
              year: resolvedYear,
              threshold: s.params?.threshold ?? 30,
              employeeName: s.params?.employeeName,
            },
          };
        });
        // Post-process: safety net — nếu LLM vẫn chọn sai tool thì fix lại
        return this.fixEmployeeRoutingIfNeeded(plan, message, defaultMonth, defaultYear);
      }
    } catch (err: any) {
      this.logger.warn(`Planner LLM failed, using NLP fallback: ${err.message}`);
    }

    // Fallback: NLP intent → plan đơn bước
    return this.nlpFallbackPlan(message, defaultMonth, defaultYear, history);
  }

  /**
   * Fallback khi LLM planner lỗi: dùng NlpIntentService để tạo plan đơn bước
   */
  private async nlpFallbackPlan(
    message: string,
    month: number,
    year: number,
    history: string[],
  ): Promise<ActionPlan> {
    const normalizedMessage = this.normalizeVi(message);

    // Fallback rule riêng cho bài toán cashflow tự động
    if (this.isCashflowRelatedMessage(normalizedMessage)) {
      if (this.isCashflowGenerateMessage(normalizedMessage)) {
        return {
          reasoning: 'Fallback: detected cashflow auto-generation request',
          steps: [
            {
              tool: 'generate_cashflow_auto',
              params: { month, year, question: message },
              purpose: 'Generate cashflow report from source GL file',
            },
          ],
          requiresUserInput: null,
        };
      }

      if (this.isCashflowExportMessage(normalizedMessage)) {
        return {
          reasoning: 'Fallback: detected cashflow export request',
          steps: [
            {
              tool: 'export_cashflow',
              params: { month, year, question: message },
              purpose: 'Export cashflow report to Excel',
            },
          ],
          requiresUserInput: null,
        };
      }

      return {
        reasoning: 'Fallback: detected cashflow Q&A request',
        steps: [
          {
            tool: 'cashflow_qa',
            params: { month, year, question: message },
            purpose: 'Answer accounting Q&A from exported cashflow report',
          },
        ],
        requiresUserInput: null,
      };
    }

    const parsed = await this.nlp.parseIntent(message, history);

    // Override: nếu NLP đã extract được tên người → luôn dùng analyze_employee
    // bất kể intent là gì (tránh nhầm sang get_workload_report)
    if (
      parsed.entities?.employeeName &&
      ['query_workload_report', 'analyze_employee'].includes(parsed.intent)
    ) {
      return {
        reasoning: 'Fallback: specific employee name detected → analyze_employee',
        steps: [
          {
            tool: 'analyze_employee',
            params: {
              month: parsed.entities?.month ?? month,
              year: parsed.entities?.year ?? year,
              employeeName: parsed.entities.employeeName,
              question: message,
            },
            purpose: 'Analyze specific employee workload',
          },
        ],
        requiresUserInput: null,
      };
    }

    const intentToTool: Record<string, string> = {
      query_workload_report: 'get_workload_report',
      query_at_risk_employees: 'get_at_risk_employees',
      analyze_employee: 'analyze_employee',
      team_insights: 'team_insights',
      download_report: 'export_report',
      sync_workload: 'sync_workload',
      query_cashflow_gl: 'cashflow_qa',
    };

    const tool = intentToTool[parsed.intent];
    if (!tool) {
      return { reasoning: 'General chat, no tool needed', steps: [], requiresUserInput: null };
    }

    return {
      reasoning: `Fallback: detected intent ${parsed.intent}`,
      steps: [
        {
          tool,
          params: {
            month: parsed.entities?.month ?? month,
            year: parsed.entities?.year ?? year,
            employeeName: parsed.entities?.employeeName,
            question: message,
          },
          purpose: `Execute ${tool}`,
        },
      ],
      requiresUserInput: parsed.clarificationNeeded ?? null,
    };
  }

  // ─── Executor + Reflection ──────────────────────────────────────────────────

  /**
   * Thực thi plan từng bước. Sau mỗi bước, reflection quyết định có cần thêm bước không.
   */
  private async executeWithReflection(
    plan: ActionPlan,
    userId: string,
    userRole: string,
    originalMessage: string,
  ): Promise<string> {
    const executedResults: ToolResult[] = [];
    let stepsToRun = [...plan.steps];
    let reflectionCount = 0;

    while (stepsToRun.length > 0 && reflectionCount <= this.MAX_REFLECTION_STEPS) {
      const step = stepsToRun.shift()!;

      // Policy check cho WRITE/FINANCIAL actions
      if (this.isWriteAction(step.tool)) {
        const allowed = await this.checkPolicy(step.tool, userId, userRole, step.params);
        if (!allowed) {
          executedResults.push({
            tool: step.tool,
            output: `Không có quyền thực hiện: ${step.tool}`,
            error: 'policy_denied',
          });
          continue;
        }
      }

      // Thực thi tool
      const result = await this.executeTool(step, userId);
      executedResults.push(result);

      // Reflection: đánh giá kết quả và quyết định bước tiếp
      if (stepsToRun.length === 0 && reflectionCount < this.MAX_REFLECTION_STEPS) {
        const reflection = await this.reflect(result, step, originalMessage);
        reflectionCount++;

        if (!reflection.sufficient && reflection.additionalSteps.length > 0) {
          // Thêm các bước mà reflection đề xuất vào queue
          stepsToRun.push(...reflection.additionalSteps);
          this.logger.log(
            `[Agent] Reflection added ${reflection.additionalSteps.length} step(s)`,
          );
        }
      }
    }

    return this.buildFinalResponse(executedResults, plan.reasoning, originalMessage);
  }

  /**
   * Reflection: LLM đánh giá kết quả bước vừa thực thi.
   * Quyết định: đủ rồi? hay cần thêm bước?
   */
  private async reflect(
    result: ToolResult,
    step: PlanStep,
    originalMessage: string,
  ): Promise<ReflectionResult> {
    if (result.error) {
      return { sufficient: true, additionalSteps: [], insight: '' };
    }

    const prompt = `Bước vừa thực thi: ${step.tool} (${step.purpose})
Kết quả: ${result.output.substring(0, 600)}
Yêu cầu gốc: "${originalMessage}"

Đánh giá kết quả:`;

    try {
      const raw = await this.llm.generateResponse(prompt, REFLECTION_SYSTEM);
      const reflection = this.extractJSON<ReflectionResult>(raw);
      if (reflection && typeof reflection.sufficient === 'boolean') {
        return {
          sufficient: reflection.sufficient,
          additionalSteps: (reflection.additionalSteps || []).map((s: any) => ({
            tool: s.tool,
            params: { ...step.params, ...s.params },
            purpose: s.purpose || '',
          })),
          insight: reflection.insight || '',
        };
      }
    } catch (err: any) {
      this.logger.warn(`Reflection LLM failed: ${err.message}`);
    }

    return { sufficient: true, additionalSteps: [], insight: '' };
  }

  // ─── Tool Executor ──────────────────────────────────────────────────────────

  private async executeTool(step: PlanStep, userId = ''): Promise<ToolResult> {
    const { tool, params } = step;
    const now = new Date();
    const month = params.month ?? now.getMonth() + 1;
    const year = params.year ?? now.getFullYear();
    const threshold = params.threshold ?? 30;
    const employeeName = params.employeeName ?? '';
    const sourceFilePath = params.sourceFilePath ?? '';
    const question = params.question ?? '';
    const convCtx = userId ? this.context.getContextSummary(userId) : [];

    try {
      switch (tool) {
        case 'get_workload_report': {
          const report = await this.participation.generateMonthlyReport(year, month);
          if (report.rows.length === 0) {
            return {
              tool,
              output:
                `Chưa có dữ liệu workload tháng ${month}/${year}. ` +
                `Nhắn "đồng bộ dữ liệu tháng ${month}" để lấy dữ liệu từ ERP.`,
            };
          }
          return { tool, output: this.formatWorkloadSummary(report, month, year), data: report };
        }

        case 'get_at_risk_employees': {
          const risks = await this.participation.getAtRiskEmployees(year, month, threshold);
          if (risks.length === 0) {
            return {
              tool,
              output: `Tháng ${month}/${year}: Không có nhân sự nào có nguy cơ vượt ngưỡng ${threshold}h self-learning.`,
            };
          }
          return { tool, output: this.formatAtRiskList(risks, month, year, threshold), data: risks };
        }

        case 'analyze_employee': {
          if (!employeeName) {
            return {
              tool,
              output: `Bạn muốn phân tích nhân sự nào? Ví dụ: "Phân tích Nguyễn Văn A tháng ${month}"`,
            };
          }
          const analysis = await this.workloadAnalysis.analyzeSelfLearning(
            employeeName, year, month, convCtx,
          );
          return { tool, output: analysis };
        }

        case 'analyze_top_at_risk': {
          const risks = await this.participation.getAtRiskEmployees(year, month, threshold);
          const topRisk = risks.find((r) => r.selfLearningHours > threshold);
          if (!topRisk) {
            return {
              tool,
              output: `Không có nhân sự nào vượt ngưỡng ${threshold}h tháng ${month}/${year}.`,
            };
          }
          const analysis = await this.workloadAnalysis.analyzeSelfLearning(
            topRisk.employeeName, year, month, convCtx,
          );
          return { tool, output: analysis };
        }

        case 'team_insights': {
          const insights = await this.workloadAnalysis.generateTeamInsights(year, month, convCtx);
          return { tool, output: insights };
        }

        case 'export_report': {
          const cronFilePath = path.join(
            process.cwd(),
            'tmp_reports',
            `workload-${year}-${String(month).padStart(2, '0')}.xlsx`,
          );

          if (fs.existsSync(cronFilePath)) {
            return {
              tool,
              output:
                `📊 Báo cáo workload tháng ${month}/${year} (toàn bộ nhân sự)\n` +
                `📁 Dùng file scheduler đã tạo đầu tháng\n` +
                `📎FILE:${cronFilePath}`,
              data: { filePath: cronFilePath, source: 'cron' },
            };
          }

          const report = await this.participation.generateMonthlyReport(year, month);
          if (report.rows.length === 0) {
            return {
              tool,
              output: `Chưa có dữ liệu workload tháng ${month}/${year}. Nhắn "đồng bộ dữ liệu tháng ${month}" để lấy từ ERP.`,
            };
          }
          const buffer = await this.excel.exportParticipationReport(report.rows, year, month);
          const exportsDir = path.join(process.cwd(), 'exports');
          if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
          const filename = `workload-${year}-${String(month).padStart(2, '0')}-${Date.now()}.xlsx`;
          const filePath = path.join(exportsDir, filename);
          fs.writeFileSync(filePath, buffer);
          return {
            tool,
            output: `📊 Báo cáo workload tháng ${month}/${year} (${report.rows.length} nhân sự)\n📎FILE:${filePath}`,
            data: { filePath },
          };
        }

        case 'sync_workload': {
          const result = await this.sync.syncMonthlyWorkloadReport(year, month);
          return { tool, output: result.message, data: result };
        }

        case 'export_cashflow': {
          let cfPath: string;
          try {
            cfPath = await this.cashflowExport.exportToExcel(year, month);
          } catch (err: any) {
            const isNoData = err.message?.toLowerCase().includes('no gl data') ||
                             err.message?.toLowerCase().includes('not found');
            if (isNoData) {
              return {
                tool,
                output: `❌ Chưa có dữ liệu GL tháng ${month}/${year}.\n\nCần import file GL từ Misa trước:\n• Upload file GL qua API /api/financial/upload-gl\n• Sau đó thử xuất lại.`,
              };
            }
            throw err;
          }
          return {
            tool,
            output: `📊 Cashflow Excel tháng ${month}/${year} đã xuất xong!\n📎FILE:${cfPath}`,
            data: { filePath: cfPath },
          };
        }

        case 'generate_cashflow_auto': {
          const generated = await this.cashflowAgent.generateAutoReport(sourceFilePath);

          return {
            tool,
            output:
              `🤖 Đã xử lý file nguồn thành công\n` +
              `• Kỳ: ${generated.period}\n` +
              `• Nguồn: ${generated.sourceFilePath}\n` +
              `• Kết quả: ${generated.outputFilePath}\n` +
              `📎FILE:${generated.outputFilePath}`,
            data: {
              filePath: generated.outputFilePath,
              sourceFilePath: generated.sourceFilePath,
              qaDatasetPath: generated.qaDatasetPath,
              period: generated.period,
            },
          };
        }

        case 'cashflow_qa': {
          const hintedTime = this.extractTemporalHints(question || '');
          const qaMonth = hintedTime.month ?? month;
          const qaYear = hintedTime.year ?? year;
          const answer = await this.cashflowAgent.answerQuestion(
            question || `Tóm tắt cashflow tháng ${month}/${year}`,
            qaYear,
            qaMonth,
          );
          return { tool, output: answer };
        }

        default:
          return { tool, output: '', error: `Unknown tool: ${tool}` };
      }
    } catch (error: any) {
      this.logger.error(`[Tool:${tool}] Error: ${error.message}`);
      return { tool, output: `Lỗi khi thực thi ${tool}: ${error.message}`, error: error.message };
    }
  }

  // ─── Response Builder ──────────────────────────────────────────────────────

  /**
   * Gộp kết quả nhiều bước thành một response mạch lạc.
   * Nếu chỉ 1 bước → trả thẳng output.
   * Nếu nhiều bước → nối với separator rõ ràng.
   */
  private buildFinalResponse(results: ToolResult[], _reasoning: string, _message: string): string {
    const successResults = results.filter((r) => !r.error || r.output);

    if (successResults.length === 0) {
      return 'Không thể thực hiện yêu cầu. Vui lòng thử lại hoặc mô tả rõ hơn.';
    }

    if (successResults.length === 1) {
      return successResults[0].output;
    }

    // Nhiều bước: nối kết quả với header
    return successResults
      .map((r, i) => {
        const header = i > 0 ? `\n${'─'.repeat(28)}\n` : '';
        return `${header}${r.output}`;
      })
      .join('');
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Kế thừa tháng/năm từ lịch sử hội thoại (entity inheritance)
   * Ví dụ: user đang nói về tháng 3, hỏi tiếp → vẫn dùng tháng 3
   */
  private extractInheritedParams(history: string[]): { month?: number; year?: number } {
    if (history.length === 0) return {};

    // Tìm trong các lượt gần nhất, hỗ trợ cả dạng tương đối: tháng trước, kỳ này, quý trước...
    const recent = history.slice(-5).join(' ');
    const hints = this.extractTemporalHints(recent);
    if (hints.month || hints.year) {
      return { month: hints.month, year: hints.year };
    }

    const monthMatch = recent.match(/tháng\s*(\d{1,2})|thg\s*(\d{1,2})|\bt\s*(\d{1,2})\b/i);
    const yearMatch = recent.match(/(?:năm\s*)?(20\d{2})/i);

    return {
      month: monthMatch ? parseInt(monthMatch[1] || monthMatch[2] || monthMatch[3], 10) : undefined,
      year: yearMatch ? parseInt(yearMatch[1], 10) : undefined,
    };
  }

  /**
   * Trích xuất tháng/năm được nêu rõ trong câu người dùng.
   * Hỗ trợ: "tháng 1", "2026-01", "kỳ 2026-01", "01/2026".
   */
  private extractTemporalHints(message: string): { month?: number; year?: number } {
    if (!message) return {};

    const text = this.normalizeVi(message);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const shiftMonth = (month: number, year: number, delta: number) => {
      let m = month + delta;
      let y = year;
      while (m <= 0) {
        m += 12;
        y -= 1;
      }
      while (m > 12) {
        m -= 12;
        y += 1;
      }
      return { month: m, year: y };
    };

    // Pattern: "tháng trước", "tháng vừa rồi", "tháng vừa qua", "tháng trước đó"
    if (/thang truoc|thang vua roi|thang vua qua|thang truoc do|ky truoc|ky vua roi|last month|previous month/.test(text)) {
      return shiftMonth(currentMonth, currentYear, -1);
    }

    // Pattern: "tháng này", "tháng hiện tại"
    if (/thang nay|thang hien tai|ky nay|this month|current month/.test(text)) {
      return { month: currentMonth, year: currentYear };
    }

    // Pattern: "tháng sau", "kỳ sau"
    if (/thang sau|ky sau|next month/.test(text)) {
      return shiftMonth(currentMonth, currentYear, +1);
    }

    // Pattern: "quý trước", "quý này", "quý sau"
    if (/quy truoc|last quarter|previous quarter/.test(text)) {
      const currentQuarter = Math.floor((currentMonth - 1) / 3) + 1;
      let prevQuarter = currentQuarter - 1;
      let y = currentYear;
      if (prevQuarter <= 0) {
        prevQuarter = 4;
        y -= 1;
      }
      return { month: prevQuarter * 3, year: y };
    }
    if (/quy nay|this quarter|current quarter/.test(text)) {
      const currentQuarter = Math.floor((currentMonth - 1) / 3) + 1;
      return { month: currentQuarter * 3, year: currentYear };
    }
    if (/quy sau|next quarter/.test(text)) {
      const currentQuarter = Math.floor((currentMonth - 1) / 3) + 1;
      let nextQuarter = currentQuarter + 1;
      let y = currentYear;
      if (nextQuarter > 4) {
        nextQuarter = 1;
        y += 1;
      }
      return { month: nextQuarter * 3, year: y };
    }

    // Pattern: Q1/2026, q2 2025, quý 3 năm 2026
    const quarterMatch = text.match(/(?:quy|q)\s*([1-4])(?:\s*(?:[\/\-]|nam)?\s*(20\d{2}))?/);
    if (quarterMatch) {
      const q = parseInt(quarterMatch[1], 10);
      const y = quarterMatch[2] ? parseInt(quarterMatch[2], 10) : currentYear;
      return { month: q * 3, year: y };
    }

    // Pattern: 2026-01 hoặc 2026/01
    const yMonthDash = text.match(/(20\d{2})[-\/](\d{1,2})/);
    if (yMonthDash) {
      const year = parseInt(yMonthDash[1], 10);
      const month = parseInt(yMonthDash[2], 10);
      if (month >= 1 && month <= 12) return { month, year };
    }

    // Pattern: 2026 3 hoặc 2026 03 (space-separated, e.g. từ /analyze Name 2026 3)
    const yMonthSpace = text.match(/(20\d{2})\s+(\d{1,2})(?:\s|$)/);
    if (yMonthSpace) {
      const year = parseInt(yMonthSpace[1], 10);
      const month = parseInt(yMonthSpace[2], 10);
      if (month >= 1 && month <= 12) return { month, year };
    }

    // Pattern: 01/2026, 1-2026
    const monthYear = text.match(/(?:thang|thg|t|ky)?\s*(\d{1,2})\s*[\/\-]\s*(20\d{2})/);
    if (monthYear) {
      const month = parseInt(monthYear[1], 10);
      const year = parseInt(monthYear[2], 10);
      if (month >= 1 && month <= 12) return { month, year };
    }

    // Pattern: tháng 1
    const monthMatch = text.match(/thang\s*(\d{1,2})|thg\s*(\d{1,2})|\bt\s*(\d{1,2})\b/);
    // Pattern: năm 2026 hoặc 2026
    const yearMatch = text.match(/nam\s*(20\d{2})|(20\d{2})/);

    const month = monthMatch ? parseInt(monthMatch[1] || monthMatch[2] || monthMatch[3], 10) : undefined;
    const year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2], 10) : undefined;

    // Pattern: năm nay / năm ngoái
    if (!month && /nam ngoai|nam truoc|last year|previous year/.test(text)) {
      return { year: currentYear - 1 };
    }
    if (!month && /nam nay|this year|current year/.test(text)) {
      return { year: currentYear };
    }

    if (month !== undefined && (month < 1 || month > 12)) {
      return { year: year ?? currentYear };
    }

    return {
      month,
      year: year ?? (month !== undefined ? currentYear : undefined),
    };
  }

  /**
   * Pre-check trước khi gọi LLM: nếu message rõ ràng hỏi về một người cụ thể
   * trong ngữ cảnh workload → trả về plan analyze_employee ngay, không qua LLM.
   * Đảm bảo routing đúng ngay cả khi LLM rate limit hoặc hallucinate.
   */
  /**
   * Pre-check cashflow Q&A — chạy trước employee check vì "thu/chi" không liên quan workload.
   * Match: câu hỏi về dòng tiền, thu chi, breakdown cashflow.
   */
  private preCheckCashflowQuery(
    message: string,
    month: number,
    year: number,
  ): ActionPlan | null {
    const normalized = this.normalizeVi(message);
    const isCashflowQa = this.isCashflowRelatedMessage(normalized) &&
      /tong thu|tong chi|thu\/?chi|dong tien|nhom thu|nhom chi|chi tiet|co cau|breakdown|net|rong|lai lo|tham hut|chuyen dong/.test(normalized);
    if (!isCashflowQa) return null;

    // Không nhầm với lệnh tạo/xuất cashflow
    const isGenerate = this.isCashflowGenerateMessage(normalized);
    const isExport = this.isCashflowExportMessage(normalized);
    if (isGenerate || isExport) return null;

    const hints = this.extractTemporalHints(message);
    const m = hints.month ?? month;
    const y = hints.year ?? year;

    this.logger.log(`[Agent] Pre-check cashflow_qa for period ${y}-${String(m).padStart(2, '0')}`);
    return {
      reasoning: 'Pre-check: cashflow Q&A detected',
      steps: [{ tool: 'cashflow_qa', params: { month: m, year: y, question: message }, purpose: 'Answer cashflow Q&A' }],
      requiresUserInput: null,
    };
  }

  private normalizeVi(v: string): string {
    return (v || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .trim();
  }

  private isCashflowRelatedMessage(normalized: string): boolean {
    return /cashflow|dong tien|bao cao dong tien|thu chi|luu chuyen tien te|tong thu|tong chi|nhom thu|nhom chi|co cau thu|co cau chi|breakdown|dong tien rong|tham hut|lai lo/.test(normalized);
  }

  private isCashflowGenerateMessage(normalized: string): boolean {
    return /tao|sinh|xu ly|file so|so_chi_tiet|tu dong|upload|import/.test(normalized);
  }

  private isCashflowExportMessage(normalized: string): boolean {
    return /xuat|export|tai file|excel|download/.test(normalized);
  }

  /**
   * Pre-check team/all-employees query — "toàn bộ nhân sự", "cả team", "tất cả"
   * → route get_workload_report, tránh LLM nhầm thành analyze_employee với tên sai.
   */
  private preCheckTeamQuery(
    message: string,
    month: number,
    year: number,
  ): ActionPlan | null {
    const isTeam = /toàn bộ|tất cả|cả team|cả công ty|toàn team|all employee|tổng hợp nhân sự/i.test(message);
    if (!isTeam) return null;

    const isWorkload = /workload|thống kê|bảng công|báo cáo|tham gia|giờ log/i.test(message);
    if (!isWorkload) return null;

    // Không route nhầm khi message có tên cụ thể kèm "toàn bộ/tất cả" (edge case)
    const hasSpecificName = /(?:tên|nhân sự tên)\s+\p{Lu}/u.test(message);
    if (hasSpecificName) return null;

    this.logger.log(`[Agent] Pre-check get_workload_report for team (${month}/${year})`);
    return {
      reasoning: 'Pre-check: team/all-employees workload query',
      steps: [{ tool: 'get_workload_report', params: { month, year }, purpose: 'Get team workload report' }],
      requiresUserInput: null,
    };
  }

  /**
   * Pre-check export workload toàn bộ theo câu tự nhiên.
   * Ví dụ: "thống kê toàn bộ", "báo cáo toàn bộ", "export workload toàn bộ".
   */
  private preCheckWorkloadExportQuery(
    message: string,
    month: number,
    year: number,
  ): ActionPlan | null {
    const normalized = this.normalizeVi(message);

    const hasWholeTeamHint = /toan bo|tat ca|ca team|toan team|ca cong ty/.test(normalized);
    const hasWorkloadHint = /workload|bang cong|bao cao|thong ke|gio log|tham gia du an/.test(
      normalized,
    );
    const hasExportHint = /export|xuat|tai file|excel|gui file|download/.test(normalized);

    const triggerByPhrase =
      /thong ke toan bo|bao cao toan bo|export workload toan bo|xuat workload toan bo/.test(
        normalized,
      );

    if (!(triggerByPhrase || (hasWholeTeamHint && hasWorkloadHint && hasExportHint))) {
      return null;
    }

    this.logger.log(
      `[Agent] Pre-check export_report for whole-team workload (${month}/${year})`,
    );

    return {
      reasoning: 'Pre-check: whole-team workload export request',
      steps: [
        {
          tool: 'export_report',
          params: { month, year },
          purpose: 'Return workload Excel file for all employees',
        },
      ],
      requiresUserInput: null,
    };
  }

  private preCheckEmployeeQuery(
    message: string,
    month: number,
    year: number,
  ): ActionPlan | null {
    const isWorkloadContext = /workload|thống kê|bảng công|giờ log|tham gia dự án|phân tích|tự học|self.?learning/i.test(message);
    if (!isWorkloadContext) return null;

    const name = this.extractPersonName(message);
    if (!name) return null;

    this.logger.log(`[Agent] Pre-check: route analyze_employee for "${name}" (${month}/${year})`);
    return {
      reasoning: `Pre-check: specific employee "${name}" detected`,
      steps: [
        {
          tool: 'analyze_employee',
          params: { month, year, employeeName: name },
          purpose: `Analyze workload for ${name}`,
        },
      ],
      requiresUserInput: null,
    };
  }

  /**
   * Nếu LLM planner chọn get_workload_report nhưng message chứa tên người cụ thể
   * → override sang analyze_employee (safety net sau pre-check).
   */
  private fixEmployeeRoutingIfNeeded(
    plan: ActionPlan,
    message: string,
    month: number,
    year: number,
  ): ActionPlan {
    const hasTeamReport = plan.steps.some((s) => s.tool === 'get_workload_report');
    if (!hasTeamReport) return plan;

    const name = this.extractPersonName(message);
    if (!name) return plan;

    this.logger.log(`[Agent] Fix routing: get_workload_report → analyze_employee for "${name}"`);
    return {
      ...plan,
      steps: [
        {
          tool: 'analyze_employee',
          params: { month, year, employeeName: name },
          purpose: `Analyze workload for ${name}`,
        },
      ],
    };
  }

  /**
   * Trích xuất tên người Việt từ message.
   * Dùng Unicode property escapes (\p{Lu}) để nhận dạng chữ hoa chính xác với tiếng Việt.
   * Ưu tiên tên sau keyword, fallback tìm cụm title-case.
   */
  private extractPersonName(message: string): string | null {
    // Lớp 1: tên sau keyword rõ ràng — "tên X", "nhân sự X", "phân tích X", "bạn X"
    const afterKeyword = message.match(
      /(?:tên|nhân sự tên|nhân sự|phân tích|bạn|xem giờ|workload của)\s+((?:\p{Lu}\S+\s+){1,3}\p{Lu}\S+)/u,
    );
    if (afterKeyword) {
      // Bỏ số/năm trailing, ví dụ: "Trần Văn Ninh 2026 3" → "Trần Văn Ninh"
      return afterKeyword[1].trim().replace(/\s+\d[\d\s]*$/, '').trim();
    }

    // Lớp 2: cụm ≥2 từ title-case liền kề, loại bỏ các từ thường gặp không phải tên
    const stripped = message
      .replace(/\b(Workload|Jira|Excel|ERP|Tháng|Năm|HR|Manager)\b/g, '')
      .trim();
    const titleCase = stripped.match(/((?:\p{Lu}\S+\s+){2,3}\p{Lu}\S+)/u);
    if (titleCase) {
      return titleCase[1].trim().replace(/\s+\d[\d\s]*$/, '').trim();
    }

    return null;
  }

  private isWriteAction(tool: string): boolean {
    // sync_workload chỉ là fetch từ ERP (READ), không phải WRITE nguy hiểm
    // export_report tạo file tạm — không cần policy check
    return false;
  }

  private async checkPolicy(
    tool: string,
    userId: string,
    userRole: string,
    params: any,
  ): Promise<boolean> {
    const riskLevel =
      tool === 'sync_workload' ? ActionRisk.WRITE : ActionRisk.READ;
    const ctx: PolicyContext = { userId, userRole, action: tool, riskLevel, metadata: params };
    const result = await this.policy.validateAction(ctx);
    return result.allowed;
  }

  /**
   * Nếu lượt trước agent hỏi clarification và user trả lời ngắn → ghép lại thành câu đầy đủ.
   * Ví dụ: Bot hỏi "Tên nhân sự?" → User: "Nguyễn Văn A" → resolvedMessage = "Phân tích Nguyễn Văn A tháng 3/2026"
   */
  private resolveIfClarificationAnswer(message: string, history: string[]): string {
    if (history.length < 2) return message;

    // Lấy lượt bot cuối cùng
    const lastBotTurn = [...history].reverse().find((h) => h.startsWith('Bot:'));
    if (!lastBotTurn) return message;

    const botMsg = lastBotTurn.replace(/^Bot:\s*/, '').toLowerCase();

    // Nếu bot vừa hỏi về tên nhân sự và user trả lời ngắn (có thể là tên người)
    const askedForName =
      botMsg.includes('tên nhân sự') ||
      botMsg.includes('nhân sự nào') ||
      botMsg.includes('phân tích ai') ||
      botMsg.includes('bạn muốn phân tích');

    const isShortAnswer = message.trim().split(/\s+/).length <= 6;
    const looksLikeName = /^[A-ZÀ-Ỹ][a-zà-ỹ]+(\s+[A-ZÀ-Ỹ][a-zà-ỹ]+)+$/.test(message.trim());

    if (askedForName && isShortAnswer && looksLikeName) {
      // Kế thừa tháng/năm từ history
      const monthMatch = history.slice(-4).join(' ').match(/tháng\s*(\d{1,2})/);
      const yearMatch = history.slice(-4).join(' ').match(/(\d{4})/);
      const now = new Date();
      const m = monthMatch ? monthMatch[1] : now.getMonth() + 1;
      const y = yearMatch ? yearMatch[1] : now.getFullYear();
      return `Phân tích ${message.trim()} tháng ${m}/${y}`;
    }

    return message;
  }

  private extractJSON<T>(text: string): T | null {
    try {
      return JSON.parse(text.trim()) as T;
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]) as T;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  // ─── Format helpers ────────────────────────────────────────────────────────

  private formatWorkloadSummary(report: any, month: number, year: number): string {
    const { rows, alerts } = report;
    const healthy = rows.filter((r: any) => !r.alert && r.selfLearningPercent <= 20).length;
    const healthIcon = alerts.length === 0 ? '🟢' : alerts.length > rows.length * 0.3 ? '🔴' : '🟡';
    const readyForPayroll = alerts.length === 0
      ? 'Dữ liệu ổn, sẵn sàng làm bảng công! 🎉'
      : alerts.length > rows.length * 0.3
        ? 'Nhiều người chưa log đủ — chưa nên chốt bảng công vội 😬'
        : 'Tạm được, nhưng cần xác nhận thêm vài bạn trước khi chốt 👀';

    const noProjectLog = rows
      .filter((r: any) => (r.projectHours || 0) <= 0.001)
      .sort((a: any, b: any) => b.selfLearningHours - a.selfLearningHours);

    const highUnallocated = rows
      .filter((r: any) => (r.projectHours || 0) > 0.001 && r.selfLearningHours > 30)
      .sort((a: any, b: any) => b.selfLearningHours - a.selfLearningHours);

    let msg = `📊 Workload tháng ${month}/${year}\n`;
    msg += `${healthIcon} ${rows.length} nhân sự | ✅ ${healthy} đủ dữ liệu | 🔴 ${alerts.length} giờ chưa phân bổ cao\n`;
    msg += `💬 ${readyForPayroll}\n`;

    if (noProjectLog.length > 0) {
      msg += `\n🚫 Chưa log dự án nào — không thể phân bổ chi phí:\n`;
      noProjectLog.forEach((r: any) => {
        msg += `• ${r.employeeName}: ${r.selfLearningHours.toFixed(1)}h self-learning, chưa log dự án nào\n`;
      });
    }

    if (highUnallocated.length > 0) {
      msg += `\n⚠️ Có log dự án nhưng giờ chưa phân bổ vẫn cao (>30h):\n`;
      highUnallocated.forEach((r: any) => {
        const projects = [...(r.projects || [])]
          .sort((a: any, b: any) => (b.hours || 0) - (a.hours || 0));

        msg += `• ${r.employeeName}:\n`;

        if (projects.length > 0) {
          projects.slice(0, 5).forEach((p: any) => {
            const pName = p.projectName || p.projectCode || 'chưa rõ dự án';
            const pHours = Number(p.hours || 0).toFixed(1);
            const pPercent = Number(p.percent || 0).toFixed(0);
            msg += `  ↳ ${pName}: ${pHours}h (${pPercent}%)\n`;
          });

          if (projects.length > 3) {
            msg += `  ↳ +${projects.length - 3} dự án khác\n`;
          }
        } else {
          const fallbackPercent = r.standardHours > 0
            ? ((r.projectHours / r.standardHours) * 100).toFixed(0)
            : '0';
          msg += `  ↳ Chưa rõ dự án: ${r.projectHours.toFixed(1)}h (${fallbackPercent}%)\n`;
        }

        msg += `  ↳ Còn ${r.selfLearningHours.toFixed(1)}h self-learning\n\n`;
      });
    }

    return msg.trim();
  }

  private formatAtRiskList(risks: any[], month: number, year: number, threshold: number): string {
    const exceeded = risks.filter((r: any) => r.selfLearningHours > threshold);
    let msg = `👀 Danh sách cần theo dõi — tháng ${month}/${year}\n`;
    msg += `🔴 Đã bay qua ngưỡng: ${exceeded.length} bạn | 🟡 Đang lấn cấn: ${risks.length - exceeded.length} bạn\n\n`;
    risks.forEach((r: any) => {
      const over = r.selfLearningHours > threshold;
      const pct = ((r.selfLearningHours / threshold) * 100).toFixed(0);
      const comment = over ? '⚡ vượt rồi, cần hành động!' : `${pct}% ngưỡng — ráng thêm chút nữa là xong 😅`;
      msg += `${over ? '🔴' : '🟡'} ${r.employeeName}: ${r.selfLearningHours.toFixed(1)}h — ${comment}\n`;
    });
    return msg;
  }

}
