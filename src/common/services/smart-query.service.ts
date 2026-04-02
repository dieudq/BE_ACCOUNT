import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { accountingBotAPI } from './agent-api-client';
import { ParticipationReportService } from '../../reports/participation.service';
import { NlpIntentService, IntentType } from './nlp-intent.service';
import { ConversationContextService } from './conversation-context.service';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Smart Query Service - Bot có thể trả lời BẤT CỨ câu hỏi về database/backend
 * 1. Parse intent từ câu hỏi
 * 2. Xác định entity (voucher code, account, date, etc)
 * 3. Gọi API phù hợp hoặc query database
 * 4. Format response Vietnamese
 */
@Injectable()
export class SmartQueryService {
  constructor(
    private prisma: PrismaService,
    private participation: ParticipationReportService,
    private nlp: NlpIntentService,
    private context: ConversationContextService,
  ) {}

  /**
   * Main entry - xử lý BẤT CỨ câu hỏi
   * Dùng NLP (LLM-based) để parse intent thay vì regex cứng nhắc
   */
  async answerQuestion(question: string, userId?: string): Promise<string> {
    const sessionId = userId || 'anonymous';

    // Lấy conversation context để LLM hiểu "họ là ai?", "phiếu đó bao nhiêu?"
    const conversationHistory = this.context.getContextSummary(sessionId);

    // Parse intent bằng LLM
    const parsed = await this.nlp.parseIntent(question, conversationHistory);

    // Nếu LLM thấy cần hỏi lại (ambiguous)
    if (parsed.clarificationNeeded) {
      this.context.addTurn(sessionId, 'user', question, parsed.intent);
      this.context.addTurn(sessionId, 'assistant', parsed.clarificationNeeded);
      return parsed.clarificationNeeded;
    }

    // Route to handler dựa trên intent
    const answer = await this.routeByIntent(parsed.intent, parsed.entities, question);

    // Lưu lịch sử hội thoại
    this.context.addTurn(sessionId, 'user', question, parsed.intent);
    this.context.addTurn(sessionId, 'assistant', answer);

    return answer;
  }

  /**
   * Route request đến đúng handler dựa trên intent đã parse
   */
  private async routeByIntent(
    intent: IntentType,
    entities: Record<string, any>,
    rawQuestion: string,
  ): Promise<string> {
    switch (intent) {
      case 'query_pending_vouchers':
        return this.handlePendingQuery(rawQuestion);
      case 'query_approval_status':
        return this.handleApprovalQuery(rawQuestion, entities.voucherCode);
      case 'count_vouchers':
        return this.handleCountQuery(rawQuestion);
      case 'query_voucher_detail':
        return this.handleVoucherQuery(rawQuestion, entities.voucherCode);
      case 'query_vouchers_by_date':
        return this.handleDateRangeQuery(rawQuestion);
      case 'query_amount':
        return this.handleAmountQueryWithEntities(entities.month, entities.year, entities.category);
      case 'query_approver':
        return this.handleApproverQuery(rawQuestion);
      case 'query_history':
        return this.handleHistoryQuery(rawQuestion, entities.voucherCode);
      case 'query_cashflow_gl':
        return this.handleCashflowQuery(rawQuestion, entities.glAccount);
      case 'query_workload_report':
      case 'query_at_risk_employees':
      case 'analyze_employee':
      case 'team_insights':
      case 'download_report':
      case 'sync_workload':
        return this.handleWorkloadQuery(rawQuestion, entities);
      default:
        return this.handleDatabaseSearch(rawQuestion);
    }
  }

  /**
   * Handle pending vouchers questions
   */
  private async handlePendingQuery(question: string): Promise<string> {
    try {
      const result = await accountingBotAPI.getPendingVouchers();
      return result.formatted;
    } catch (error) {
      return `❌ Lỗi lấy phiếu chờ duyệt: ${(error as Error).message}`;
    }
  }

  /**
   * Handle approval/status questions - "Phiếu AX99 ở bước nào?"
   */
  private async handleApprovalQuery(question: string, voucherCode?: string): Promise<string> {
    try {
      // Dùng voucherCode từ NLP parser trước, fallback sang regex
      const code = voucherCode || (() => {
        const m = question.match(/(ax|px|cv)(\d+)/i);
        return m ? `${m[1].toUpperCase()}${m[2]}` : null;
      })();

      if (code) {
        const result = await accountingBotAPI.getVoucherStatus(code);
        return result.formatted;
      }

      const result = await accountingBotAPI.getApprovalsSummary();
      return result.formatted;
    } catch (error) {
      return `❌ Lỗi lấy thông tin duyệt: ${(error as Error).message}`;
    }
  }

  /**
   * Handle counting questions - "Có bao nhiêu phiếu?"
   */
  private async handleCountQuery(question: string): Promise<string> {
    try {
      const lowerQ = question.toLowerCase();

      // "Bao nhiêu phiếu pending/chờ"
      if (lowerQ.includes('pending') || lowerQ.includes('chờ')) {
        const result = await accountingBotAPI.getPendingVouchers();
        return result.formatted;
      }

      // "Bao nhiêu phiếu được duyệt"
      if (lowerQ.includes('được duyệt') || lowerQ.includes('approved')) {
        const result = await accountingBotAPI.getApprovalsSummary();
        return result.formatted;
      }

      // Default: list all
      const result = await accountingBotAPI.listVouchers();
      return result.formatted;
    } catch (error) {
      return `❌ Lỗi đếm: ${(error as Error).message}`;
    }
  }

  /**
   * Handle voucher detail questions
   */
  private async handleVoucherQuery(question: string, voucherCode?: string): Promise<string> {
    try {
      const code = voucherCode || (() => {
        const m = question.match(/(ax|px|cv)(\d+)/i);
        return m ? `${m[1].toUpperCase()}${m[2]}` : null;
      })();

      if (code) {
        const result = await accountingBotAPI.getVoucherStatus(code);
        return result.formatted;
      }

      const result = await accountingBotAPI.listVouchers();
      return result.formatted;
    } catch (error) {
      return `❌ Lỗi lấy chi tiết phiếu: ${(error as Error).message}`;
    }
  }

  /**
   * Handle date range questions
   */
  private async handleDateRangeQuery(question: string): Promise<string> {
    try {
      const lowerQ = question.toLowerCase();

      // "Hôm nay", "today"
      if (lowerQ.includes('hôm nay') || lowerQ.includes('today')) {
        const result = await accountingBotAPI.getTodayVouchers();
        return result.formatted;
      }

      // TODO: Add support for "tuần này", "tháng này", specific date range

      // Default
      const result = await accountingBotAPI.listVouchers();
      return result.formatted;
    } catch (error) {
      return `❌ Lỗi lấy theo ngày: ${(error as Error).message}`;
    }
  }

  /**
   * Handle amount/money questions với entities đã extract sẵn từ NLP
   */
  private async handleAmountQueryWithEntities(
    month?: number,
    year?: number,
    category?: string,
  ): Promise<string> {
    try {
      if (category && month) {
        return await this.queryAmountByMonthAndCategory(month, category, year);
      } else if (month) {
        return await this.queryAmountByMonth(month, year);
      }

      const result = await accountingBotAPI.getTodayVouchers();
      return result.formatted;
    } catch (error) {
      return `❌ Lỗi lấy thông tin tiền: ${(error as Error).message}`;
    }
  }

  /**
   * Handle amount/money questions - "Chi bao nhiêu tháng 1?" "Lương dự án tháng 1?"
   * @deprecated Dùng handleAmountQueryWithEntities thay thế
   */
  private async handleAmountQuery(question: string): Promise<string> {
    try {
      const lowerQ = question.toLowerCase();
      const monthMatch = lowerQ.match(/tháng\s*(\d+)/);
      const month = monthMatch ? parseInt(monthMatch[1]) : null;
      const categoryMatch = lowerQ.match(/(334|dự án|lương|quản lý|sales|marketing)/i);

      if (categoryMatch && month) {
        return await this.queryAmountByMonthAndCategory(month, categoryMatch[0]);
      } else if (month) {
        return await this.queryAmountByMonth(month);
      }

      const result = await accountingBotAPI.getTodayVouchers();
      return result.formatted;
    } catch (error) {
      return `❌ Lỗi lấy thông tin tiền: ${(error as Error).message}`;
    }
  }

  /**
   * Query amount by month and category
   */
  private async queryAmountByMonthAndCategory(month: number, category: string, year?: number): Promise<string> {
    try {
      // Map category to GL account
      const accountMap: { [key: string]: string[] } = {
        '334': ['334.1', '334.2', '334.3', '334.4', '334.5', '334.6', '334.7', '334.8'],
        'dự án': ['334.1', '511'],
        'lương': ['334.1', '334.2', '334.3', '334.4', '334.5', '334.6', '334.7', '334.8'],
        'quản lý': ['6422.5'],
        'sales': ['6421.3', '6421.4', '6421.5', '6421.6'],
        'marketing': ['6421.8', '6421.9'],
      };

      const accounts = accountMap[category.toLowerCase()] || ['334.1'];

      // Query vouchers for this month
      const resolvedYear = year ?? new Date().getFullYear();
      const startDate = new Date(resolvedYear, month - 1, 1);
      const endDate = new Date(resolvedYear, month, 0);

      const vouchers = await this.prisma.voucher.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      if (vouchers.length === 0) {
        return `❌ Không có phiếu chi nào trong tháng ${month}`;
      }

      const totalAmount = vouchers.reduce((sum, v) => sum + (parseInt(v.amount?.toString() || '0') || 0), 0);
      const formattedTotal = totalAmount.toLocaleString('vi-VN');

      return `💰 <b>Chi phí ${category} tháng ${month}/${resolvedYear}:</b> ${formattedTotal} VND\n📊 Số phiếu: ${vouchers.length}`;
    } catch (error) {
      return `❌ Lỗi: ${(error as Error).message}`;
    }
  }

  /**
   * Query amount by month
   */
  private async queryAmountByMonth(month: number, year?: number): Promise<string> {
    try {
      const resolvedYear = year ?? new Date().getFullYear();
      const startDate = new Date(resolvedYear, month - 1, 1);
      const endDate = new Date(resolvedYear, month, 0);

      const vouchers = await this.prisma.voucher.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      if (vouchers.length === 0) {
        return `✅ Không có phiếu chi nào trong tháng ${month}`;
      }

      const totalAmount = vouchers.reduce((sum, v) => sum + (parseInt(v.amount?.toString() || '0') || 0), 0);
      const formattedTotal = totalAmount.toLocaleString('vi-VN');
      const approved = vouchers.filter((v) => v.status === 'approved').length;

      return `💰 <b>Tháng ${month}/${resolvedYear}:</b> ${formattedTotal} VND\n📊 Số phiếu: ${vouchers.length} (✅ ${approved} đã duyệt)`;
    } catch (error) {
      return `❌ Lỗi: ${(error as Error).message}`;
    }
  }

  /**
   * Handle history questions
   */
  private async handleHistoryQuery(question: string, voucherCode?: string): Promise<string> {
    try {
      const code = voucherCode || (() => {
        const m = question.match(/(ax|px|cv)(\d+)/i);
        return m ? `${m[1].toUpperCase()}${m[2]}` : null;
      })();

      if (code) {
        const result = await accountingBotAPI.getVoucherStatus(code);
        return result.formatted;
      }

      return `❌ Vui lòng chỉ định mã phiếu (e.g., AX99)`;
    } catch (error) {
      return `❌ Lỗi lấy lịch sử: ${(error as Error).message}`;
    }
  }

  /**
   * Handle cashflow/GL questions với entities từ NLP
   */
  private async handleCashflowQuery(question: string, glAccount?: string): Promise<string> {
    try {
      if (glAccount) {
        return await this.getGLAccountMapping(glAccount);
      }

      // Fallback: regex extract
      const accountMatch = question.match(/(\d+\.?\d*)/);
      if (accountMatch) {
        return await this.getGLAccountMapping(accountMatch[0]);
      }

      const result = await accountingBotAPI.getCashflowInfo();
      return result.formatted;
    } catch (error) {
      return `❌ Lỗi lấy cashflow: ${(error as Error).message}`;
    }
  }

  /**
   * Handle approver questions - "Chờ ai duyệt?"
   */
  private async handleApproverQuery(question: string): Promise<string> {
    try {
      // Extract voucher code
      const voucherMatch = question.match(/(ax|px|cv)(\d+)/i);
      if (voucherMatch) {
        const code = `${voucherMatch[1].toUpperCase()}${voucherMatch[2]}`;
        const result = await accountingBotAPI.getVoucherStatus(code);
        return result.formatted;
      }

      // Otherwise pending
      const result = await accountingBotAPI.getPendingVouchers();
      return result.formatted;
    } catch (error) {
      return `❌ Lỗi lấy người duyệt: ${(error as Error).message}`;
    }
  }

  /**
   * Get GL account mapping - NGẮN GỌN
   */
  private async getGLAccountMapping(accountCode: string): Promise<string> {
    try {
      const cashflowFile = path.join(
        process.cwd(),
        '..',
        'cashflow-data-2026-04.json',
      );

      if (!fs.existsSync(cashflowFile)) {
        return `❌ Không có file mapping`;
      }

      const data = JSON.parse(fs.readFileSync(cashflowFile, 'utf-8'));
      const mapping = data.cashflow?.glAccountMappings?.[accountCode];

      if (!mapping) {
        return `❌ Tài khoản ${accountCode} không tìm thấy`;
      }

      // NGẮN GỌN - không dài dòng
      if (mapping.mapped) {
        return `✅ Tài khoản <b>${accountCode}</b>: ${mapping.name}\n→ Map vào: <b>${mapping.category}</b> (Row ${mapping.row})`;
      } else {
        return `⚠️ Tài khoản <b>${accountCode}</b>: ${mapping.name}\n→ Không được map (${mapping.reason})`;
      }
    } catch (error) {
      return `❌ Lỗi: ${(error as Error).message}`;
    }
  }

  /**
   * Handle workload / participation queries
   * Nhận entities đã parse từ NLP hoặc fallback tự extract
   */
  private async handleWorkloadQuery(question: string, entities?: Record<string, any>): Promise<string> {
    try {
      const lowerQ = question.toLowerCase();
      const now = new Date();

      // Ưu tiên dùng entities từ NLP parser
      const month = entities?.month ?? (() => {
        const m = lowerQ.match(/tháng\s*(\d{1,2})/);
        return m ? parseInt(m[1], 10) : now.getMonth() + 1;
      })();
      const year = entities?.year ?? (() => {
        const m = lowerQ.match(/năm\s*(\d{4})|(\d{4})/);
        return m ? parseInt(m[1] || m[2], 10) : now.getFullYear();
      })();
      const employeeName: string | undefined = entities?.employeeName;

      // analyze_employee intent
      if (employeeName) {
        // Delegate thêm phân tích chi tiết cho WorkloadAnalysisService nếu cần
        const risks = await this.participation.getAtRiskEmployees(year, month, 30);
        const emp = risks.find(
          (r) => r.employeeName.toLowerCase().includes(employeeName.toLowerCase()),
        );
        if (!emp) {
          return `❌ Không tìm thấy nhân sự "${employeeName}" trong tháng ${month}/${year}`;
        }
        return `👤 <b>${emp.employeeName}</b> tháng ${month}/${year}:\n• Self-learning: ${emp.selfLearningHours.toFixed(1)}h\n• Dự án: ${(emp as any).projectHours?.toFixed(1) ?? 'N/A'}h`;
      }

      // "Ai sắp vượt / at-risk"
      if (/sắp|at.risk|ngưỡng|vượt|cảnh báo/.test(lowerQ)) {
        const risks = await this.participation.getAtRiskEmployees(year, month, 30);
        if (risks.length === 0) {
          return `✅ Tháng ${month}/${year}: Không có nhân sự nào có nguy cơ vượt ngưỡng 30h self-learning.`;
        }
        let msg = `⚠️ <b>Tháng ${month}/${year} — Nhân sự có nguy cơ vượt ngưỡng 30h:</b>\n\n`;
        for (const r of risks) {
          const exceeded = r.selfLearningHours > 30;
          msg += `${exceeded ? '🔴' : '🟡'} <b>${r.employeeName}</b>: ${r.selfLearningHours.toFixed(1)}h self-learning`;
          if (exceeded) msg += ' <b>(Đã vượt!)</b>';
          msg += '\n';
        }
        return msg;
      }

      // Return full report

      // Default: full report summary
      const report = await this.participation.generateMonthlyReport(year, month);
      if (report.rows.length === 0) {
        return `❌ Tháng ${month}/${year}: Chưa có dữ liệu. Hãy sync dữ liệu trước bằng lệnh /sync_workload.`;
      }

      let msg = `📊 <b>Báo cáo workload tháng ${month}/${year}</b>\n`;
      msg += `👥 Tổng nhân sự: ${report.rows.length}\n`;
      msg += `⚠️ Vượt ngưỡng 30h: ${report.alerts.length} người\n\n`;

      if (report.alerts.length > 0) {
        msg += `🔴 <b>Nhân sự vượt ngưỡng:</b>\n`;
        for (const a of report.alerts) {
          msg += `• ${a.employeeName}: ${a.hours.toFixed(1)}h self-learning\n`;
        }
        msg += '\n';
      }

      // Top 3 lowest actual logged
      const sorted = [...report.rows].sort((a, b) => a.projectHours - b.projectHours);
      msg += `📉 <b>Log ít nhất:</b>\n`;
      for (const r of sorted.slice(0, 3)) {
        msg += `• ${r.employeeName}: ${r.projectHours.toFixed(1)}h log / ${r.standardHours.toFixed(0)}h chuẩn (${r.selfLearningPercent.toFixed(1)}% self-learning)\n`;
      }

      return msg;
    } catch (error) {
      return `❌ Lỗi workload query: ${(error as Error).message}`;
    }
  }

  /**
   * Fallback: Database search for any query
   */
  private async handleDatabaseSearch(question: string): Promise<string> {
    try {
      // Try to find relevant vouchers by description
      const vouchers = await this.prisma.voucher.findMany({
        where: {
          reason: {
            contains: question.substring(0, 50),
            mode: 'insensitive',
          },
        },
        take: 5,
      });

      if (vouchers.length === 0) {
        return `❌ Không tìm thấy kết quả cho: "${question}"\n\nGợi ý: Hỏi về phiếu chi, duyệt, tài khoản, cashflow...`;
      }

      let response = `📋 PHIẾU CHI LIÊN QUAN\n\n`;
      for (const v of vouchers) {
        const amt = v.amount ? parseInt(v.amount.toString()).toLocaleString('vi-VN') : '0';
        response += `🎫 <b>${v.voucherNumber}</b> • ${amt} VND\n`;
        response += `   ${v.reason}\n`;
      }

      return response;
    } catch (error) {
      return `❌ Lỗi tìm kiếm: ${(error as Error).message}`;
    }
  }
}
