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
8. CASHFLOW Q&A: câu hỏi như "tổng thu chi tháng X", "dòng tiền tháng X", "vì sao dòng tiền âm" → dùng cashflow_qa.
9. VOUCHER/KẾ TOÁN KHÁC: câu hỏi về phiếu chi, tài khoản GL mapping không phải Q&A cashflow theo tháng → steps=[] (handled by chat).
10. KHẢ NĂNG/GIỚI THIỆU: Nếu user hỏi "bạn có thể làm gì", "bot làm được gì", "giúp gì được", "có chức năng", "có tính năng", "bạn có thể", "hiện có" → trả về steps=[] requiresUserInput=null.
11. CONTEXT THEO TÊN: Nếu lịch sử có câu hỏi về employee cụ thể và user trả lời bằng 1 tên → đó là tên nhân sự cần dùng.
12. Trả về JSON hợp lệ, không có markdown wrap.

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
      return `Xin lỗi, đã có lỗi xảy ra: ${error.message}. Vui lòng thử lại.`;
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

    const contextBlock =
      history.length > 0
        ? `\nLịch sử hội thoại gần nhất:\n${history.slice(-3).join('\n')}\n`
        : '';

    const prompt = `${contextBlock}
Ngày hiện tại: ${now.toLocaleDateString('vi-VN')} (tháng ${defaultMonth}/${defaultYear})
Yêu cầu người dùng: "${message}"

Tạo kế hoạch hành động:`;

    try {
      const raw = await this.llm.generateResponse(prompt, PLANNER_SYSTEM);
      const plan = this.extractJSON<ActionPlan>(raw);
      if (plan && Array.isArray(plan.steps)) {
        // Điền params mặc định + validate year (chống hallucination)
        plan.steps = plan.steps.map((s) => {
          const rawYear = s.params?.year;
          const validYear =
            rawYear && rawYear >= 2024 && rawYear <= 2030 ? rawYear : defaultYear;
          return {
            ...s,
            params: {
              month: s.params?.month ?? defaultMonth,
              year: validYear,
              threshold: s.params?.threshold ?? 30,
              employeeName: s.params?.employeeName,
            },
          };
        });
        return plan;
      }
    } catch (err: any) {
      this.logger.warn(`Planner LLM failed, using NLP fallback: ${err.message}`);
    }

    // Fallback: NLP intent → plan đơn bước
    return this.nlpFallbackPlan(message, defaultMonth, defaultYear);
  }

  /**
   * Fallback khi LLM planner lỗi: dùng NlpIntentService để tạo plan đơn bước
   */
  private async nlpFallbackPlan(
    message: string,
    month: number,
    year: number,
  ): Promise<ActionPlan> {
    const lowerMessage = message.toLowerCase();

    // Fallback rule riêng cho bài toán cashflow tự động
    if (/cashflow|dòng tiền/.test(lowerMessage)) {
      if (/tạo|sinh|xử lý|file sổ|so_chi_tiet|tự động|upload/.test(lowerMessage)) {
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

    const parsed = await this.nlp.parseIntent(message);
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

    // Tìm trong 3 lượt gần nhất
    const recent = history.slice(-3).join(' ');
    const monthMatch = recent.match(/tháng\s*(\d{1,2})/);
    const yearMatch = recent.match(/(?:năm\s*)?(\d{4})/);

    return {
      month: monthMatch ? parseInt(monthMatch[1]) : undefined,
      year: yearMatch ? parseInt(yearMatch[1]) : undefined,
    };
  }

  /**
   * Trích xuất tháng/năm được nêu rõ trong câu người dùng.
   * Hỗ trợ: "tháng 1", "2026-01", "kỳ 2026-01", "01/2026".
   */
  private extractTemporalHints(message: string): { month?: number; year?: number } {
    if (!message) return {};

    const text = message.toLowerCase();
    const now = new Date();

    // Pattern: 2026-01 hoặc 2026/01
    const yMonth = text.match(/(20\d{2})[-\/](\d{1,2})/);
    if (yMonth) {
      const year = parseInt(yMonth[1], 10);
      const month = parseInt(yMonth[2], 10);
      if (month >= 1 && month <= 12) return { month, year };
    }

    // Pattern: tháng 1
    const monthMatch = text.match(/tháng\s*(\d{1,2})/);
    // Pattern: năm 2026 hoặc 2026
    const yearMatch = text.match(/năm\s*(20\d{2})|(20\d{2})/);

    const month = monthMatch ? parseInt(monthMatch[1], 10) : undefined;
    const year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2], 10) : undefined;

    if (month !== undefined && (month < 1 || month > 12)) {
      return { year: year ?? now.getFullYear() };
    }

    return {
      month,
      year: year ?? (month !== undefined ? now.getFullYear() : undefined),
    };
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

    let msg = `📊 Workload tháng ${month}/${year}\n`;
    msg += `${healthIcon} ${rows.length} nhân sự | ✅ ${healthy} bình thường | 🔴 ${alerts.length} vượt ngưỡng\n`;

    if (alerts.length > 0) {
      msg += `\n🔴 Vượt ngưỡng 30h:\n`;
      alerts.slice(0, 5).forEach((a: any) => {
        msg += `  • ${a.employeeName}: ${a.hours.toFixed(1)}h\n`;
      });
      if (alerts.length > 5) msg += `  • ...và ${alerts.length - 5} người khác\n`;
    }

    const sorted = [...rows].sort((a: any, b: any) => a.projectHours - b.projectHours);
    msg += `\n📉 Log ít nhất:\n`;
    sorted.slice(0, 3).forEach((r: any) => {
      const icon = r.alert ? '🔴' : r.selfLearningPercent > 20 ? '🟡' : '🟢';
      msg += `  ${icon} ${r.employeeName}: ${r.projectHours.toFixed(1)}h / ${r.standardHours.toFixed(0)}h chuẩn\n`;
    });

    return msg;
  }

  private formatAtRiskList(risks: any[], month: number, year: number, threshold: number): string {
    const exceeded = risks.filter((r: any) => r.selfLearningHours > threshold);
    let msg = `⚠️ At-risk tháng ${month}/${year} (ngưỡng ${threshold}h)\n`;
    msg += `🔴 Đã vượt: ${exceeded.length} | 🟡 Tiệm cận: ${risks.length - exceeded.length}\n\n`;
    risks.forEach((r: any) => {
      const over = r.selfLearningHours > threshold;
      const pct = ((r.selfLearningHours / threshold) * 100).toFixed(0);
      msg += `${over ? '🔴' : '🟡'} ${r.employeeName}: ${r.selfLearningHours.toFixed(1)}h ${over ? '⚡ vượt!' : `(${pct}%)`}\n`;
    });
    return msg;
  }

}
