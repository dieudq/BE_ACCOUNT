import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotiService } from '../common/services/telegram-noti.service';

@Injectable()
export class BotCommandsService {
  private readonly logger = new Logger(BotCommandsService.name);

  constructor(
    private prisma: PrismaService,
    private telegramNoti: TelegramNotiService,
  ) {}

  /**
   * Handle /pending - Danh sách phiếu chi chờ duyệt
   */
  async getPendingVouchers(chatId: string): Promise<string> {
    try {
      const pendingVouchers = await this.prisma.voucher.findMany({
        where: { status: 'processing' },
        include: {
          approvals: {
            where: { status: 'pending' },
          },
          user: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      if (pendingVouchers.length === 0) {
        return '✅ Không có phiếu chi nào chờ duyệt!';
      }

      let msg = `<b>📋 PHIẾU CHI CHỜ DUYỆT (${pendingVouchers.length})</b>\n\n`;

      for (const voucher of pendingVouchers) {
        const amount = parseFloat(voucher.amount?.toString() || '0').toLocaleString('vi-VN');
        const nextApprover = voucher.approvals[0]?.approvedBy || 'N/A';

        msg += `🎫 <b>${voucher.voucherNumber}</b>\n`;
        msg += `  💰 ${amount} VND\n`;
        msg += `  📝 ${voucher.reason}\n`;
        msg += `  👤 Chờ: ${nextApprover}\n`;
        msg += `  ⏰ ${voucher.createdAt.toLocaleString('vi-VN')}\n\n`;
      }

      return msg;
    } catch (error) {
      this.logger.error(`Error getting pending vouchers: ${error.message}`);
      return `❌ Lỗi: ${error.message}`;
    }
  }

  /**
   * Handle /approvals - Danh sách tất cả phê duyệt
   */
  async getApprovalsSummary(chatId: string): Promise<string> {
    try {
      const approvals = await this.prisma.approval.findMany({
        include: {
          voucher: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      if (approvals.length === 0) {
        return '✅ Không có phê duyệt nào!';
      }

      const pending = approvals.filter((a) => a.status === 'pending').length;
      const approved = approvals.filter((a) => a.status === 'approved').length;
      const rejected = approvals.filter((a) => a.status === 'rejected').length;

      let msg = `<b>📊 TÓM TẮT PHÊ DUYỆT</b>\n\n`;
      msg += `⏳ Chờ duyệt: <b>${pending}</b>\n`;
      msg += `✅ Đã duyệt: <b>${approved}</b>\n`;
      msg += `❌ Từ chối: <b>${rejected}</b>\n`;
      msg += `📈 Tổng: <b>${approvals.length}</b>\n\n`;

      msg += `<b>Gần đây:</b>\n`;
      for (const approval of approvals.slice(0, 5)) {
        const statusEmoji = approval.status === 'pending' ? '⏳' : approval.status === 'approved' ? '✅' : '❌';
        msg += `${statusEmoji} ${approval.voucher?.voucherNumber} - ${approval.approvedBy}\n`;
      }

      return msg;
    } catch (error) {
      this.logger.error(`Error getting approvals summary: ${error.message}`);
      return `❌ Lỗi: ${error.message}`;
    }
  }

  /**
   * Handle /status <code> - Chi tiết phiếu chi
   */
  async getVoucherStatus(code: string): Promise<string> {
    try {
      const voucher = await this.prisma.voucher.findFirst({
        where: { voucherNumber: code.toUpperCase() },
        include: {
          approvals: {
            orderBy: { createdAt: 'asc' },
          },
          user: true,
        },
      });

      if (!voucher) {
        return `❌ Không tìm thấy phiếu chi: ${code}`;
      }

      const amount = parseFloat(voucher.amount?.toString() || '0').toLocaleString('vi-VN');
      const statusEmoji = voucher.status === 'processing' ? '⏳' : voucher.status === 'approved' ? '✅' : '❌';

      let msg = `<b>${statusEmoji} PHIẾU CHI: ${voucher.voucherNumber}</b>\n\n`;
      msg += `💰 Số tiền: ${amount} VND\n`;
      msg += `📝 Nội dung: ${voucher.reason}\n`;
      msg += `👤 Người lập: ${voucher.user?.name || 'N/A'}\n`;
      msg += `📊 Trạng thái: ${voucher.status.toUpperCase()}\n`;
      msg += `⏰ Tạo lúc: ${voucher.createdAt.toLocaleString('vi-VN')}\n\n`;

      msg += `<b>🔄 QUYẾT TRÌNH DUYỆT:</b>\n`;
      for (let i = 0; i < voucher.approvals.length; i++) {
        const approval = voucher.approvals[i];
        const statusEmoji2 = approval.status === 'pending' ? '⏳' : approval.status === 'approved' ? '✅' : '❌';
        const approverName = approval.approvedBy || `Bước ${i + 1}`;

        msg += `${i + 1}. ${statusEmoji2} ${approverName} - ${approval.status}\n`;

        if (approval.approvedAt) {
          msg += `   ✓ ${approval.approvedAt.toLocaleString('vi-VN')}\n`;
        }

        if (approval.rejectionReason) {
          msg += `   Lý do: ${approval.rejectionReason}\n`;
        }
      }

      return msg;
    } catch (error) {
      this.logger.error(`Error getting voucher status: ${error.message}`);
      return `❌ Lỗi: ${error.message}`;
    }
  }

  /**
   * Handle /list - Danh sách tất cả phiếu chi
   */
  async listAllVouchers(chatId: string): Promise<string> {
    try {
      const vouchers = await this.prisma.voucher.findMany({
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        take: 15,
      });

      if (vouchers.length === 0) {
        return '✅ Không có phiếu chi nào!';
      }

      const approved = vouchers.filter((v) => v.status === 'approved').length;
      const processing = vouchers.filter((v) => v.status === 'processing').length;
      const rejected = vouchers.filter((v) => v.status === 'rejected').length;

      let msg = `<b>📋 DANH SÁCH PHIẾU CHI (${vouchers.length})</b>\n\n`;
      msg += `✅ ${approved} | ⏳ ${processing} | ❌ ${rejected}\n\n`;

      for (const v of vouchers) {
        const amt = parseFloat(v.amount?.toString() || '0').toLocaleString('vi-VN');
        const s = v.status === 'approved' ? '✅' : v.status === 'processing' ? '⏳' : '❌';
        msg += `${s} <b>${v.voucherNumber}</b> • ${amt} VND • ${v.user?.name}\n`;
      }

      return msg;
    } catch (error) {
      this.logger.error(`Error listing vouchers: ${error.message}`);
      return `❌ Lỗi: ${error.message}`;
    }
  }

  /**
   * Handle /help - Hướng dẫn lệnh
   */
  getHelpMessage(): string {
    return `<b>🤖 HƯỚNG DẪN LỆNH</b>

/pending - 📋 Xem phiếu chi chờ duyệt
/approvals - 📊 Xem tóm tắt phê duyệt
/status &lt;code&gt; - 🔍 Chi tiết phiếu chi (vd: /status AX99)
/list - 📑 Danh sách tất cả phiếu chi
/help - ℹ️ Xem hướng dẫn này

💡 Ví dụ: <code>/status AX99</code>`;
  }
}
