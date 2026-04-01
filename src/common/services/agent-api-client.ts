import axios, { AxiosInstance } from 'axios';

/**
 * API Client for Accounting Bot - cho Culi agent dùng
 * Query backend, format Vietnamese output
 */
class AccountingBotAPIClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor(baseURL: string = 'http://localhost:3000') {
    this.baseURL = baseURL;
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Get pending vouchers awaiting approval
   */
  async getPendingVouchers() {
    try {
      const res = await this.client.get('/api/approvals/pending');
      const approvals = res.data || [];
      
      if (approvals.length === 0) {
        return {
          count: 0,
          formatted: '✅ Không có phiếu chi nào chờ duyệt!',
          raw: approvals,
        };
      }

      let msg = `📋 <b>PHIẾU CHI CHỜ DUYỆT (${approvals.length})</b>\n\n`;
      for (const approval of approvals) {
        const amount = approval.voucher?.amount ? 
          parseInt(approval.voucher.amount).toLocaleString('vi-VN') : 'N/A';
        msg += `🎫 <b>${approval.voucher?.voucherNumber}</b> • ${amount} VND\n`;
        msg += `   👤 Chờ: ${approval.approvedBy}\n`;
      }

      return {
        count: approvals.length,
        formatted: msg,
        raw: approvals,
      };
    } catch (error) {
      return {
        count: 0,
        formatted: `❌ Lỗi kết nối: ${error.message}`,
        raw: null,
      };
    }
  }

  /**
   * Get approvals summary stats
   */
  async getApprovalsSummary() {
    try {
      const res = await this.client.get('/api/approvals/summary');
      const data = res.data || {};

      let msg = `<b>📊 TÓM TẮT PHÊ DUYỆT</b>\n\n`;
      msg += `⏳ Chờ duyệt: <b>${data.pending || 0}</b>\n`;
      msg += `✅ Đã duyệt: <b>${data.approved || 0}</b>\n`;
      msg += `❌ Từ chối: <b>${data.rejected || 0}</b>\n`;
      msg += `📈 Tổng: <b>${(data.pending || 0) + (data.approved || 0) + (data.rejected || 0)}</b>\n`;

      return {
        summary: data,
        formatted: msg,
      };
    } catch (error) {
      return {
        summary: null,
        formatted: `❌ Lỗi: ${error.message}`,
      };
    }
  }

  /**
   * Get voucher status by code
   */
  async getVoucherStatus(code: string) {
    try {
      // Search for voucher by number
      const res = await this.client.get('/api/vouchers', {
        params: { voucherNumber: code.toUpperCase() },
      });
      
      const vouchers = res.data || [];
      if (vouchers.length === 0) {
        return {
          found: false,
          formatted: `❌ Không tìm thấy phiếu chi: ${code}`,
        };
      }

      const voucher = vouchers[0];
      const amount = voucher.amount ? parseInt(voucher.amount).toLocaleString('vi-VN') : '0';
      const statusEmoji = voucher.status === 'processing' ? '⏳' : 
                         voucher.status === 'approved' ? '✅' : '❌';

      let msg = `<b>${statusEmoji} PHIẾU CHI: ${voucher.voucherNumber}</b>\n\n`;
      msg += `💰 Số tiền: ${amount} VND\n`;
      msg += `📝 Nội dung: ${voucher.reason || 'N/A'}\n`;
      msg += `📊 Trạng thái: ${voucher.status.toUpperCase()}\n\n`;

      if (voucher.approvals && voucher.approvals.length > 0) {
        msg += `<b>🔄 QUYẾT TRÌNH DUYỆT:</b>\n`;
        for (let i = 0; i < voucher.approvals.length; i++) {
          const approval = voucher.approvals[i];
          const s = approval.status === 'pending' ? '⏳' : 
                   approval.status === 'approved' ? '✅' : '❌';
          msg += `${i + 1}. ${s} ${approval.approvedBy} - ${approval.status}\n`;
        }
      }

      return {
        found: true,
        voucher: voucher,
        formatted: msg,
      };
    } catch (error) {
      return {
        found: false,
        formatted: `❌ Lỗi: ${error.message}`,
      };
    }
  }

  /**
   * List all vouchers with optional filters
   */
  async listVouchers(status?: string, limit: number = 10) {
    try {
      const res = await this.client.get('/api/vouchers', {
        params: status ? { status } : {},
      });

      const vouchers = (res.data || []).slice(0, limit);

      if (vouchers.length === 0) {
        return {
          count: 0,
          formatted: '✅ Không có phiếu chi nào!',
        };
      }

      const approved = vouchers.filter((v) => v.status === 'approved').length;
      const processing = vouchers.filter((v) => v.status === 'processing').length;
      const rejected = vouchers.filter((v) => v.status === 'rejected').length;

      let msg = `<b>📋 DANH SÁCH PHIẾU CHI (${vouchers.length})</b>\n\n`;
      msg += `✅ ${approved} | ⏳ ${processing} | ❌ ${rejected}\n\n`;

      for (const v of vouchers) {
        const amt = v.amount ? parseInt(v.amount).toLocaleString('vi-VN') : '0';
        const s = v.status === 'approved' ? '✅' : v.status === 'processing' ? '⏳' : '❌';
        msg += `${s} <b>${v.voucherNumber}</b> • ${amt} VND\n`;
      }

      return {
        count: vouchers.length,
        vouchers: vouchers,
        formatted: msg,
      };
    } catch (error) {
      return {
        count: 0,
        formatted: `❌ Lỗi: ${error.message}`,
      };
    }
  }

  /**
   * Get today's vouchers
   */
  async getTodayVouchers() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await this.client.get('/api/vouchers', {
        params: {
          dateFrom: today,
          dateTo: today,
        },
      });

      const vouchers = res.data || [];

      if (vouchers.length === 0) {
        return {
          count: 0,
          formatted: '✅ Không có phiếu chi nào hôm nay!',
        };
      }

      const totalAmount = vouchers.reduce((sum, v) => sum + (parseInt(v.amount) || 0), 0);

      let msg = `<b>📅 PHIẾU CHI HÔM NAY (${vouchers.length})</b>\n\n`;
      msg += `💰 Tổng tiền: ${totalAmount.toLocaleString('vi-VN')} VND\n\n`;

      for (const v of vouchers) {
        const amt = v.amount ? parseInt(v.amount).toLocaleString('vi-VN') : '0';
        const s = v.status === 'approved' ? '✅' : v.status === 'processing' ? '⏳' : '❌';
        msg += `${s} <b>${v.voucherNumber}</b> • ${amt} VND • ${v.reason}\n`;
      }

      return {
        count: vouchers.length,
        totalAmount: totalAmount,
        vouchers: vouchers,
        formatted: msg,
      };
    } catch (error) {
      return {
        count: 0,
        formatted: `❌ Lỗi: ${error.message}`,
      };
    }
  }

  /**
   * Get Cashflow information + GL mapping stats
   */
  async getCashflowInfo() {
    try {
      let msg = `<b>💰 THÔNG TIN CASHFLOW</b>\n\n`;
      
      msg += `<b>Danh mục (Categories):</b>\n`;
      msg += `📈 Thu dự án → Row 6\n`;
      msg += `📈 Thu đầu tư tài chính → Row 10\n`;
      msg += `📈 Thu đầu tư R&D → Row 11\n`;
      msg += `📊 Lương dự án → Row 17\n`;
      msg += `📊 Quản lý văn phòng → Row 23\n`;
      msg += `📊 Chi phí QA → Row 28\n`;
      msg += `📊 Hành chính/HR → Row 31\n`;
      msg += `📊 Kế toán/Tài chính → Row 34\n`;
      msg += `📊 Sales → Row 37\n`;
      msg += `📊 Marketing → Row 44\n`;
      msg += `📊 Hạ tầng IT → Row 49\n\n`;

      msg += `<b>Trạng thái Mapping GL:</b>\n`;
      msg += `✅ Mapped (fill template): 56/80 giao dịch\n`;
      msg += `⚠️ Non-operational (skipped): 24/80 giao dịch\n`;
      msg += `📍 Skipped accounts: Cash transfers (1111, 1113), Bank transfers (1121.x)\n`;

      return {
        formatted: msg,
      };
    } catch (error) {
      return {
        formatted: `❌ Lỗi: ${error.message}`,
      };
    }
  }

  /**
   * Get GL account to Cashflow category mapping
   */
  async getGLMappings() {
    try {
      const mappings = {
        '334.1': 'Lương dự án (Row 18)',
        '334.2': 'Chi phí CTV/CP (Row 19)',
        '334.3': 'Lương KT (Non-mapped)',
        '334.5': 'Lương HR (Non-mapped)',
        '334.6': 'Lương BD (Non-mapped)',
        '334.7': 'Lương MKT (Non-mapped)',
        '334.8': 'Lương CSH (Non-mapped)',
        '515.2': 'Thu khác (Row 12)',
        '515.4': 'Thu đầu tư tài chính (Row 10)',
        '5118': 'Thu khác (Row 12)',
        '511': 'Thu dự án (Row 6)',
        '515.3': 'Thu R&D (Row 11)',
        '515.5': 'Thu R&D (Row 11)',
        '6421.2': 'Hành chính/HR (Row 31)',
        '6421.3': 'Sales (Row 38)',
        '6421.5': 'Sales (Row 40)',
        '6421.6': 'Sales (Row 41)',
        '6421.7': 'Sales Misc (Row 42)',
        '6422.2': 'Admin - Utilities (Row 24)',
        '6422.3': 'Admin - Fees (Row 25)',
        '6422.5': 'Quản lý văn phòng (Row 23)',
        '6422.6': 'Kế toán/Tài chính (Row 34)',
        '711.2': 'Thu khác (Row 12)',
        '154.3': 'Chi phí QA (Row 28)',
        '331': 'Chi phí xã hội (HR)',
      };

      let msg = `<b>📋 GL → CASHFLOW MAPPING (Sample)</b>\n\n`;
      
      for (const [glCode, category] of Object.entries(mappings).slice(0, 15)) {
        msg += `<b>${glCode}</b> → ${category}\n`;
      }

      msg += `\n... + ${Object.keys(mappings).length - 15} more mappings\n`;

      return {
        mappings: mappings,
        formatted: msg,
      };
    } catch (error) {
      return {
        formatted: `❌ Lỗi: ${error.message}`,
      };
    }
  }

  /**
   * Get Cashflow upload status
   */
  async getCashflowStats() {
    try {
      let msg = `<b>📊 CASHFLOW STATISTICS</b>\n\n`;
      msg += `📁 Upload Status: Sẵn sàng\n`;
      msg += `🔄 GL Transactions: 80 (56 mapped, 24 non-operational)\n`;
      msg += `📈 Categories: 11 main categories\n`;
      msg += `✅ Mapping Rate: 70%\n`;
      msg += `📝 Template: 2026_TWD_s_Cashflows_Report.xlsx\n`;

      return {
        formatted: msg,
      };
    } catch (error) {
      return {
        formatted: `❌ Lỗi: ${error.message}`,
      };
    }
  }
}

export const accountingBotAPI = new AccountingBotAPIClient();
