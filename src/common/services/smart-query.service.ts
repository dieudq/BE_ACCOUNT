import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { accountingBotAPI } from './agent-api-client';
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
  constructor(private prisma: PrismaService) {}

  /**
   * Main entry - xử lý BẤT CỨ câu hỏi
   */
  async answerQuestion(question: string): Promise<string> {
    const lowerQ = question.toLowerCase().trim();

    // === INTENT DETECTION ===

    // 1. PENDING/WAITING - "chờ", "chưa", "đang chờ"
    if (this.isAbout(lowerQ, ['chờ', 'chưa', 'pending', 'waiting', 'đang chờ'])) {
      return await this.handlePendingQuery(question);
    }

    // 2. APPROVAL/STATUS - "duyệt", "phê duyệt", "bước", "progress"
    if (this.isAbout(lowerQ, ['duyệt', 'phê duyệt', 'approval', 'bước', 'progress', 'status'])) {
      return await this.handleApprovalQuery(question);
    }

    // 3. COUNT/STATISTICS - "mấy", "bao nhiêu", "tổng", "stats"
    if (this.isAbout(lowerQ, ['mấy', 'bao nhiêu', 'tổng', 'stats', 'đếm', 'count'])) {
      return await this.handleCountQuery(question);
    }

    // 4. CASHFLOW/GL - "cashflow", "tài khoản", "GL", "danh mục"
    if (this.isAbout(lowerQ, ['cashflow', 'tài khoản', 'gl', 'danh mục', 'map'])) {
      return await this.handleCashflowQuery(question);
    }

    // 5. VOUCHER DETAILS - "phiếu", "chi tiết", "voucher"
    if (this.isAbout(lowerQ, ['phiếu', 'chi tiết', 'voucher', 'ax', 'px', 'cv'])) {
      return await this.handleVoucherQuery(question);
    }

    // 6. DATE RELATED - "hôm nay", "tuần", "tháng", "năm"
    if (this.isAbout(lowerQ, ['hôm nay', 'tuần', 'tháng', 'năm', 'today', 'week', 'month'])) {
      return await this.handleDateRangeQuery(question);
    }

    // 7. AMOUNT/MONEY - "tiền", "số tiền", "amount", "chi bao nhiêu"
    if (this.isAbout(lowerQ, ['tiền', 'số tiền', 'amount', 'chi bao nhiêu', 'tổng tiền'])) {
      return await this.handleAmountQuery(question);
    }

    // 8. PERSON/APPROVER - "ai", "người", "approver", "duyệt bằng ai"
    if (this.isAbout(lowerQ, ['ai duyệt', 'người nào', 'approver', 'chờ ai', 'duyệt bằng ai'])) {
      return await this.handleApproverQuery(question);
    }

    // 9. HISTORY/TIMELINE - "lịch sử", "history", "timeline"
    if (this.isAbout(lowerQ, ['lịch sử', 'history', 'timeline', 'quá trình'])) {
      return await this.handleHistoryQuery(question);
    }

    // === FALLBACK: Database search ===
    return await this.handleDatabaseSearch(question);
  }

  /**
   * Check if question is about certain keywords
   */
  private isAbout(question: string, keywords: string[]): boolean {
    return keywords.some((kw) => question.includes(kw));
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
  private async handleApprovalQuery(question: string): Promise<string> {
    try {
      // Extract voucher code if present
      const voucherMatch = question.match(/(ax|px|cv)(\d+)/i);
      if (voucherMatch) {
        const code = `${voucherMatch[1].toUpperCase()}${voucherMatch[2]}`;
        const result = await accountingBotAPI.getVoucherStatus(code);
        return result.formatted;
      }

      // Otherwise return summary
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
   * Handle cashflow/GL questions
   */
  private async handleCashflowQuery(question: string): Promise<string> {
    try {
      // Check for specific account code (334.1, 6422.5, etc)
      const accountMatch = question.match(/(\d+\.?\d*)/);
      if (accountMatch) {
        const accountCode = accountMatch[0];
        return await this.getGLAccountMapping(accountCode);
      }

      // Otherwise cashflow overview
      const result = await accountingBotAPI.getCashflowInfo();
      return result.formatted;
    } catch (error) {
      return `❌ Lỗi lấy cashflow: ${(error as Error).message}`;
    }
  }

  /**
   * Handle voucher detail questions
   */
  private async handleVoucherQuery(question: string): Promise<string> {
    try {
      // Extract voucher code
      const voucherMatch = question.match(/(ax|px|cv)(\d+)/i);
      if (voucherMatch) {
        const code = `${voucherMatch[1].toUpperCase()}${voucherMatch[2]}`;
        const result = await accountingBotAPI.getVoucherStatus(code);
        return result.formatted;
      }

      // Otherwise list all
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
   * Handle amount/money questions - "Chi bao nhiêu tháng 1?" "Lương dự án tháng 1?"
   */
  private async handleAmountQuery(question: string): Promise<string> {
    try {
      const lowerQ = question.toLowerCase();

      // Extract month if present (tháng 1, tháng 2, etc)
      const monthMatch = lowerQ.match(/tháng\s*(\d+)/);
      const month = monthMatch ? parseInt(monthMatch[1]) : null;

      // Extract category/account if present (334.1, lương, dự án, etc)
      const categoryMatch = lowerQ.match(/(334|dự án|lương|quản lý|sales|marketing)/i);

      // Query based on extracted info
      if (categoryMatch && month) {
        // Query by month + category
        return await this.queryAmountByMonthAndCategory(month, categoryMatch[0]);
      } else if (month) {
        // Query by month
        return await this.queryAmountByMonth(month);
      }

      // Default: today's amount
      const result = await accountingBotAPI.getTodayVouchers();
      return result.formatted;
    } catch (error) {
      return `❌ Lỗi lấy thông tin tiền: ${(error as Error).message}`;
    }
  }

  /**
   * Query amount by month and category
   */
  private async queryAmountByMonthAndCategory(month: number, category: string): Promise<string> {
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
      const year = new Date().getFullYear();
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

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

      return `💰 <b>Chi phí ${category} tháng ${month}:</b> ${formattedTotal} VND\n📊 Số phiếu: ${vouchers.length}`;
    } catch (error) {
      return `❌ Lỗi: ${(error as Error).message}`;
    }
  }

  /**
   * Query amount by month
   */
  private async queryAmountByMonth(month: number): Promise<string> {
    try {
      const year = new Date().getFullYear();
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

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

      return `💰 <b>Tháng ${month}:</b> ${formattedTotal} VND\n📊 Số phiếu: ${vouchers.length} (✅ ${approved} đã duyệt)`;
    } catch (error) {
      return `❌ Lỗi: ${(error as Error).message}`;
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
   * Handle history questions
   */
  private async handleHistoryQuery(question: string): Promise<string> {
    try {
      // Extract voucher code
      const voucherMatch = question.match(/(ax|px|cv)(\d+)/i);
      if (voucherMatch) {
        const code = `${voucherMatch[1].toUpperCase()}${voucherMatch[2]}`;
        const result = await accountingBotAPI.getVoucherStatus(code);
        return result.formatted;
      }

      return `❌ Vui lòng chỉ định mã phiếu (e.g., AX99)`;
    } catch (error) {
      return `❌ Lỗi lấy lịch sử: ${(error as Error).message}`;
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
