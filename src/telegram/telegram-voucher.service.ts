import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotiService } from '../common/services/telegram-noti.service';

@Injectable()
export class TelegramVoucherService {
  private readonly logger = new Logger(TelegramVoucherService.name);

  // Sequential approval chain: Quỳnh → Linh → Long
  private readonly APPROVAL_CHAIN = [
    { email: 'quynh@company.com', telegramId: '5377791753', name: 'Chị Quỳnh', order: 0 },
    { email: 'linh@company.com', telegramId: '5377791753', name: 'Chị Linh', order: 1 },
    { email: 'long@company.com', telegramId: '5377791753', name: 'Anh Long', order: 2 },
  ];

  constructor(
    private prisma: PrismaService,
    private telegramNotiService: TelegramNotiService,
  ) {}


  async sendVoucherToApprovalChain(voucher: any, createdBy: any) {
    try {
      this.logger.log(`📤 Sending voucher ${voucher.voucherNumber} to approval chain`);

      // Create approval records for all in chain
      for (const approver of this.APPROVAL_CHAIN) {
        const existing = await this.prisma.approval.findFirst({
          where: {
            voucherId: voucher.id,
            approvedBy: approver.email,
          },
        });

        if (!existing) {
          await this.prisma.approval.create({
            data: {
              voucherId: voucher.id,
              approvedBy: approver.email,
              status: 'pending',
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          });
        }
      }

      // Send to first approver
      const firstApprover = this.APPROVAL_CHAIN[0];
      await this.sendApprovalMessage(
        firstApprover.telegramId,
        voucher,
        createdBy,
        firstApprover,
      );

      this.logger.log(
        `✅ Voucher sent to ${firstApprover.name} (${firstApprover.email})`,
      );
    } catch (error) {
      this.logger.error('❌ Error sending to approval chain:', error.message);
    }
  }

  /**
   * Format và gửi tin nhắn duyệt với button
   */
  private async sendApprovalMessage(
    telegramId: string,
    voucher: any,
    createdBy: any,
    approver: any,
  ) {
    const message = `
🎫 *Phiếu Chi Cần Duyệt - ${voucher.voucherNumber}*
Bước ${approver.order + 1}/${this.APPROVAL_CHAIN.length}

👤 *Người lập:* ${createdBy?.fullName || 'Unknown'}
📧 ${createdBy?.email}

📝 *Nội dung:* ${voucher.reason}
💰 *Số tiền:* ${parseFloat(voucher.amount?.toString() || '0').toLocaleString('vi-VN')} VND

📅 *Ngày:* ${new Date(voucher.createdAt).toLocaleDateString('vi-VN')}

---
⏳ Vui lòng kiểm tra và phê duyệt hoặc từ chối
    `;

    const buttons = [
      [
        {
          text: '✅ Duyệt',
          callback_data: `voucher_approve_${voucher.id}`,
        },
        {
          text: '❌ Từ chối',
          callback_data: `voucher_reject_${voucher.id}`,
        },
      ],
      [
        {
          text: '📋 Xem chi tiết',
          url: `http://localhost:5173/accounting/vouchers/${voucher.id}`,
        },
      ],
    ];

    await this.telegramNotiService.sendMessageWithButtons(
      telegramId,
      message,
      buttons,
    );
  }

  /**
   * Duyệt phiếu - chuyển sang người tiếp theo
   */
  async approveVoucher(voucherId: string, approverEmail: string) {
    try {
      this.logger.log(`✅ Approving voucher ${voucherId} by ${approverEmail}`);

      // Find approver in chain
      const currentApprover = this.APPROVAL_CHAIN.find(
        (a) => a.email === approverEmail,
      );
      if (!currentApprover) {
        this.logger.error(`Approver not in chain: ${approverEmail}`);
        return false;
      }

      // Update approval status
      const approval = await this.prisma.approval.findFirst({
        where: { voucherId, approvedBy: approverEmail },
      });

      if (!approval) {
        this.logger.error(`Approval record not found`);
        return false;
      }

      await this.prisma.approval.update({
        where: { id: approval.id },
        data: {
          status: 'approved',
          approvedAt: new Date(),
        },
      });

      // Get voucher
      const voucher = await this.prisma.voucher.findUnique({
        where: { id: voucherId },
      });

      if (!voucher) {
        this.logger.error(`Voucher not found: ${voucherId}`);
        return false;
      }

      // Check if all approved
      const allApprovals = await this.prisma.approval.findMany({
        where: { voucherId },
      });

      const allApproved = allApprovals.every((a) => a.status === 'approved');

      if (allApproved) {
        // Hoàn tất - update voucher
        await this.prisma.voucher.update({
          where: { id: voucherId },
          data: { status: 'approved' },
        });

        // Notify creator - phiếu đã được duyệt hoàn toàn
        if (voucher.userId) {
          const creator = await this.prisma.user.findUnique({
            where: { id: voucher.userId },
          });

          if (creator?.telegramId) {
            const msg = `
✅ *Phiếu Chi Đã Được Duyệt Hoàn Toàn*

🎫 ${voucher.voucherNumber}
💰 ${parseFloat(voucher.amount?.toString() || '0').toLocaleString('vi-VN')} VND

Phiếu chi của bạn đã được tất cả mọi người phê duyệt! ✨
            `;
            await this.telegramNotiService.sendMessage(creator.telegramId, msg);
          }
        }

        this.logger.log(`🎉 Voucher fully approved: ${voucherId}`);
      } else {
        // Send to next approver
        const nextApprover = this.APPROVAL_CHAIN[currentApprover.order + 1];
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
              : {},
            nextApprover,
          );

          // Notify current approver
          const notifyMsg = `✅ Bạn đã duyệt phiếu ${voucher.voucherNumber}.\n\n⏳ Chờ ${nextApprover.name} duyệt...`;
          await this.telegramNotiService.sendMessage(
            currentApprover.telegramId,
            notifyMsg,
          );

          this.logger.log(
            `📤 Voucher sent to ${nextApprover.name} (step ${nextApprover.order + 1})`,
          );
        }
      }

      return true;
    } catch (error) {
      this.logger.error('❌ Approval error:', error.message);
      return false;
    }
  }

  /**
   * Từ chối phiếu - quay lại chỉnh sửa
   */
  async rejectVoucher(
    voucherId: string,
    approverEmail: string,
    reason?: string,
  ) {
    try {
      this.logger.log(`❌ Rejecting voucher ${voucherId} by ${approverEmail}`);

      // Find approver in chain
      const currentApprover = this.APPROVAL_CHAIN.find(
        (a) => a.email === approverEmail,
      );
      if (!currentApprover) {
        this.logger.error(`Approver not in chain: ${approverEmail}`);
        return false;
      }

      // Update approval status
      const approval = await this.prisma.approval.findFirst({
        where: { voucherId, approvedBy: approverEmail },
      });

      if (!approval) {
        this.logger.error(`Approval record not found`);
        return false;
      }

      await this.prisma.approval.update({
        where: { id: approval.id },
        data: {
          status: 'rejected',
          rejectionReason: reason || 'Không có lý do',
        },
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

      // Notify creator
      if (voucher.userId) {
        const creator = await this.prisma.user.findUnique({
          where: { id: voucher.userId },
        });

        if (creator?.telegramId) {
          const msg = `
⚠️ *Phiếu Chi Bị Từ Chối*

🎫 ${voucher.voucherNumber}
💰 ${parseFloat(voucher.amount?.toString() || '0').toLocaleString('vi-VN')} VND
👤 Người từ chối: ${currentApprover.name} (${approverEmail})

📝 *Lý do:* ${reason || 'Không có lý do'}

Vui lòng sửa và gửi lại phiếu chi.
          `;
          await this.telegramNotiService.sendMessage(creator.telegramId, msg);
        }
      }

      // Notify all previous approvers
      for (let i = 0; i < currentApprover.order; i++) {
        const prevApprover = this.APPROVAL_CHAIN[i];
        const notifyMsg = `⚠️ Phiếu ${voucher.voucherNumber} bị từ chối bởi ${currentApprover.name}\n\nLý do: ${reason || 'Không có lý do'}`;
        await this.telegramNotiService.sendMessage(
          prevApprover.telegramId,
          notifyMsg,
        );
      }

      this.logger.log(`Voucher rejected and reset for resubmission`);
      return true;
    } catch (error) {
      this.logger.error('❌ Rejection error:', error.message);
      return false;
    }
  }
}
