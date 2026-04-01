import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotiService } from '../common/services/telegram-noti.service';
import { ERPClientService } from '../common/services/erp-client.service';

@Injectable()
export class VoucherApprovalService {
  private readonly logger = new Logger(VoucherApprovalService.name);

  // Approval chain: Quỳnh → Linh → Long
  private readonly APPROVAL_CHAIN = [
    { email: 'quynh@company.com', telegramId: '5377791753', name: 'Chị Quỳnh', order: 0 },
    { email: 'linh@company.com', telegramId: '5377791753', name: 'Chị Linh', order: 1 },
    { email: 'long@company.com', telegramId: '5377791753', name: 'Anh Long', order: 2 },
  ];

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => TelegramNotiService))
    private telegramNotiService: TelegramNotiService,
    private erpClient: ERPClientService,
  ) {}

  /**
   * Build approval message with Accept/Reject buttons
   */
  buildApprovalMessage(
    voucher: any,
    createdBy: any,
    currentApprover?: string,
    details?: any[],
    payload?: any,
  ): {
    text: string;
    buttons: any[][];
  } {
    const approverIdx = this.APPROVAL_CHAIN.findIndex(
      (a) => a.email === currentApprover,
    );
    const orderText = approverIdx >= 0 ? ` (Bước ${approverIdx + 1}/${this.APPROVAL_CHAIN.length})` : '';

    let text = `
<b>🎫 PHIẾU CHI CHUYÊN DÙNG</b>${orderText}

<b>📌 THÔNG TIN CƠ BẢN</b>
<b>Mã phiếu:</b> ${voucher.voucherNumber}
<b>Loại phiếu:</b> ${payload?.voucherType || 'PAYMENT'}
<b>Người lập:</b> ${createdBy?.fullName || 'ERP System'}
<b>Email:</b> ${createdBy?.email || 'N/A'}

<b>📅 NGÀY THÁNG</b>
<b>Ngày phát hành:</b> ${payload?.issueDate ? new Date(payload.issueDate).toLocaleDateString('vi-VN') : new Date(voucher.createdAt).toLocaleDateString('vi-VN')}
<b>Ngày ghi sổ:</b> ${payload?.postingDate ? new Date(payload.postingDate).toLocaleDateString('vi-VN') : new Date(voucher.createdAt).toLocaleDateString('vi-VN')}

<b>💰 THÔNG TIN TIỀN TỆ</b>
<b>Nội dung chi:</b> ${voucher.reason || payload?.content || 'N/A'}
<b>Tổng tiền:</b> <u><b>${parseFloat(voucher.amount?.toString() || '0').toLocaleString('vi-VN')} VND</b></u>
<b>Loại tiền:</b> ${payload?.currency || 'VND'}
<b>Tỷ giá:</b> ${payload?.exchangeRate ? parseFloat(payload.exchangeRate).toString() : '1.00'}

<b>🏦 THÔNG TIN NGÂN HÀNG</b>
<b>Người nhận/Chi trả:</b> ${payload?.payerReceiver || 'N/A'}
<b>Tài khoản:</b> ${payload?.bankAccount || 'N/A'}
<b>Ngân hàng:</b> ${payload?.bankCode || 'N/A'}
<b>Tài khoản kế toán:</b> ${payload?.accountId || 'N/A'}

<b>📋 CHI TIẾT HẠNG MỤC</b>
`;

    // Add details if provided
    if (details && details.length > 0) {
      details.forEach((detail, idx) => {
        const taxRate = parseFloat(detail.taxRate?.toString() || '0');
        const taxPercent = taxRate > 1 ? taxRate : taxRate * 100; // Handle both 10 and 0.1 formats
        const totalAmount = parseFloat(detail.amount?.toString() || '0') + parseFloat(detail.taxAmount?.toString() || '0');
        
        text += `
${idx + 1}. <b>${detail.description}</b>
   • Số lượng: ${detail.quantity}
   • Đơn giá: ${parseFloat(detail.amount?.toString() || '0').toLocaleString('vi-VN')} VND
   • Thuế (${taxPercent.toFixed(0)}%): ${parseFloat(detail.taxAmount?.toString() || '0').toLocaleString('vi-VN')} VND
   • Thành tiền: ${totalAmount.toLocaleString('vi-VN')} VND
   • Hạng mục: ${detail.expenseCategory || 'N/A'}
   • Đối tượng: ${detail.expenseObject || 'N/A'}
`;
      });
    }

    text += `
<b>📎 PHỤ LỤC</b>
<b>Ghi chú:</b> ${payload?.note || 'Không có'}
<b>Số tập tin đính kèm:</b> ${payload?.attachments?.length || 0}
`;

    // Add attachments details if provided
    if (payload?.attachments && Array.isArray(payload.attachments) && payload.attachments.length > 0) {
      text += `<b>Danh sách tập tin:</b>\n`;
      payload.attachments.forEach((att: any, idx: number) => {
        if (typeof att === 'string') {
          // URL
          text += `${idx + 1}. <a href="${att}">Tập tin ${idx + 1}</a>\n`;
        } else if (typeof att === 'object') {
          // Object with name/id
          const name = att.name || att.id || `File ${idx + 1}`;
          if (att.url) {
            text += `${idx + 1}. <a href="${att.url}">${name}</a>\n`;
          } else {
            text += `${idx + 1}. ${name}\n`;
          }
        }
      });
    } else {
      // Debug: show what we got
      this.logger.log(`🔍 No attachments or empty array. payload.attachments: ${JSON.stringify(payload?.attachments)}`);
    }

    text += `
---
<b>✅ Vui lòng duyệt hoặc từ chối phiếu chi này</b>
    `;

    const buttons = [
      [
        {
          text: '✅ DUYỆT',
          callback_data: `voucher_approve_${voucher.id}`,
        },
        {
          text: '❌ TỪ CHỐI',
          callback_data: `voucher_reject_${voucher.id}`,
        },
      ],
    ];

    return { text, buttons };
  }

  /**
   * Send approval message to approver
   */
  async sendApprovalMessage(
    telegramId: string,
    voucher: any,
    createdBy: any,
    approverEmail: string,
    details?: any[],
    payload?: any,
  ) {
    // If details/payload not provided, try to load from voucher metadata
    if (!details || !payload) {
      try {
        const metadata = voucher.metadata ? JSON.parse(voucher.metadata) : {};
        if (!details) details = metadata.details;
        if (!payload) payload = metadata.payload;
      } catch (e) {
        this.logger.warn(`Could not parse voucher metadata: ${e.message}`);
      }
    }

    const { text, buttons } = this.buildApprovalMessage(
      voucher,
      createdBy,
      approverEmail,
      details,
      payload,
    );
    await this.telegramNotiService.sendMessageWithButtons(
      telegramId,
      text,
      buttons,
    );
    this.logger.log(`✅ Approval message sent to ${telegramId}`);
  }

  /**
   * Handle approval - send to next person in chain
   */
  async approve(voucherId: string, approverEmail: string) {
    this.logger.log(`✅ Approving voucher ${voucherId} by ${approverEmail}`);

    try {
      // Find current approver index
      const currentIdx = this.APPROVAL_CHAIN.findIndex(
        (a) => a.email === approverEmail,
      );
      if (currentIdx < 0) {
        this.logger.error(`Approver not in chain: ${approverEmail}`);
        return false;
      }

      // Find and mark approval as approved
      const approval = await this.prisma.approval.findFirst({
        where: { voucherId, approvedBy: approverEmail },
      });

      if (!approval) {
        this.logger.error(`Approval not found: ${voucherId} / ${approverEmail}`);
        return false;
      }

      await this.prisma.approval.update({
        where: { id: approval.id },
        data: {
          status: 'approved',
          approvedAt: new Date(),
        },
      });

      this.logger.log(`📌 Marked as approved: ${voucherId}`);

      // Get voucher for notifications
      const voucher = await this.prisma.voucher.findUnique({
        where: { id: voucherId },
      });

      if (!voucher) {
        this.logger.error(`Voucher not found: ${voucherId}`);
        return false;
      }

      // Check if all approvals done
      const allApprovals = await this.prisma.approval.findMany({
        where: { voucherId },
      });

      const allApproved = allApprovals.every((a) => a.status === 'approved');

      if (allApproved) {
        // All approved - update voucher to APPROVED
        await this.prisma.voucher.update({
          where: { id: voucherId },
          data: { status: 'approved' },
        });

        this.logger.log(`🎉 Voucher fully approved: ${voucherId}`);

        // Call ERP to approve
        try {
          await this.erpClient.approveVoucher(voucher, 'Approved by all 3 approvers');
          this.logger.log(`📤 ERP voucher approved: ${voucher.voucherNumber}`);
        } catch (erpError) {
          this.logger.error(`⚠️ ERP approval failed: ${erpError.message}`);
          // Don't fail the entire approval flow if ERP call fails
        }

        // Notify creator
        if (voucher.userId) {
          const creator = await this.prisma.user.findUnique({
            where: { id: voucher.userId },
          });

          if (creator?.telegramId) {
            const msg = `
<b>✅ PHIẾU CHI ĐÃ ĐƯỢC DUYỆT HOÀN TOÀN</b>

🎫 <b>${voucher.voucherNumber}</b>
💰 <b>${parseFloat(voucher.amount?.toString() || '0').toLocaleString('vi-VN')} VND</b>

Phiếu chi của bạn đã được tất cả 3 người phê duyệt! ✨

Bạn có thể tiến hành xử lý tiếp theo.
            `;
            await this.telegramNotiService.sendMessage(creator.telegramId, msg);
          }
        }

        // Notify first approver (Chị Quỳnh) - người đầu tiên
        const firstApprover = this.APPROVAL_CHAIN[0];
        if (firstApprover) {
          const msg = `
<b>✅ PHIẾU CHI ĐÃ DUYỆT XONG CẢ 3 BƯỚC</b>

🎫 <b>${voucher.voucherNumber}</b>
💰 <b>${parseFloat(voucher.amount?.toString() || '0').toLocaleString('vi-VN')} VND</b>

Phiếu chi đã được tất cả mọi người phê duyệt và sẵn sàng xử lý! 🎉
          `;
          await this.telegramNotiService.sendMessage(firstApprover.telegramId, msg);
        }
      } else {
        // Send to next approver
        const nextApprover = this.APPROVAL_CHAIN[currentIdx + 1];
        if (nextApprover) {
          const createdBy = voucher.userId
            ? await this.prisma.user.findUnique({
                where: { id: voucher.userId },
              })
            : null;

          await this.sendApprovalMessage(
            nextApprover.telegramId,
            voucher,
            createdBy
              ? {
                  userId: createdBy.id,
                  email: createdBy.email,
                  fullName: createdBy.name,
                }
              : { fullName: 'ERP System', email: 'system@company.com' },
            nextApprover.email,
          );

          this.logger.log(`📤 Forwarded to next approver: ${nextApprover.email}`);

          // Notify current approver
          const currentApprover = this.APPROVAL_CHAIN[currentIdx];
          const msg = `<b>✅ Bạn đã duyệt phiếu ${voucher.voucherNumber}</b>\n\n⏳ Chờ phê duyệt từ <b>${nextApprover.name}</b>...`;
          await this.telegramNotiService.sendMessage(currentApprover.telegramId, msg);
        }
      }

      return true;
    } catch (error) {
      this.logger.error('❌ Approve error:', error.message);
      return false;
    }
  }

  /**
   * Handle rejection - reset to PROCESSING
   */
  async reject(voucherId: string, approverEmail: string, reason?: string) {
    this.logger.log(`❌ Rejecting voucher ${voucherId} by ${approverEmail}`);

    try {
      // Find current approver index
      const currentIdx = this.APPROVAL_CHAIN.findIndex(
        (a) => a.email === approverEmail,
      );
      if (currentIdx < 0) {
        this.logger.error(`Approver not in chain: ${approverEmail}`);
        return false;
      }

      // Find and mark approval as rejected
      const approval = await this.prisma.approval.findFirst({
        where: { voucherId, approvedBy: approverEmail },
      });

      if (!approval) {
        this.logger.error(`Approval not found: ${voucherId} / ${approverEmail}`);
        return false;
      }

      await this.prisma.approval.update({
        where: { id: approval.id },
        data: {
          status: 'rejected',
          rejectionReason: reason || 'Không có lý do',
        },
      });

      // Reset all other approvals to PENDING
      await this.prisma.approval.updateMany({
        where: { voucherId, approvedBy: { not: approverEmail } },
        data: { status: 'pending' },
      });

      // Reset voucher to PROCESSING
      const voucher = await this.prisma.voucher.findUnique({
        where: { id: voucherId },
      });

      if (!voucher) {
        this.logger.error(`Voucher not found: ${voucherId}`);
        return false;
      }

      await this.prisma.voucher.update({
        where: { id: voucherId },
        data: { status: 'processing' },
      });

      this.logger.log(`📌 Voucher reset to PROCESSING: ${voucherId}`);

      // Call ERP to reject
      try {
        await this.erpClient.rejectVoucher(voucherId, reason || 'Rejected via Telegram Bot');
        this.logger.log(`📤 ERP voucher rejected: ${voucherId}`);
      } catch (erpError) {
        this.logger.error(`⚠️ ERP rejection failed: ${erpError.message}`);
        // Don't fail the entire rejection flow if ERP call fails
      }

      // Notify creator
      if (voucher.userId) {
        const creator = await this.prisma.user.findUnique({
          where: { id: voucher.userId },
        });

        if (creator?.telegramId) {
          const rejector = this.APPROVAL_CHAIN[currentIdx];
          const msg = `
<b>⚠️ PHIẾU CHI BỊ TỪ CHỐI</b>

🎫 <b>${voucher.voucherNumber}</b>
💰 <b>${parseFloat(voucher.amount?.toString() || '0').toLocaleString('vi-VN')} VND</b>
👤 Người từ chối: <b>${rejector.name}</b> (${approverEmail})

📝 <b>Lý do:</b> ${reason || 'Không có lý do'}

🔄 Vui lòng sửa chữa và gửi lại phiếu chi.
          `;
          await this.telegramNotiService.sendMessage(creator.telegramId, msg);
        }
      }

      // Notify all previous approvers who already approved
      for (let i = 0; i < currentIdx; i++) {
        const prevApprover = this.APPROVAL_CHAIN[i];
        const msg = `<b>⚠️ Phiếu ${voucher.voucherNumber} bị từ chối</b>\n\n👤 Người từ chối: ${this.APPROVAL_CHAIN[currentIdx].name}\n📝 Lý do: ${reason || 'Không có lý do'}`;
        await this.telegramNotiService.sendMessage(prevApprover.telegramId, msg);
      }

      return true;
    } catch (error) {
      this.logger.error('❌ Reject error:', error.message);
      return false;
    }
  }
}
