import { Injectable } from '@nestjs/common';
import Groq from 'groq-sdk';
import * as path from 'path';
import * as fs from 'fs';
import * as ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ERPClientService } from '../common/services/erp-client.service';

// Cache context theo userId: lưu data đã fetch để dùng cho follow-up
interface UserSession {
  lastContext: string;      // raw data context từ lần trước
  lastIntent: string;
  lastMonth: number;
  lastYear: number;
  updatedAt: number;
}

@Injectable()
export class GroqService {
  private groq: Groq;
  private cachedCashflowData: any = null;
  private userSessions = new Map<string, UserSession>();
  private readonly SESSION_TTL = 15 * 60 * 1000; // 15 phút

  constructor(
    private prisma: PrismaService,
    private erp: ERPClientService,
  ) {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }

  private getSession(userId: string): UserSession | null {
    const s = this.userSessions.get(userId);
    if (!s) return null;
    if (Date.now() - s.updatedAt > this.SESSION_TTL) {
      this.userSessions.delete(userId);
      return null;
    }
    return s;
  }

  private saveSession(userId: string, context: string, intent: string, month: number, year: number) {
    this.userSessions.set(userId, { lastContext: context, lastIntent: intent, lastMonth: month, lastYear: year, updatedAt: Date.now() });
  }

  /**
   * Detect multiple months trong câu hỏi: "tháng 1,2,3" hoặc "tháng 1 đến 3"
   */
  private extractMultipleMonths(message: string): Array<{ month: number; year: number }> | null {
    const now = new Date();
    const yearMatch = message.match(/(?:năm\s*)?(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1]) : now.getFullYear();

    // "tháng 1,2,3,4" hoặc "tháng 1, 2, 3"
    const listMatch = message.match(/tháng\s*([\d\s,và]+)/i);
    if (listMatch) {
      const months = listMatch[1].split(/[,\s và]+/).map(Number).filter(n => n >= 1 && n <= 12);
      if (months.length > 1) return months.map(m => ({ month: m, year }));
    }

    // "tháng 1 đến 4" hoặc "tháng 1-4"
    const rangeMatch = message.match(/tháng\s*(\d+)\s*(?:đến|tới|-)\s*(\d+)/i);
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1]);
      const to = parseInt(rangeMatch[2]);
      if (from >= 1 && to <= 12 && from <= to) {
        return Array.from({ length: to - from + 1 }, (_, i) => ({ month: from + i, year }));
      }
    }

    return null;
  }

  /**
   * Detect nếu đây là follow-up question dựa vào context trước
   */
  private isFollowUp(message: string): boolean {
    const lowerMsg = message.toLowerCase();
    return (
      lowerMsg.includes('ai cao nhất') || lowerMsg.includes('ai thấp nhất') ||
      lowerMsg.includes('trung bình') || lowerMsg.includes('tổng cộng') ||
      lowerMsg.includes('trong số đó') || lowerMsg.includes('còn ai') ||
      lowerMsg.includes('đó là') || lowerMsg.includes('những người') ||
      // Action follow-up: thực hiện hành động dựa trên kết quả vừa hiện
      lowerMsg.includes('gửi cảnh báo') || lowerMsg.includes('nhắn tin') ||
      lowerMsg.includes('notify') || lowerMsg.includes('thông báo cho') ||
      lowerMsg.includes('người đó') || lowerMsg.includes('người này') ||
      /^(và |còn |thêm |vậy |thế )/.test(lowerMsg) ||
      (lowerMsg.length < 40 && !lowerMsg.includes('tháng') && !lowerMsg.includes('phiếu'))
    );
  }

  /**
   * Escape markdown special characters for Telegram
   */
  private escapeMarkdown(text: string): string {
    return text
      .replace(/[_*\[\]()~`>#+=|{}.!-]/g, match => {
        // Escape these special characters for Markdown
        return `\\${match}`;
      });
  }

  /**
   * Escape HTML special characters for Telegram HTML mode
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Convert markdown-like text to plain text (safer for Telegram)
   */
  private toPlainText(text: string): string {
    return text
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold **text** -> text
      .replace(/\*([^*]+)\*/g, '$1') // Italic *text* -> text
      .replace(/`([^`]+)`/g, '$1') // Code `text` -> text
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Links [text](url) -> text
      .replace(/_+/g, '-'); // Underscores to dashes
  }

  /**
   * Remove VND/currency formatting from text
   */
  private removeCurrencyFormatting(text: string): string {
    return text
      .replace(/\s+VNĐ/g, '') // Remove " VNĐ"
      .replace(/\s+VND/g, '') // Remove " VND"
      .replace(/\s+đ(?=\s|$)/g, ''); // Remove standalone "đ"
  }

  /**
   * Fuzzy search - tìm dòng gần giống tên
   */
  private fuzzySearch(searchTerm: string, rowLabels: string[]): string | null {
    const search = searchTerm.toLowerCase();

    // 1. Exact match
    const exact = rowLabels.find(label => label.toLowerCase() === search);
    if (exact) return exact;

    // 2. Contains match
    const contains = rowLabels.find(label => label.toLowerCase().includes(search));
    if (contains) return contains;

    // 3. Similarity search - từng từ
    const searchWords = search.split(' ').filter(w => w.length > 2);
    const matches = rowLabels.map(label => {
      const labelWords = label.toLowerCase().split(' ');
      const matchCount = searchWords.filter(sw =>
        labelWords.some(lw => lw.includes(sw) || sw.includes(lw))
      ).length;
      return { label, matchCount };
    }).filter(m => m.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount);

    return matches.length > 0 ? matches[0].label : null;
  }

  /**
   * Lấy giá trị cột từ cached data
   */
  private getCashflowValue(rowLabel: string, columnName: string): any {
    if (!this.cachedCashflowData) return null;

    const { rowData, columnHeaders } = this.cachedCashflowData;

    // Tìm dòng gần đúng
    const searchedRow = this.fuzzySearch(rowLabel, Object.keys(rowData));
    if (!searchedRow) return null;

    const row = rowData[searchedRow];

    // Tìm cột gần đúng
    const colSearch = columnName.toLowerCase();
    const foundCol = Object.entries(columnHeaders).find(([_, name]) => {
      const colName = String(name).toLowerCase();
      return colName.includes(colSearch) || colSearch.includes(colName);
    });

    if (!foundCol) return null;
    const colIdx = parseInt(foundCol[0]);
    return { value: row[colIdx], rowLabel: searchedRow, colName: foundCol[1] };
  }

  /**
   * Extract month/year từ message người dùng.
   * Ví dụ: "tháng 1", "tháng 01", "01/2026", "January 2026"
   */
  private extractMonthYear(message: string): { month: number; year: number } {
    const now = new Date();
    const lowerMsg = message.toLowerCase();

    const monthMatch = lowerMsg.match(/tháng\s*(\d{1,2})/);
    const yearMatch = lowerMsg.match(/(?:năm\s*)?(\d{4})/);

    const month = monthMatch ? parseInt(monthMatch[1], 10) : now.getMonth() + 1;
    const year = yearMatch ? parseInt(yearMatch[1], 10) : now.getFullYear();

    // Sanity check
    return {
      month: month >= 1 && month <= 12 ? month : now.getMonth() + 1,
      year: year >= 2020 && year <= 2100 ? year : now.getFullYear(),
    };
  }

  async chat(message: string, userId?: string): Promise<string> {
    try {
      const sessionId = userId || 'anonymous';

      // 1. Detect intent (không block off_topic cứng - LLM tự xử lý)
      const intent = await this.detectIntent(message);

      // 2. Follow-up detection — ưu tiên session context khi phù hợp
      const session = this.getSession(sessionId);
      const { month, year } = this.extractMonthYear(message);

      if (session) {
        const sameTimePeriod = session.lastMonth === month && session.lastYear === year;

        // 2a. Explicit follow-up keywords
        if (this.isFollowUp(message)) {
          return await this.callLLM(message, session.lastContext, intent, session.lastMonth, session.lastYear);
        }

        // 2b. Hỏi cùng kỳ tháng + cùng nhóm intent (workload/hours/ranking hoặc finance)
        const WORKLOAD_FAMILY = new Set(['workload', 'hours', 'ranking', 'employees', 'general']);
        const FINANCE_FAMILY = new Set(['vouchers', 'cashflow', 'financial', 'general']);
        const sameFamily =
          (WORKLOAD_FAMILY.has(session.lastIntent) && WORKLOAD_FAMILY.has(intent)) ||
          (FINANCE_FAMILY.has(session.lastIntent) && FINANCE_FAMILY.has(intent));

        if (sameTimePeriod && sameFamily) {
          return await this.callLLM(message, session.lastContext, intent, session.lastMonth, session.lastYear);
        }

        // 2c. Hỏi về nhân viên cụ thể có tên trong session context
        const employeeNameForCheck = await this.extractEmployeeName(message);
        if (employeeNameForCheck && session.lastContext.includes(employeeNameForCheck)) {
          return await this.callLLM(message, session.lastContext, intent, session.lastMonth, session.lastYear);
        }
      }

      // 3. Multi-month query: "tháng 1,2,3,4"
      const multiMonths = this.extractMultipleMonths(message);
      if (multiMonths && multiMonths.length > 1) {
        return await this.handleMultiMonthQuery(message, intent, multiMonths, sessionId);
      }

      // 4. Single query bình thường
      const employeeName = await this.extractEmployeeName(message);
      let context = await this.getDynamicContext(intent, userId, employeeName, month, year);

      // Escape context để tránh lỗi Markdown
      context = this.toPlainText(context);

      // Loại bỏ tất cả định dạng tiền tệ
      context = this.removeCurrencyFormatting(context);

      // 2. Gọi Groq API với ngữ cảnh đã được lọc
      const completion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: `Bạn là trợ lý kế toán và HR của công ty Twendee. Chỉ trả lời các câu hỏi liên quan đến: kế toán, phiếu chi, workload nhân sự, giờ làm việc, nghỉ phép, dự án nội bộ.

DỮ LIỆU HỆ THỐNG (${intent.toUpperCase()}${['workload', 'hours', 'vouchers', 'financial', 'cashflow'].includes(intent) ? ` - tháng ${month}/${year}` : ''}):
${context}

HƯỚNG DẪN:
- Ưu tiên trả lời dựa trên dữ liệu trên. Nếu câu hỏi yêu cầu tính toán (max, min, trung bình), hãy tự tính từ dữ liệu đã có.
- Nếu câu hỏi ngoài lề (không liên quan dữ liệu), vẫn trả lời ngắn gọn và tự nhiên như một trợ lý thân thiện.
- Không bịa số liệu. Nếu thiếu data → nói rõ.
- Trả lời tiếng Việt, súc tích.`,
          },
          {
            role: 'user',
            content: message,
          },
        ],
        model: 'llama-3.3-70b-versatile',
      });

      let response = completion.choices[0]?.message?.content || 'Xin loi, toi khong the xu ly yeu cau nay.';

      response = this.toPlainText(response);
      response = this.removeCurrencyFormatting(response);

      // Lưu session để dùng cho follow-up
      this.saveSession(sessionId, context, intent, month, year);

      return response;
    } catch (error) {
      console.error('Groq Error:', error);
      return `Lỗi hệ thống: ${(error as Error).message}`;
    }
  }

  /**
   * Gọi LLM với context đã có sẵn (dùng cho follow-up và multi-month)
   */
  private async callLLM(message: string, context: string, intent: string, month: number, year: number): Promise<string> {
    const completion = await this.groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `Bạn là trợ lý của công ty Twendee. Trả lời dựa trên dữ liệu sau:\n\n${context}\n\nTrả lời ngắn gọn, bằng tiếng Việt.`,
        },
        { role: 'user', content: message },
      ],
      model: 'llama-3.3-70b-versatile',
      max_tokens: 800,
    });

    let response = completion.choices[0]?.message?.content || '';
    return this.toPlainText(this.removeCurrencyFormatting(response));
  }

  /**
   * Xử lý query nhiều tháng: fetch tất cả rồi tổng hợp
   */
  private async handleMultiMonthQuery(
    message: string,
    intent: string,
    months: Array<{ month: number; year: number }>,
    sessionId: string,
  ): Promise<string> {
    const results = await Promise.allSettled(
      months.map(async ({ month, year }) => {
        const ctx = await this.getDynamicContext(intent, sessionId, null, month, year);
        return { month, year, ctx };
      }),
    );

    // Gộp tất cả context lại
    const combinedContext = results
      .map((r) => {
        if (r.status === 'fulfilled') {
          return `=== Tháng ${r.value.month}/${r.value.year} ===\n${r.value.ctx}`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');

    // Lưu session với combined context
    const lastMonth = months[months.length - 1];
    this.saveSession(sessionId, combinedContext, intent, lastMonth.month, lastMonth.year);

    return await this.callLLM(message, combinedContext, intent, lastMonth.month, lastMonth.year);
  }

  private async extractEmployeeName(message: string): Promise<string | null> {
    // Từ nghi vấn/động từ — không phải tên người
    const QUESTION_STARTERS = ['nào', 'ai', 'gì', 'bị', 'có', 'không', 'là', 'được', 'những', 'các', 'mấy', 'sao', 'tại'];

    const patterns = [
      /(?:nhân viên|anh|chị|ông|bà|Mr|Ms|Mrs)\s+([A-Za-zÀ-ỿ\s]+?)(?:\s+(?:có|tháng|năm|như|nào|gì|là|được)|\?|$)/i,
      /(?:của|thuộc)\s+([A-Za-zÀ-ỿ\s]+?)(?:\s+(?:có|tháng|năm)|\?|$)/i,
      /([A-Za-zÀ-ỿ]+)\s+(?:bao nhiêu|như thế nào|cơ chế|làm gì|là ai|khác gì)/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        const captured = match[1].trim();
        const firstWord = captured.split(/\s+/)[0].toLowerCase();
        // Bỏ qua nếu bắt đầu bằng từ nghi vấn hoặc quá dài (không phải tên thật)
        if (QUESTION_STARTERS.includes(firstWord)) continue;
        if (captured.split(/\s+/).length > 5) continue;
        return captured;
      }
    }
    return null;
  }

  private async detectIntent(message: string): Promise<'cashflow' | 'vouchers' | 'projects' | 'workload' | 'employees' | 'leaves' | 'hours' | 'financial' | 'chat_history' | 'system_overview' | 'ranking' | 'comparison' | 'general'> {
    const msg = message.toLowerCase();
    
    // 0. Intent: Ranking/Comparison (ai cao nhất, ai thấp nhất, top 3, v.v.)
    if (msg.includes('cao nhất') || msg.includes('thấp nhất') || msg.includes('lớn nhất') || msg.includes('nhỏ nhất') ||
        msg.includes('nhiều nhất') || msg.includes('ít nhất') || msg.includes('ai vượt') || msg.includes('top') ||
        msg.includes('xếp hạng') || msg.includes('ranking') || msg.includes('so sánh') && (msg.includes('nhân viên') || msg.includes('người'))) {
      return 'ranking';
    }

    // 1. Intent: Workload (Báo cáo self-learning)
    if (msg.includes('workload') || msg.includes('self-learning') || 
        msg.includes('ngưỡng 30h') || msg.includes('cảnh báo') || msg.includes('thời gian học')) {
      return 'workload';
    }

    // 2. Intent: Employees (Thông tin nhân sự) - ưu tiên trước leaves
    if ((msg.includes('nhân sự') || msg.includes('employee') || msg.includes('staff') ||
        msg.includes('nhân viên') || msg.includes('danh sách')) && !msg.includes('phép')) {
      return 'employees';
    }

    // 3. Intent: Hours (Giờ làm việc, tham gia dự án)
    if (msg.includes('giờ') || msg.includes('hour') || msg.includes('tham gia') || 
        msg.includes('participation') || msg.includes('logged')) {
      return 'hours';
    }

    // 4. Intent: Leaves (Nghỉ phép, phép năm) - cần rõ ràng
    if (msg.includes('nghỉ') || msg.includes('phép') || msg.includes('leave') ||
        msg.includes('quota') || msg.includes('absence') || msg.includes('phép còn')) {
      return 'leaves';
    }

    // 5. Intent: CASHFLOW (ưu tiên - từ khóa rõ ràng)
    // "cashflow", "dòng tiền", "thu chi", "chi tiêu", "lợi nhuận", "doanh thu"
    if (msg.includes('cashflow') || msg.includes('dòng tiền') || msg.includes('thu chi') ||
        msg.includes('chi tiêu') || msg.includes('lợi nhuận') || msg.includes('doanh thu') ||
        msg.includes('revenue') || (msg.includes('expense') && !msg.includes('voucher'))) {
      return 'cashflow';
    }

    // 6. Intent: Financial Reports (Báo cáo tài chính, sổ cái)
    if (msg.includes('báo cáo tài chính') || msg.includes('financial') || msg.includes('journal') || 
        msg.includes('ledger') || msg.includes('trial balance') || msg.includes('sổ cái') ||
        msg.includes('phiếu ghi sổ')) {
      return 'financial';
    }

    // 7. Intent: VOUCHERS (phiếu chi) - phải rõ ràng
    // "phiếu", "duyệt", "voucher", "phê duyệt", "phiếu chi"
    if (msg.includes('phiếu') || msg.includes('duyệt') || msg.includes('voucher') ||
        msg.includes('phê duyệt') || msg.includes('phiếu chi')) {
      return 'vouchers';
    }

    // 8. Intent: Projects
    if (msg.includes('dự án') || msg.includes('project')) {
      return 'projects';
    }

    // 9. Intent: Chat History
    if (msg.includes('lịch sử') || msg.includes('history') || msg.includes('chat')) {
      return 'chat_history';
    }

    // 10. Intent: System Overview
    if (msg.includes('tổng quan') || msg.includes('overview') || msg.includes('tổng') || msg.includes('thống kê')) {
      return 'system_overview';
    }

    // 11. Intent: OFF_TOPIC - chỉ chặn các chủ đề RÕ RÀNG ngoài domain
    // Cẩn thận: không chặn các câu hỏi về hệ thống, user, thống kê nội bộ
    const isOffTopic = (
      msg.includes('phim') || msg.includes('movie') || msg.includes('cinema') || msg.includes('rạp chiếu') ||
      msg.includes('bóng đá') || msg.includes('thể thao') || msg.includes('sport') ||
      msg.includes('thời tiết') || msg.includes('weather') ||
      msg.includes('nhà hàng') || msg.includes('restaurant') ||
      msg.includes('du lịch') || msg.includes('travel') || msg.includes('khách sạn') ||
      msg.includes('mua sắm') || msg.includes('shopping') ||
      msg.includes('nấu ăn') || msg.includes('recipe') ||
      (msg.includes('game') && !msg.includes('game thủ') && !msg.includes('gaming')) ||
      msg.includes('âm nhạc') || msg.includes('ca sĩ') || msg.includes('singer') ||
      msg.includes('ca nhạc') || msg.includes('idol')
    );
    // Không chặn nếu có từ khóa nội bộ đi kèm
    const hasInternalKeyword = msg.includes('nhân viên') || msg.includes('nhân sự') || msg.includes('dự án') ||
      msg.includes('công ty') || msg.includes('twendee') || msg.includes('user') || msg.includes('telegram') ||
      msg.includes('thống kê') || msg.includes('báo cáo') || msg.includes('hệ thống');
    if (isOffTopic && !hasInternalKeyword) {
      return 'off_topic' as any;
    }

    return 'general';
  }

  private async getDynamicContext(
    intent: string,
    userId?: string,
    employeeName?: string | null,
    month?: number,
    year?: number,
  ): Promise<string> {
    // Nếu hỏi về nhân viên cụ thể, ưu tiên lấy context cá nhân
    if (employeeName && intent !== 'ranking') {
      return await this.getPersonalDetailContext(employeeName);
    }

    if (intent === 'ranking') {
      return await this.getRankingContext();
    }

    if (intent === 'cashflow') {
      await this.getLatestCashflowSummary();
      return this.cachedCashflowData?.summary || 'Không có dữ liệu Cashflow';
    }

    if (intent === 'vouchers') {
      // Truyền month/year và message để extract department nếu có
      return await this.getVouchersContext(month, year);
    }

    if (intent === 'projects') {
      return await this.getProjectsContext();
    }

    if (intent === 'workload') {
      // Truyền month/year để lấy đúng tháng user hỏi
      return await this.getWorkloadContext(month, year);
    }

    if (intent === 'employees') {
      return await this.getEmployeesContext();
    }

    if (intent === 'hours') {
      // Truyền month/year để lấy đúng tháng user hỏi
      return await this.getEmployeeHoursContext(month, year);
    }

    if (intent === 'leaves') {
      return await this.getLeavesContext();
    }

    if (intent === 'financial') {
      return await this.getFinancialContext();
    }

    if (intent === 'chat_history') {
      return await this.getChatHistoryContext();
    }

    if (intent === 'system_overview') {
      return await this.getSystemOverviewContext();
    }

    return await this.getSystemOverviewContext();
  }

  private async getRankingContext(): Promise<string> {
    try {
      const now = new Date();
      const curYear = now.getFullYear();
      const curMonth = now.getMonth() + 1;

      const [empHours, topLeaves] = await Promise.all([
        this.prisma.employeeHours.findMany({
          where: { year: curYear, month: curMonth },
          orderBy: { loggedHours: 'desc' },
          include: { user: { select: { name: true, department: true } } },
        }),
        this.prisma.leaveQuota.findMany({
          where: { year: curYear },
          orderBy: { usedDays: 'desc' },
          take: 10,
          include: { user: true },
        }),
      ]);

      let context = `\n${'='.repeat(70)}\n`;
      context += `BẢNG XẾP HẠNG & SO SÁNH NHÂN VIÊN THÁNG ${curMonth}/${curYear}\n`;
      context += `${'='.repeat(70)}\n\n`;

      if (empHours.length > 0) {
        // Tính self-learning cho mỗi nhân viên
        const withSL = empHours.map((h) => ({
          name: h.user.name,
          logged: parseFloat(h.loggedHours?.toString() ?? '0'),
          std: parseFloat(h.stdHours?.toString() ?? '160'),
          sl: Math.max(0, parseFloat(h.stdHours?.toString() ?? '160') - parseFloat(h.loggedHours?.toString() ?? '0')),
        }));

        // Top 10 self-learning cao nhất (vượt ngưỡng)
        const topSL = [...withSL].sort((a, b) => b.sl - a.sl).slice(0, 10);
        context += `🔴 TOP 10 SELF-LEARNING CAO NHẤT (có nguy cơ vượt ngưỡng):\n`;
        topSL.forEach((e, i) => {
          const flag = e.sl > 30 ? '⚠️ VƯỢT NGƯỠNG' : '';
          context += `  ${i + 1}. ${e.name}: ${e.sl.toFixed(1)}h self-learning ${flag}\n`;
        });
        context += '\n';

        // Top 10 giờ logged cao nhất
        const topLogged = [...withSL].sort((a, b) => b.logged - a.logged).slice(0, 10);
        context += `⏰ TOP 10 GIỜ LOG DỰ ÁN CAO NHẤT:\n`;
        topLogged.forEach((e, i) => {
          context += `  ${i + 1}. ${e.name}: ${e.logged.toFixed(1)}h logged\n`;
        });
        context += '\n';

        // Bottom 5 logged thấp nhất
        const bottomLogged = [...withSL].sort((a, b) => a.logged - b.logged).slice(0, 5);
        context += `✅ 5 NHÂN VIÊN LOG THẤP NHẤT:\n`;
        bottomLogged.forEach((e, i) => {
          context += `  ${i + 1}. ${e.name}: ${e.logged.toFixed(1)}h logged\n`;
        });
        context += '\n';
      } else {
        context += `(Chưa có dữ liệu employeeHours tháng ${curMonth}/${curYear})\n\n`;
      }

      if (topLeaves.length > 0) {
        context += `🏖️ TOP 10 PHÉP ĐÃ DÙNG NHIỀU NHẤT (Năm ${curYear}):\n`;
        topLeaves.forEach((l, i) => {
          const remaining = Number(l.totalDays) - Number(l.usedDays);
          context += `  ${i + 1}. ${l.user.name}: ${l.usedDays}d/${l.totalDays}d (${remaining}d còn)\n`;
        });
        context += '\n';
      }

      context += `${'='.repeat(70)}\n`;
      return context;
    } catch (error) {
      console.error('Error fetching ranking context:', error);
      return `Lỗi khi lấy dữ liệu xếp hạng: ${(error as Error).message}`;
    }
  }

  private async getPersonalDetailContext(employeeName: string): Promise<string> {
    try {
      // Tìm nhân viên theo tên (case-insensitive)
      const employee = await this.prisma.user.findFirst({
        where: {
          name: {
            contains: employeeName,
            mode: 'insensitive',
          },
        },
        include: {
          employeeHours: {
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            take: 12,
          },
          projectParticipations: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: { project: true },
          },
          vouchers: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: { project: true },
          },
          leaves: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
          leaveQuotas: {
            where: { year: new Date().getFullYear() },
          },
        },
      });

      if (!employee) {
        return `KHÔNG TÌM THẤY: Không có nhân viên nào tên chứa "${employeeName}" trong hệ thống.`;
      }

      let context = `\n${'='.repeat(60)}\n`;
      context += `THÔNG TIN CHI TIẾT NHÂN VIÊN: ${employee.name}\n`;
      context += `${'='.repeat(60)}\n\n`;

      // Thông tin cơ bản
      context += `📋 THÔNG TIN CƠ BẢN:\n`;
      context += `- Họ tên: ${employee.name}\n`;
      context += `- Email: ${employee.email || 'N/A'}\n`;
      context += `- Phòng ban: ${employee.department || 'N/A'}\n`;
      context += `- Chức vụ: ${employee.role}\n`;
      context += `- Ngày vào: ${employee.joinDate?.toLocaleDateString('vi-VN') || 'N/A'}\n\n`;

      // Giờ làm việc chi tiết
      if (employee.employeeHours.length > 0) {
        context += `⏰ GIỜ LÀM VIỆC (12 tháng gần nhất):\n`;
        employee.employeeHours.forEach((h) => {
          context += `  - T${h.month}/${h.year}: ${h.loggedHours}h đăng ký | ${h.stdHours}h chuẩn | ${h.selfLearningHours}h tự học\n`;
        });
        context += '\n';
      }

      // Dự án tham gia
      if (employee.projectParticipations.length > 0) {
        context += `🎯 DỰ ÁN THAM GIA:\n`;
        employee.projectParticipations.forEach((p) => {
          context += `  - ${p.project.name} (${p.project.code}): ${p.participationPercent}% | ${p.loggedHours}h | T${p.month}/${p.year}\n`;
        });
        context += '\n';
      }

      // Phiếu chi liên quan
      if (employee.vouchers.length > 0) {
        context += `💰 PHIẾU CHI LIÊN QUAN:\n`;
        employee.vouchers.forEach((v) => {
          context += `  - [${v.status}] ${v.voucherNumber}: ${v.amount?.toNumber().toLocaleString()} VNĐ | ${v.reason} | ${v.project?.name || 'N/A'}\n`;
        });
        context += '\n';
      }

      // Nghỉ phép
      if (employee.leaveQuotas.length > 0 || employee.leaves.length > 0) {
        context += `🏖️ THÔNG TIN NGHỈ PHÉP:\n`;
        employee.leaveQuotas.forEach((q) => {
          const remaining = Number(q.totalDays) - Number(q.usedDays);
          context += `  - ${q.leaveType}: ${q.totalDays}d total | ${q.usedDays}d dùng | ${remaining}d còn\n`;
        });
        if (employee.leaves.length > 0) {
          context += `\n  📅 Lịch sử đơn xin (10 gần nhất):\n`;
          employee.leaves.forEach((l) => {
            context += `    • ${l.leaveType} [${l.status}]: ${l.startDate.toLocaleDateString('vi-VN')} - ${l.endDate.toLocaleDateString('vi-VN')} (${l.numDays}d)\n`;
          });
        }
        context += '\n';
      }

      // Workload (nếu có)
      const workload = await this.prisma.workloadReport.findFirst({
        where: {
          employeeName: employee.name,
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });

      if (workload) {
        context += `📊 WORKLOAD (Tháng ${workload.month}/${workload.year}):\n`;
        context += `  - Self-learning hours: ${workload.hours}h\n`;
        context += `  - Mức độ cảnh báo: ${workload.isAlert ? '🔴 VƯỢT NGƯỠNG (>30h)' : '✅ Bình thường'}\n\n`;
      }

      context += `${'='.repeat(60)}\n`;
      return context;
    } catch (error) {
      console.error('Error fetching personal context:', error);
      return `Lỗi khi lấy thông tin chi tiết nhân viên: ${error.message}`;
    }
  }

  private async getVouchersContext(month?: number, year?: number): Promise<string> {
    const now = new Date();
    const targetMonth = month ?? now.getMonth() + 1;
    const targetYear = year ?? now.getFullYear();
    const monthStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;

    // Kiểm tra có voucher local không
    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    const [localCount, byStatus] = await Promise.all([
      this.prisma.voucher.count({
        where: { createdAt: { gte: startDate, lte: endDate } },
      }),
      this.prisma.voucher.groupBy({ by: ['status'], _count: true }),
    ]);

    // Nếu có data local → dùng local
    if (localCount > 0) {
      const recent = await this.prisma.voucher.findMany({
        where: { createdAt: { gte: startDate, lte: endDate } },
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: { project: true, user: true },
      });

      const list = recent.map(v =>
        `- [${v.status}] ${v.voucherNumber}: ${v.amount?.toNumber().toLocaleString('vi-VN')} VND | ${v.reason} | ${v.project?.name || 'N/A'}`
      ).join('\n');

      const statusSummary = byStatus.map(s => `${s.status}: ${s._count}`).join(' | ');
      return `DỮ LIỆU PHIẾU CHI THÁNG ${targetMonth}/${targetYear} (Local DB):\n- Tổng: ${localCount} | ${statusSummary}\n${list}`;
    }

    // Fallback → gọi ERP trực tiếp
    try {
      // Lấy cả phiếu thu (RECEIPT) và phiếu chi (PAYMENT) song song
      const [summary, payments, receipts] = await Promise.allSettled([
        this.erp.getVouchersSummary({ month: monthStr }),
        this.erp.getVouchers({ month: monthStr, voucherType: 'PAYMENT', limit: 30 }),
        this.erp.getVouchers({ month: monthStr, voucherType: 'RECEIPT', limit: 30 }),
      ]);

      const paymentList = payments.status === 'fulfilled' ? payments.value : [];
      const receiptList = receipts.status === 'fulfilled' ? receipts.value : [];
      const allVouchers = [...paymentList, ...receiptList];

      if (allVouchers.length === 0 && summary.status === 'rejected') {
        return `DỮ LIỆU PHIẾU THU/CHI THÁNG ${targetMonth}/${targetYear} (ERP): Không có dữ liệu.\nLỗi: ${(summary as PromiseRejectedResult).reason?.message}`;
      }

      let ctx = `DỮ LIỆU PHIẾU THU/CHI THÁNG ${targetMonth}/${targetYear} (Nguồn: ERP):\n`;

      // Thêm summary nếu có
      if (summary.status === 'fulfilled' && summary.value) {
        const s = summary.value;
        ctx += `📊 Tổng kết:\n`;
        ctx += `- Phiếu chi (PAYMENT): ${s.totalPayment ?? paymentList.length} phiếu | ${(s.totalPaymentAmount ?? 0).toLocaleString('vi-VN')} VND\n`;
        ctx += `- Phiếu thu (RECEIPT): ${s.totalReceipt ?? receiptList.length} phiếu | ${(s.totalReceiptAmount ?? 0).toLocaleString('vi-VN')} VND\n\n`;
      }

      if (paymentList.length > 0) {
        ctx += `💸 PHIẾU CHI (${paymentList.length}):\n`;
        paymentList.forEach((v: any) => {
          ctx += `- [${v.status}] ${v.code || v.voucherNumber}: ${Number(v.amount || v.totalAmount || 0).toLocaleString('vi-VN')} VND | ${v.content || v.reason || 'N/A'}\n`;
        });
      }

      if (receiptList.length > 0) {
        ctx += `\n💰 PHIẾU THU (${receiptList.length}):\n`;
        receiptList.forEach((v: any) => {
          ctx += `- [${v.status}] ${v.code || v.voucherNumber}: ${Number(v.amount || v.totalAmount || 0).toLocaleString('vi-VN')} VND | ${v.content || v.reason || 'N/A'}\n`;
        });
      }

      return ctx || `DỮ LIỆU PHIẾU THU/CHI THÁNG ${targetMonth}/${targetYear}: Không có dữ liệu trong ERP.`;
    } catch (erpError) {
      return `DỮ LIỆU PHIẾU CHI THÁNG ${targetMonth}/${targetYear}: Local DB trống. ERP lỗi: ${(erpError as Error).message}`;
    }
  }

  private async getProjectsContext(): Promise<string> {
    const projects = await this.prisma.project.findMany({
      where: { status: 'active' },
      include: {
        _count: { select: { vouchers: true, employeeHours: true } }
      }
    });

    const list = projects.map(p =>
      `- ${p.name} (${p.code}): ${p._count.vouchers} phiếu | ${p._count.employeeHours} bản ghi giờ`
    ).join('\n');

    return `DANH SÁCH DỰ ÁN HOẠT ĐỘNG (${projects.length} dự án):\n${list}`;
  }

  private async getWorkloadContext(requestedMonth?: number, requestedYear?: number): Promise<string> {
    try {
      const now = new Date();
      const targetYear = requestedYear ?? now.getFullYear();
      const targetMonth = requestedMonth ?? now.getMonth() + 1;

      // Nguồn 1: employeeHours (được sync bởi DataSyncService - nguồn chính xác)
      const employeeHoursCount = await this.prisma.employeeHours.count({
        where: { year: targetYear, month: targetMonth },
      });

      if (employeeHoursCount > 0) {
        const hours = await this.prisma.employeeHours.findMany({
          where: { year: targetYear, month: targetMonth },
          include: { user: { select: { name: true, department: true } } },
          orderBy: { loggedHours: 'asc' },
        });

        // Kiểm tra chất lượng dữ liệu: nếu >50% nhân viên có logged=0 → data stale, ưu tiên ERP
        const zeroLoggedCount = hours.filter(
          (h) => parseFloat(h.loggedHours?.toString() ?? '0') === 0,
        ).length;
        const isStaleData = hours.length > 0 && zeroLoggedCount / hours.length > 0.5;

        if (isStaleData) {
          const monthStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
          try {
            const erpReport = await this.erp.getMonthlyWorkloadReport(monthStr);
            if (erpReport?.employees?.length > 0) {
              let ctx = `DỮ LIỆU WORKLOAD THÁNG ${targetMonth}/${targetYear} (Nguồn: ERP - DB có data stale):\n`;
              ctx += `- Tổng nhân sự: ${erpReport.employees.length}\n`;
              ctx += `- Vượt ngưỡng: ${erpReport.summary?.atRiskCount ?? 0}\n\n`;
              ctx += this.formatEmployeesByDepartment(erpReport.employees);
              return ctx;
            }
          } catch {
            // ERP không trả lời, tiếp tục dùng local DB
          }
        }

        const atRisk = hours.filter((h) => {
          const sl = parseFloat(h.stdHours?.toString() ?? '160') - parseFloat(h.loggedHours?.toString() ?? '0');
          return sl > 30;
        });

        let ctx = `DỮ LIỆU WORKLOAD THÁNG ${targetMonth}/${targetYear} (Nguồn: employeeHours DB):\n`;
        ctx += `- Tổng nhân sự: ${hours.length}\n`;
        ctx += `- Vượt ngưỡng self-learning (>30h): ${atRisk.length}\n\n`;
        const employeesForFormat = hours.map((h) => ({
          fullName: h.user.name,
          department: (h.user as any).department ?? 'N/A',
          actualLoggedHours: parseFloat(h.loggedHours?.toString() ?? '0'),
          effectiveStandardHours: parseFloat(h.stdHours?.toString() ?? '160'),
          selfLearningHours: Math.max(0, parseFloat(h.stdHours?.toString() ?? '160') - parseFloat(h.loggedHours?.toString() ?? '0')),
          isAtRisk: Math.max(0, parseFloat(h.stdHours?.toString() ?? '160') - parseFloat(h.loggedHours?.toString() ?? '0')) > 30,
        }));
        ctx += this.formatEmployeesByDepartment(employeesForFormat);

        return ctx;
      }

      // Nguồn 2: workloadReport (legacy table) - fallback nếu không có employeeHours
      const latestReport = await this.prisma.workloadReport.findFirst({
        where: { year: targetYear, month: targetMonth },
      });

      if (!latestReport) {
        // Nguồn 3: Gọi ERP trực tiếp
        const monthStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
        try {
          const erpReport = await this.erp.getMonthlyWorkloadReport(monthStr);
          if (erpReport && erpReport.employees && erpReport.employees.length > 0) {
            let ctx = `DỮ LIỆU WORKLOAD THÁNG ${targetMonth}/${targetYear} (Nguồn: ERP trực tiếp):\n`;
            ctx += `- Tổng nhân sự: ${erpReport.employees.length}\n`;
            ctx += `- Vượt ngưỡng: ${erpReport.summary?.atRiskCount ?? 0}\n\n`;
            ctx += this.formatEmployeesByDepartment(erpReport.employees);
            return ctx;
          }
        } catch (erpErr) {
          // ERP không có data hoặc lỗi kết nối - tiếp tục xuống thông báo
        }

        // Không có data ở đâu cả
        const anyHours = await this.prisma.employeeHours.findFirst({
          orderBy: [{ year: 'desc' }, { month: 'desc' }],
        });
        const latestAvailable = anyHours ? `${anyHours.month}/${anyHours.year}` : 'chưa có';
        return `THÔNG TIN WORKLOAD THÁNG ${targetMonth}/${targetYear}: Chưa có dữ liệu cả trong Local DB lẫn ERP. Tháng có dữ liệu gần nhất: ${latestAvailable}.`;
      }

      const reports = await this.prisma.workloadReport.findMany({
        where: { year: targetYear, month: targetMonth },
      });

      let ctx = `DỮ LIỆU WORKLOAD THÁNG ${targetMonth}/${targetYear}:\n`;
      ctx += `- Tổng nhân sự: ${reports.length}\n`;
      const alerts = reports.filter((r) => r.isAlert);
      ctx += `- Vượt ngưỡng (>30h): ${alerts.length}\n`;
      reports.forEach((r) => {
        const flag = r.isAlert ? '🔴' : '✅';
        ctx += `${flag} ${r.employeeName}: ${r.hours.toFixed(1)}h\n`;
      });

      return ctx;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021') {
        return 'THÔNG TIN WORKLOAD: Bảng chưa được khởi tạo.';
      }
      throw error;
    }
  }

  /**
   * Format danh sách nhân sự thành nhóm theo phòng ban, có số liệu workload
   */
  private formatEmployeesByDepartment(employees: Array<{
    fullName: string | null;
    department: string | null;
    actualLoggedHours: number;
    effectiveStandardHours: number;
    selfLearningHours: number;
    isAtRisk: boolean;
  }>): string {
    // Group by department
    const byDept = new Map<string, typeof employees>();
    for (const e of employees) {
      const dept = e.department || 'Chưa phân bộ phận';
      if (!byDept.has(dept)) byDept.set(dept, []);
      byDept.get(dept)!.push(e);
    }

    let ctx = '';
    // Sort departments alphabetically
    const sortedDepts = [...byDept.entries()].sort(([a], [b]) => a.localeCompare(b));

    for (const [dept, members] of sortedDepts) {
      const atRiskCount = members.filter((m) => m.isAtRisk).length;
      ctx += `\n📂 ${dept} (${members.length} người${atRiskCount > 0 ? ` | ⚠️ ${atRiskCount} vượt ngưỡng` : ''}):\n`;
      // Sort by self-learning DESC (người có vấn đề lên đầu)
      members.sort((a, b) => b.selfLearningHours - a.selfLearningHours);
      for (const e of members) {
        const flag = e.isAtRisk ? '🔴' : e.selfLearningHours > 21 ? '🟡' : '✅';
        ctx += `  ${flag} ${e.fullName}: logged=${e.actualLoggedHours.toFixed(1)}h | self-learning=${e.selfLearningHours.toFixed(1)}h\n`;
      }
    }
    return ctx;
  }

  private async getEmployeesContext(): Promise<string> {
    const [employees, totalCount, telegramCount] = await Promise.all([
      this.prisma.user.findMany({
        take: 100,
        orderBy: [{ department: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, email: true, department: true, role: true, telegramId: true },
      }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { telegramId: { not: null } } }),
    ]);

    // Group by department
    const byDept = new Map<string, typeof employees>();
    for (const e of employees) {
      const dept = e.department || 'Chưa phân bộ phận';
      if (!byDept.has(dept)) byDept.set(dept, []);
      byDept.get(dept)!.push(e);
    }

    let ctx = `DANH SÁCH NHÂN SỰ (Tổng: ${totalCount} | Telegram: ${telegramCount}):\n`;

    for (const [dept, members] of byDept) {
      ctx += `\n📂 ${dept} (${members.length} người):\n`;
      for (const e of members) {
        const tg = e.telegramId ? ' 📱' : '';
        ctx += `  - ${e.name} | ${e.role}${tg}\n`;
      }
    }

    // Nếu DB chỉ có ít user (bot/test accounts) → bổ sung từ ERP
    if (totalCount < 10) {
      ctx += `\n[DB chỉ có ${totalCount} user - có thể chưa sync từ ERP]\n`;
      try {
        const now = new Date();
        const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const erpReport = await this.erp.getMonthlyWorkloadReport(monthStr);
        if (erpReport?.employees?.length) {
          const erpByDept = new Map<string, string[]>();
          for (const e of erpReport.employees) {
            const dept = e.department || 'N/A';
            if (!erpByDept.has(dept)) erpByDept.set(dept, []);
            erpByDept.get(dept)!.push(e.fullName || e.employeeCode || '?');
          }
          ctx += `\nDỮ LIỆU NHÂN SỰ TỪ ERP (${erpReport.employees.length} người):\n`;
          for (const [dept, names] of erpByDept) {
            ctx += `📂 ${dept} (${names.length}): ${names.join(', ')}\n`;
          }
        }
      } catch {
        ctx += `[Không thể kết nối ERP để bổ sung danh sách]\n`;
      }
    }

    return ctx;
  }

  private async getEmployeeHoursContext(requestedMonth?: number, requestedYear?: number): Promise<string> {
    const now = new Date();
    const targetYear = requestedYear ?? now.getFullYear();
    const targetMonth = requestedMonth ?? now.getMonth() + 1;

    // Kiểm tra có data cho tháng được yêu cầu không
    const hasData = await this.prisma.employeeHours.count({
      where: { year: targetYear, month: targetMonth },
    });

    let year: number;
    let month: number;

    if (hasData > 0) {
      year = targetYear;
      month = targetMonth;
    } else {
      // Fallback: lấy tháng mới nhất có data, kèm thông báo
      const latestMonth = await this.prisma.employeeHours.findFirst({
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });

      if (!latestMonth) {
        return 'THÔNG TIN GIỜ LÀM VIỆC: Chưa có dữ liệu.';
      }
      year = latestMonth.year;
      month = latestMonth.month;
    }

    const hours = await this.prisma.employeeHours.findMany({
      where: { year, month },
      include: { user: true, project: true },
      take: 30,
    });

    const list = hours.map(h =>
      `- ${h.user.name} (${h.project?.name || 'N/A'}): ${h.loggedHours}h logged | ${h.stdHours}h std | ${h.selfLearningHours}h self-learn`
    ).join('\n');

    const note = (year !== targetYear || month !== targetMonth)
      ? `\n[Lưu ý: Không có data tháng ${targetMonth}/${targetYear}, hiển thị tháng ${month}/${year}]`
      : '';

    return `GIỜ LÀM VIỆC THÁNG ${month}/${year}:${note}\n${list}`;
  }

  private async getLeavesContext(): Promise<string> {
    const [totalLeaves, pending, currentYear] = await Promise.all([
      this.prisma.leave.count(),
      this.prisma.leave.count({ where: { status: 'pending' } }),
      this.prisma.leaveQuota.findMany({
        where: { year: new Date().getFullYear() },
        include: { user: true },
        take: 20,
      }),
    ]);

    const quotaList = currentYear.map(q =>
      `- ${q.user.name}: ${q.totalDays}d total | ${q.usedDays}d used | ${q.leaveType}`
    ).join('\n');

    return `DỮ LIỆU NGHỈ PHÉP:\n- Tổng đơn: ${totalLeaves}\n- Chờ duyệt: ${pending}\n- Hạn mức năm ${new Date().getFullYear()}:\n${quotaList}`;
  }

  private async getFinancialContext(): Promise<string> {
    const [periods, latestEntry, glAccounts] = await Promise.all([
      this.prisma.financialPeriod.findMany({
        where: { status: 'open' },
        take: 10,
        orderBy: { startDate: 'desc' },
      }),
      this.prisma.journalEntry.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { debitAccount: true, creditAccount: true },
      }),
      this.prisma.gLAccount.count(),
    ]);

    const periodList = periods.map(p =>
      `- ${p.code}: ${p.status} (${p.startDate?.toLocaleDateString('vi-VN')} - ${p.endDate?.toLocaleDateString('vi-VN')})`
    ).join('\n');

    const entryList = latestEntry.map(je =>
      `- JE: Nợ ${je.debitAccount.accountCode} | Có ${je.creditAccount.accountCode} | ${je.debitAmount}`
    ).join('\n');

    return `THÔNG TIN TÀI CHÍNH:\n- Kỳ mở: ${periods.length}\n- Tổng TK GL: ${glAccounts}\n- Kỳ gần nhất:\n${periodList}\n- 10 phiếu ghi sổ gần nhất:\n${entryList}`;
  }

  private async getChatHistoryContext(): Promise<string> {
    const chats = await this.prisma.chatLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });

    const list = chats.map(c =>
      `- ${c.user.name}: "${c.message.substring(0, 50)}..." | ${c.createdAt.toLocaleString('vi-VN')}`
    ).join('\n');

    const totalChats = await this.prisma.chatLog.count();
    return `LỊCH SỬ CHAT (Tổng: ${totalChats}):\n${list}`;
  }

  private async getSystemOverviewContext(): Promise<string> {
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [localVoucherCount, projectCount, userCount, leaveCount, chatCount, alerts, telegramCount] =
      await Promise.all([
        this.prisma.voucher.count(),
        this.prisma.project.count(),
        this.prisma.user.count(),
        this.prisma.leave.count(),
        this.prisma.chatLog.count(),
        this.prisma.alert.findMany({ take: 10 }),
        this.prisma.user.count({ where: { telegramId: { not: null } } }),
      ]);

    let voucherInfo = `${localVoucherCount} (local DB)`;
    let workloadInfo = '';
    let erpStatus = '';

    // Bổ sung dữ liệu từ ERP
    try {
      const [erpSummary, erpPending, erpWorkload, erpEmployees] = await Promise.allSettled([
        this.erp.getVouchersSummary({ month: monthStr }),
        this.erp.getVouchers({ month: monthStr, filterWaitingApproval: true, limit: 5 }),
        this.erp.getMonthlyWorkloadReport(monthStr),
        this.erp.getEmployees({ limit: 5 }),
      ]);

      if (erpSummary.status === 'fulfilled' && erpSummary.value) {
        const s = erpSummary.value;
        voucherInfo = `${localVoucherCount} local | ERP tháng ${monthStr}: ` +
          `${s.totalPayment ?? '?'} phiếu chi (${Number(s.totalPaymentAmount ?? 0).toLocaleString('vi-VN')} VND) | ` +
          `${s.totalReceipt ?? '?'} phiếu thu (${Number(s.totalReceiptAmount ?? 0).toLocaleString('vi-VN')} VND)`;
      } else if (erpSummary.status === 'rejected') {
        voucherInfo = `${localVoucherCount} local | ERP lỗi: ${(erpSummary as PromiseRejectedResult).reason?.message}`;
      }

      if (erpPending.status === 'fulfilled' && erpPending.value.length > 0) {
        const pendingList = erpPending.value.map((v: any) => `${v.code || v.voucherNumber}: ${Number(v.amount || 0).toLocaleString('vi-VN')} VND`).join(', ');
        voucherInfo += `\n  ⏳ Chờ duyệt: ${pendingList}`;
      }

      if (erpWorkload.status === 'fulfilled' && erpWorkload.value?.employees) {
        const emp = erpWorkload.value;
        workloadInfo = `\n📋 Workload tháng ${monthStr} (ERP): ${emp.employees.length} người | ${emp.summary?.atRiskCount ?? 0} vượt ngưỡng`;
      }

      if (erpEmployees.status === 'fulfilled') {
        workloadInfo += `\n👥 Nhân sự ERP (active): ${erpEmployees.value.length}+ người`;
      }

      erpStatus = erpSummary.status === 'fulfilled' ? '🟢 ERP kết nối OK' : '🔴 ERP không kết nối được';
    } catch {
      erpStatus = '🔴 ERP không kết nối được';
    }

    const alertList = alerts.map(a => `- ${a.alertType}: ${a.message}`).join('\n');

    return `TỔNG QUAN HỆ THỐNG:\n` +
      `📊 Local DB:\n` +
      `- Phiếu chi: ${voucherInfo}\n` +
      `- Dự án: ${projectCount}\n` +
      `- Nhân sự (DB): ${userCount} (${telegramCount} có Telegram)\n` +
      `- Đơn nghỉ: ${leaveCount}\n` +
      `- Tin nhắn chat: ${chatCount}\n` +
      workloadInfo +
      `\n\n🔌 ${erpStatus}` +
      (alerts.length > 0 ? `\n\n⚠️ Cảnh báo:\n${alertList}` : '');
  }

  private async getLatestCashflowSummary(): Promise<string> {
    try {
      // Nếu dữ liệu đã cache, trả về cached
      if (this.cachedCashflowData) {
        return this.cachedCashflowData.summary;
      }

      const exportsDir = path.join(process.cwd(), 'exports');
      if (!fs.existsSync(exportsDir)) return 'Không tìm thấy thư mục báo cáo tài chính.';

      const files = fs.readdirSync(exportsDir)
        .filter(f => f.startsWith('cashflow_') && f.endsWith('.xlsx'))
        .sort((a, b) => b.localeCompare(a));

      if (files.length === 0) return 'Không có báo cáo Cashflow nào trong hệ thống.';

      const latestFile = path.join(exportsDir, files[0]);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(latestFile);

      let worksheet = workbook.getWorksheet('Cashflow_Misa') ||
                      workbook.getWorksheet('Cashflow') ||
                      workbook.getWorksheet('cashflow') ||
                      workbook.getWorksheet(1);

      if (!worksheet) return `Lỗi: Không tìm thấy sheet Cashflow trong file ${files[0]}`;

      // === PARSE TOÀN BỘ DỮ LIỆU ===
      const columnHeaders: Record<number, string> = {}; // col_index -> "Jan", "Feb", etc.
      const rowData: Record<string, Record<number, any>> = {}; // row_label -> {col_index -> value}
      const allRows: Array<{label: string, values: Record<number, any>}> = [];

      // Parse header row (row 2)
      const headerRow = worksheet.getRow(2);
      for (let col = 1; col <= 30; col++) {
        const cell = headerRow.getCell(col);
        const value = cell.value;
        if (value) {
          columnHeaders[col] = String(value).trim();
        }
      }

      // Parse dữ liệu rows
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber <= 2) return; // Skip header rows

        const rowLabel = String(row.getCell(1).value || `Row ${rowNumber}`).trim();
        const rowValues: Record<number, any> = {};

        for (let col = 1; col <= 30; col++) {
          let value = row.getCell(col).value;

          // Handle formula results
          if (value && typeof value === 'object' && 'result' in value) {
            value = value.result;
          }

          if (value !== null && value !== undefined) {
            rowValues[col] = value;
          }
        }

        if (Object.keys(rowValues).length > 0) {
          rowData[rowLabel] = rowValues;
          allRows.push({ label: rowLabel, values: rowValues });
        }
      });

      // === TẠO CONTEXT CHI TIẾT ===
      let summary = `📊 BÁOO CÁO CASHFLOW: ${files[0]}\n`;
      summary += `\n=== CẤU TRÚC CỘT ===\n`;
      summary += `Các cột có sẵn:\n`;
      Object.entries(columnHeaders).forEach(([colIdx, colName]) => {
        summary += `- Cột ${colIdx}: ${colName}\n`;
      });

      summary += `\n=== TOÀN BỘ DỮ LIỆU (${allRows.length} hàng) ===\n\n`;

      allRows.slice(0, 100).forEach((row) => {
        summary += `\n${row.label}:\n`;
        for (let col = 1; col <= 30; col++) {
          if (row.values[col]) {
            const colName = columnHeaders[col] || `Col${col}`;
            summary += `  - ${colName}: ${row.values[col]}\n`;
          }
        }
      });

      summary += `\n=== HƯỚNG DẪN TRỰ VẤN ===\n`;
      summary += `Bạn có thể hỏi về:\n`;
      summary += `- Lương nhân viên nội bộ tháng 1 / tháng 2 / ...\n`;
      summary += `- Chi phí quản lý van phong\n`;
      summary += `- Lương sales, marketing, IT\n`;
      summary += `- Bất kỳ dòng nào trong dữ liệu\n`;
      summary += `- Từng tháng cụ thể (Jan, Feb, March, ...)\n`;

      // Cache dữ liệu - TOÀN BỘ
      this.cachedCashflowData = {
        file: files[0],
        summary,
        columnHeaders,
        rowData,
        allRows,
        worksheet: { // Lưu reference để truy vấn sau
          get: (rowLabel: string, colName: string) => {
            const row = rowData[rowLabel];
            if (!row) return null;
            // Tìm col index từ colName
            const colIdx = Object.entries(columnHeaders).find(([_, name]) =>
              name.toLowerCase() === colName.toLowerCase()
            )?.[0];
            return colIdx ? row[parseInt(colIdx)] : null;
          }
        }
      };

      return summary;
    } catch (error) {
      console.error('Error reading Cashflow:', error);
      return `❌ Lỗi khi đọc dữ liệu Cashflow: ${error.message}`;
    }
  }
}
