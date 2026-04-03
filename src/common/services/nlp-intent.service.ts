import { Injectable, Logger } from '@nestjs/common';
import { LLMGatewayService } from '../../llm-gateway/llm-gateway.service';

/**
 * Tất cả các intent agent có thể xử lý.
 * Khi thêm tính năng mới, chỉ cần thêm intent ở đây và cập nhật INTENT_SCHEMA.
 */
export type IntentType =
  | 'query_pending_vouchers'
  | 'query_approval_status'
  | 'count_vouchers'
  | 'query_voucher_detail'
  | 'query_vouchers_by_date'
  | 'query_amount'
  | 'query_approver'
  | 'query_history'
  | 'query_cashflow_gl'
  | 'query_workload_report'
  | 'query_at_risk_employees'
  | 'analyze_employee'
  | 'team_insights'
  | 'download_report'
  | 'sync_workload'
  | 'approve_voucher'
  | 'reject_voucher'
  | 'general_chat';

export interface ParsedIntent {
  intent: IntentType;
  confidence: number; // 0-1
  entities: {
    voucherCode?: string;       // e.g. "AX123", "PX45"
    employeeName?: string;      // e.g. "Nguyen Van A"
    month?: number;             // 1-12
    year?: number;              // e.g. 2026
    amount?: number;
    category?: string;          // e.g. "lương", "dự án"
    glAccount?: string;         // e.g. "334.1"
    threshold?: number;         // e.g. 30
    dateRange?: { from: string; to: string };
  };
  clarificationNeeded?: string; // câu hỏi lại nếu ambiguous
  rawMessage: string;
}

interface ContextHints {
  intent?: IntentType;
  month?: number;
  year?: number;
  employeeName?: string;
  voucherCode?: string;
  glAccount?: string;
  threshold?: number;
}

const INTENT_SCHEMA = `
Bạn là NLP parser cho hệ thống kế toán. Phân tích câu hỏi tiếng Việt và trả về JSON.

INTENTS:
- query_pending_vouchers: hỏi về phiếu chưa/đang chờ duyệt
- query_approval_status: hỏi trạng thái duyệt của phiếu cụ thể
- count_vouchers: đếm số lượng phiếu
- query_voucher_detail: xem chi tiết phiếu
- query_vouchers_by_date: lấy phiếu theo ngày/tuần/tháng
- query_amount: hỏi tổng tiền chi/thu
- query_approver: hỏi ai đang duyệt
- query_history: xem lịch sử phiếu
- query_cashflow_gl: hỏi về cashflow, tài khoản GL
- query_workload_report: xem báo cáo workload tháng
- query_at_risk_employees: ai sắp/đã vượt ngưỡng self-learning
- analyze_employee: phân tích workload của một nhân sự
- team_insights: nhận xét tổng quan team
- download_report: tải/xuất báo cáo Excel
- sync_workload: đồng bộ dữ liệu workload
- approve_voucher: yêu cầu duyệt phiếu
- reject_voucher: yêu cầu từ chối phiếu
- general_chat: câu hỏi chung không thuộc loại trên

ENTITIES (chỉ điền nếu có trong câu):
- voucherCode: mã phiếu như AX123, PX45, CV88
- employeeName: tên nhân sự
- month: số tháng (1-12)
- year: năm 4 chữ số
- category: danh mục chi phí
- glAccount: mã tài khoản như 334.1, 6422
- threshold: ngưỡng giờ
- clarificationNeeded: câu hỏi lại nếu ambiguous (null nếu rõ ràng)

Trả về JSON hợp lệ (không có markdown):
{
  "intent": "...",
  "confidence": 0.95,
  "entities": { ... },
  "clarificationNeeded": null
}
`;

@Injectable()
export class NlpIntentService {
  private readonly logger = new Logger(NlpIntentService.name);
  private readonly currentYear = new Date().getFullYear();
  private readonly currentMonth = new Date().getMonth() + 1;

  constructor(private readonly llm: LLMGatewayService) {}

  /**
   * Parse intent từ message tự nhiên.
   * Dùng LLM + fallback regex nếu LLM thất bại.
   */
  async parseIntent(message: string, conversationContext?: string[]): Promise<ParsedIntent> {
    const contextHints = this.extractContextHints(conversationContext);

    try {
      const contextSection = conversationContext?.length
        ? `\nLịch sử hội thoại gần nhất:\n${conversationContext.slice(-3).join('\n')}\n`
        : '';

      const prompt = `${contextSection}\nCâu hỏi hiện tại: "${message}"\n\nPhân tích và trả về JSON:`;

      const raw = await this.llm.generateResponse(prompt, INTENT_SCHEMA);
      const parsed = this.extractJSON(raw);

      if (parsed && parsed.intent) {
        // Fill default month/year nếu LLM không extract được
        if (!parsed.entities) parsed.entities = {};
        if (!parsed.entities.month) parsed.entities.month = this.currentMonth;
        if (!parsed.entities.year) parsed.entities.year = this.currentYear;

        const llmParsed: ParsedIntent = {
          ...parsed,
          rawMessage: message,
          confidence: parsed.confidence ?? 0.8,
        };

        return this.applyContextInference(message, llmParsed, contextHints);
      }
    } catch (err) {
      this.logger.warn(`LLM intent parsing failed, using fallback: ${err.message}`);
    }

    // Fallback: regex-based (backup khi LLM lỗi)
    const fallback = this.fallbackRegexParse(message);
    return this.applyContextInference(message, fallback, contextHints);
  }

  /**
   * Extract JSON từ LLM response (có thể có text thừa)
   */
  private extractJSON(text: string): any {
    try {
      // Direct parse
      return JSON.parse(text.trim());
    } catch {
      // Extract JSON block nếu có text xung quanh
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /**
   * Fallback regex parser - giữ lại logic cũ làm backup
   */
  private fallbackRegexParse(message: string): ParsedIntent {
    const lowerMsg = this.normalizeVi(message);
    const entities: ParsedIntent['entities'] = {};

    // Extract time entities (explicit + relative)
    const temporal = this.extractTemporalEntities(lowerMsg);
    entities.month = temporal.month ?? this.currentMonth;
    entities.year = temporal.year ?? this.currentYear;
    if (temporal.dateRange) {
      entities.dateRange = temporal.dateRange;
    }

    // Extract threshold: "ngưỡng 25h", "> 30 giờ", "30h"
    const thresholdMatch = lowerMsg.match(/nguong\s*(\d{1,3})\s*h|>\s*(\d{1,3})\s*(?:h|gio)|\b(\d{1,3})\s*h\b/);
    if (thresholdMatch) {
      entities.threshold = parseInt(thresholdMatch[1] || thresholdMatch[2] || thresholdMatch[3], 10);
    }

    // Extract voucher code
    const voucherMatch = message.match(/(AX|PX|CV)(\d+)/i);
    if (voucherMatch) entities.voucherCode = `${voucherMatch[1].toUpperCase()}${voucherMatch[2]}`;

    // Extract GL account
    const glMatch = message.match(/\b(\d{3,4}(?:\.\d{1,3})?)\b/);
    if (glMatch) entities.glAccount = glMatch[1];

    // Extract employee name
    const extractedName = this.extractEmployeeName(message);
    if (extractedName) entities.employeeName = extractedName;

    // Determine intent
    let intent: IntentType = 'general_chat';

    const isCashflow =
      /cashflow|dong tien|bao cao dong tien|luu chuyen tien te|tong thu|tong chi|thu\/?chi|nhom thu|nhom chi|co cau thu|co cau chi|breakdown|dong tien rong|tham hut|lai lo/.test(lowerMsg);
    const isWorkload =
      /workload|self\s*learning|tu hoc|bang cong|tham gia du an|gio log|gio chua phan bo|nhan su/.test(lowerMsg) ||
      (/(thong ke|bao cao)/.test(lowerMsg) && /(team|nhan su|gio|bang cong)/.test(lowerMsg));
    const isAtRisk =
      /at\s*risk|nguy co|vuot nguong|canh bao|sap vuot|bay nguong|do canh bao/.test(lowerMsg);
    const isTeamInsights =
      /insights|tong quan team|nhan xet team|suc khoe team|overall team/.test(lowerMsg);
    const hasVoucherKeyword = /phieu|voucher/.test(lowerMsg);

    if (/(approve|duyet|phe duyet)\b/.test(lowerMsg) && entities.voucherCode) {
      intent = 'approve_voucher';
    } else if (/(reject|tu choi|huy)\b/.test(lowerMsg) && entities.voucherCode) {
      intent = 'reject_voucher';
    } else if (isCashflow) {
      intent = 'query_cashflow_gl';
    } else if (
      entities.employeeName &&
      /(phan tich|analyze|tai sao|vi sao|xem gio|xem bang cong|workload cua)/.test(lowerMsg)
    ) {
      intent = 'analyze_employee';
    } else if (isTeamInsights) {
      intent = 'team_insights';
    } else if (isAtRisk) {
      intent = 'query_at_risk_employees';
    } else if (isWorkload) {
      intent = entities.employeeName ? 'analyze_employee' : 'query_workload_report';
    } else if (/sync|dong bo|cap nhat du lieu|lam moi du lieu|refresh du lieu/.test(lowerMsg)) {
      intent = 'sync_workload';
    } else if (/download|excel|xuat file|tai file|xuat bao cao|gui file/.test(lowerMsg)) {
      intent = 'download_report';
    } else if (/cho|pending|chua duyet|dang cho/.test(lowerMsg)) {
      intent = 'query_pending_vouchers';
    } else if (/(duyet|phe duyet|approval|buoc|status|trang thai)/.test(lowerMsg)) {
      intent = 'query_approval_status';
    } else if (/phieu|voucher/.test(lowerMsg)) {
      intent = entities.voucherCode ? 'query_voucher_detail' : 'count_vouchers';
    } else if (hasVoucherKeyword && /hom nay|today|tuan nay|tuan truoc|thang nay|thang truoc/.test(lowerMsg)) {
      intent = 'query_vouchers_by_date';
    } else if (/tien|so tien|amount|chi bao nhieu|tong chi/.test(lowerMsg)) {
      intent = 'query_amount';
    }

    const confidence =
      intent === 'general_chat'
        ? 0.45
        : entities.employeeName || entities.voucherCode || entities.glAccount
          ? 0.85
          : 0.72;

    return { intent, confidence, entities, rawMessage: message };
  }

  private applyContextInference(
    message: string,
    parsed: ParsedIntent,
    contextHints: ContextHints,
  ): ParsedIntent {
    const normalized = this.normalizeVi(message);
    const explicitTemporal = this.extractTemporalEntities(normalized);

    const hasExplicitTemporal =
      explicitTemporal.month !== undefined ||
      explicitTemporal.year !== undefined ||
      /\b\d{1,2}[\/\-]\d{4}\b|\b20\d{2}[\/\-]\d{1,2}\b|thang\s*\d{1,2}|quy\s*[1-4]|\bq[1-4]\b/.test(normalized);

    const followUpCue = /thang do|ky do|quy do|nguoi do|nhan su do|ban do|con nua|con thi sao|the sao|vay thi|chi tiet hon|chi tiet|breakdown|nua di/.test(
      normalized,
    );

    if (!parsed.entities) parsed.entities = {};

    const shouldInheritTemporal =
      !hasExplicitTemporal &&
      (followUpCue || /thang do|ky do|quy do|nguoi do|nhan su do/.test(normalized));

    if (shouldInheritTemporal) {
      if (contextHints.month !== undefined) {
        parsed.entities.month = contextHints.month;
      }
      if (contextHints.year !== undefined) {
        parsed.entities.year = contextHints.year;
      }
    }

    // "tháng đó/kỳ đó/quý đó" => buộc kế thừa month/year từ context.
    if (/thang do|ky do|quy do/.test(normalized)) {
      if (contextHints.month !== undefined) parsed.entities.month = contextHints.month;
      if (contextHints.year !== undefined) parsed.entities.year = contextHints.year;
    }

    const mentionsEmployeePronoun = /nguoi do|nhan su do|ban do|ban ay|anh ay|chi ay|ho/.test(
      normalized,
    );
    if (mentionsEmployeePronoun && !parsed.entities.employeeName && contextHints.employeeName) {
      parsed.entities.employeeName = contextHints.employeeName;
    }

    if (
      mentionsEmployeePronoun &&
      !!parsed.entities.employeeName &&
      (
        contextHints.intent === 'analyze_employee' ||
        contextHints.intent === 'query_workload_report' ||
        /workload|bang cong|gio log|tu hoc|self\s*learning|nhan su/.test(normalized) ||
        parsed.intent === 'general_chat'
      )
    ) {
      parsed.intent = 'analyze_employee';
      parsed.confidence = Math.max(parsed.confidence, 0.82);
    }

    // Câu follow-up mơ hồ -> giữ cùng intent phiên trước để không rơi general_chat.
    if (parsed.intent === 'general_chat' && followUpCue && contextHints.intent) {
      parsed.intent = contextHints.intent;
      parsed.confidence = Math.max(parsed.confidence, 0.7);
    }

    // Workload follow-up có "người đó" thì ưu tiên analyze_employee.
    if (
      parsed.intent === 'query_workload_report' &&
      parsed.entities.employeeName &&
      /(nguoi do|nhan su do|workload cua|xem gio cua|phan tich)/.test(normalized)
    ) {
      parsed.intent = 'analyze_employee';
      parsed.confidence = Math.max(parsed.confidence, 0.8);
    }

    // Nếu follow-up cashflow nhưng thiếu keyword rõ, kế thừa intent cashflow từ context.
    if (
      parsed.intent === 'general_chat' &&
      followUpCue &&
      contextHints.intent === 'query_cashflow_gl'
    ) {
      parsed.intent = 'query_cashflow_gl';
      parsed.confidence = Math.max(parsed.confidence, 0.72);
    }

    if (!parsed.entities.month) parsed.entities.month = this.currentMonth;
    if (!parsed.entities.year) parsed.entities.year = this.currentYear;

    return parsed;
  }

  private normalizeVi(input: string): string {
    return (input || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .trim();
  }

  private extractEmployeeName(message: string): string | undefined {
    const patterns: RegExp[] = [
      /(?:phân tích|phan tich|analyze|workload của|workload cua|workload cho|bảng công của|bang cong cua|xem giờ của|xem gio cua|xem bảng công của|xem bang cong cua)\s+([A-ZÀ-Ỹ][\p{L}]+(?:\s+[A-ZÀ-Ỹ][\p{L}]+){1,4})/iu,
      /(?:nhân sự|nhan su|tên|ten)\s+([A-ZÀ-Ỹ][\p{L}]+(?:\s+[A-ZÀ-Ỹ][\p{L}]+){1,4})/iu,
    ];

    for (const p of patterns) {
      const m = message.match(p);
      if (m?.[1]) {
        return m[1].trim().replace(/\s+\d[\d\s]*$/, '').trim();
      }
    }

    return undefined;
  }

  private extractTemporalEntities(text: string): {
    month?: number;
    year?: number;
    dateRange?: { from: string; to: string };
  } {
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

    const toDateRange = (year: number, startMonth: number, endMonth: number) => {
      const from = `${year}-${String(startMonth).padStart(2, '0')}-01`;
      const endDate = new Date(year, endMonth, 0).getDate();
      const to = `${year}-${String(endMonth).padStart(2, '0')}-${String(endDate).padStart(2, '0')}`;
      return { from, to };
    };

    if (/thang truoc|thang vua roi|thang vua qua|ky truoc|last month|previous month/.test(text)) {
      return shiftMonth(currentMonth, currentYear, -1);
    }
    if (/thang nay|ky nay|this month|current month/.test(text)) {
      return { month: currentMonth, year: currentYear };
    }
    if (/thang sau|ky sau|next month/.test(text)) {
      return shiftMonth(currentMonth, currentYear, +1);
    }

    if (/quy truoc|last quarter|previous quarter/.test(text)) {
      const currentQuarter = Math.floor((currentMonth - 1) / 3) + 1;
      let q = currentQuarter - 1;
      let y = currentYear;
      if (q <= 0) {
        q = 4;
        y -= 1;
      }
      const startMonth = q * 3 - 2;
      const endMonth = q * 3;
      return { month: endMonth, year: y, dateRange: toDateRange(y, startMonth, endMonth) };
    }
    if (/quy nay|this quarter|current quarter/.test(text)) {
      const q = Math.floor((currentMonth - 1) / 3) + 1;
      const startMonth = q * 3 - 2;
      const endMonth = q * 3;
      return { month: endMonth, year: currentYear, dateRange: toDateRange(currentYear, startMonth, endMonth) };
    }

    const quarterMatch = text.match(/(?:quy|q)\s*([1-4])(?:\s*(?:[\/\-]|nam)?\s*(20\d{2}))?/);
    if (quarterMatch) {
      const q = parseInt(quarterMatch[1], 10);
      const y = quarterMatch[2] ? parseInt(quarterMatch[2], 10) : currentYear;
      const startMonth = q * 3 - 2;
      const endMonth = q * 3;
      return { month: endMonth, year: y, dateRange: toDateRange(y, startMonth, endMonth) };
    }

    const yMonthDash = text.match(/(20\d{2})[-\/](\d{1,2})/);
    if (yMonthDash) {
      const year = parseInt(yMonthDash[1], 10);
      const month = parseInt(yMonthDash[2], 10);
      if (month >= 1 && month <= 12) return { month, year };
    }

    const yMonthSpace = text.match(/(20\d{2})\s+(\d{1,2})(?:\s|$)/);
    if (yMonthSpace) {
      const year = parseInt(yMonthSpace[1], 10);
      const month = parseInt(yMonthSpace[2], 10);
      if (month >= 1 && month <= 12) return { month, year };
    }

    const monthYear = text.match(/(?:thang|thg|t|ky)?\s*(\d{1,2})\s*[\/\-]\s*(20\d{2})/);
    if (monthYear) {
      const month = parseInt(monthYear[1], 10);
      const year = parseInt(monthYear[2], 10);
      if (month >= 1 && month <= 12) return { month, year };
    }

    const monthMatch = text.match(/thang\s*(\d{1,2})|thg\s*(\d{1,2})|\bt\s*(\d{1,2})\b/);
    const yearMatch = text.match(/nam\s*(20\d{2})|(20\d{2})/);
    const month = monthMatch
      ? parseInt(monthMatch[1] || monthMatch[2] || monthMatch[3], 10)
      : undefined;
    const year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2], 10) : undefined;

    if (!month && /nam ngoai|nam truoc|last year|previous year/.test(text)) {
      return { year: currentYear - 1 };
    }
    if (!month && /nam nay|this year|current year/.test(text)) {
      return { year: currentYear };
    }

    if (month !== undefined && month >= 1 && month <= 12) {
      return { month, year: year ?? currentYear };
    }

    return { year };
  }

  private extractContextHints(conversationContext?: string[]): ContextHints {
    if (!conversationContext || conversationContext.length === 0) return {};

    const recentLines = conversationContext.slice(-8);
    const recentText = recentLines.join(' ');
    const normalizedRecent = this.normalizeVi(recentText);

    const lastUserLine = [...recentLines]
      .reverse()
      .find((line) => /nguoi dung\s*:/i.test(line));
    const lastUserMessage = lastUserLine
      ? lastUserLine.replace(/^.*?:\s*/i, '').trim()
      : '';

    const temporal = this.extractTemporalEntities(normalizedRecent);
    const employeeName = this.extractEmployeeName(lastUserMessage || recentText);

    const voucherMatch = recentText.match(/(AX|PX|CV)(\d+)/i);
    const glMatch = recentText.match(/\b(\d{3,4}(?:\.\d{1,3})?)\b/);
    const thresholdMatch = normalizedRecent.match(/nguong\s*(\d{1,3})\s*h|\b(\d{1,3})\s*h\b/);

    const intent = this.detectIntentFromText(lastUserMessage || recentText);

    return {
      intent,
      month: temporal.month,
      year: temporal.year,
      employeeName,
      voucherCode: voucherMatch ? `${voucherMatch[1].toUpperCase()}${voucherMatch[2]}` : undefined,
      glAccount: glMatch ? glMatch[1] : undefined,
      threshold: thresholdMatch
        ? parseInt(thresholdMatch[1] || thresholdMatch[2], 10)
        : undefined,
    };
  }

  private detectIntentFromText(raw: string): IntentType | undefined {
    const text = this.normalizeVi(raw || '');
    if (!text) return undefined;

    if (/cashflow|dong tien|tong thu|tong chi|co cau thu|co cau chi|breakdown/.test(text)) {
      return 'query_cashflow_gl';
    }
    if (/phan tich|analyze|xem gio cua|xem bang cong cua|tai sao/.test(text)) {
      return 'analyze_employee';
    }
    if (/at\s*risk|nguy co|vuot nguong|canh bao|sap vuot/.test(text)) {
      return 'query_at_risk_employees';
    }
    if (/insights|tong quan team|nhan xet team|suc khoe team|overall team/.test(text)) {
      return 'team_insights';
    }
    if (/workload|self\s*learning|tu hoc|bang cong|gio log|tham gia du an/.test(text)) {
      return /phan tich|analyze|workload cua|xem gio cua/.test(text)
        ? 'analyze_employee'
        : 'query_workload_report';
    }
    if (/sync|dong bo|lam moi du lieu|refresh du lieu/.test(text)) {
      return 'sync_workload';
    }
    if (/download|xuat file|excel|tai file|gui file/.test(text)) {
      return 'download_report';
    }
    if (/cho|pending|chua duyet|dang cho/.test(text)) {
      return 'query_pending_vouchers';
    }
    if (/duyet|phe duyet|approval|trang thai|status/.test(text)) {
      return 'query_approval_status';
    }
    if (/phieu|voucher/.test(text)) {
      return 'query_voucher_detail';
    }
    if (/tien|so tien|chi bao nhieu|tong chi/.test(text)) {
      return 'query_amount';
    }

    return undefined;
  }
}
