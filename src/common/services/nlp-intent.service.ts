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

        return {
          ...parsed,
          rawMessage: message,
          confidence: parsed.confidence ?? 0.8,
        };
      }
    } catch (err) {
      this.logger.warn(`LLM intent parsing failed, using fallback: ${err.message}`);
    }

    // Fallback: regex-based (backup khi LLM lỗi)
    return this.fallbackRegexParse(message);
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
    const lowerMsg = message.toLowerCase();
    const entities: ParsedIntent['entities'] = {};

    // Extract time entities
    const monthMatch = lowerMsg.match(/tháng\s*(\d{1,2})/);
    const yearMatch = lowerMsg.match(/năm\s*(\d{4})|(\d{4})/);
    entities.month = monthMatch ? parseInt(monthMatch[1]) : this.currentMonth;
    entities.year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : this.currentYear;

    // Extract voucher code
    const voucherMatch = message.match(/(AX|PX|CV)(\d+)/i);
    if (voucherMatch) entities.voucherCode = `${voucherMatch[1].toUpperCase()}${voucherMatch[2]}`;

    // Extract employee name
    const nameMatch = message.match(/(?:phân tích|tại sao|vì sao|analyze)\s+(.+?)(?:\s+tháng|\s+năm|$)/i);
    if (nameMatch) entities.employeeName = nameMatch[1].trim();

    // Determine intent
    let intent: IntentType = 'general_chat';

    if (/phân tích|tại sao|vì sao|analyze/.test(lowerMsg) && entities.employeeName) {
      intent = 'analyze_employee';
    } else if (/insights|tổng quan team|nhận xét team/.test(lowerMsg)) {
      intent = 'team_insights';
    } else if (/sắp vượt|at.risk|ngưỡng|cảnh báo workload/.test(lowerMsg)) {
      intent = 'query_at_risk_employees';
    } else if (/workload|self.learning|tự học|tham gia dự án/.test(lowerMsg)) {
      intent = entities.employeeName ? 'analyze_employee' : 'query_workload_report';
    } else if (/sync|đồng bộ/.test(lowerMsg)) {
      intent = 'sync_workload';
    } else if (/download|excel|xuất file/.test(lowerMsg)) {
      intent = 'download_report';
    } else if (/chờ|pending|chưa duyệt|đang chờ/.test(lowerMsg)) {
      intent = 'query_pending_vouchers';
    } else if (/(duyệt|phê duyệt|approval|bước|status)/.test(lowerMsg)) {
      intent = entities.voucherCode ? 'query_approval_status' : 'query_approval_status';
    } else if (/cashflow|tài khoản|gl account/.test(lowerMsg)) {
      intent = 'query_cashflow_gl';
    } else if (/phiếu|voucher/.test(lowerMsg)) {
      intent = entities.voucherCode ? 'query_voucher_detail' : 'count_vouchers';
    } else if (/hôm nay|tuần|tháng|today/.test(lowerMsg)) {
      intent = 'query_vouchers_by_date';
    } else if (/tiền|số tiền|amount|chi bao nhiêu/.test(lowerMsg)) {
      intent = 'query_amount';
    }

    return { intent, confidence: 0.5, entities, rawMessage: message };
  }
}
