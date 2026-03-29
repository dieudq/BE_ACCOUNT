import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LLMGatewayService } from '../llm-gateway/llm-gateway.service';

interface ApprovalState {
  voucherId: string;
  telegramId: string;
  step: 'review' | 'approved' | 'rejected';
  voucherData: any;
  requestId: string;
  timestamp: Date;
  expiresAt: Date;
}

@Injectable()
export class ApprovalWorkflowService {
  private pendingApprovals = new Map<string, ApprovalState>();

  constructor(private prisma: PrismaService, private llmGateway: LLMGatewayService) {}

  /**
   * Get all pending vouchers for accountant review
   */
  async getPendingVouchers(accountantId: string) {
    try {
      const accountant = await this.prisma.user.findUnique({
        where: { id: accountantId },
      });

      if (!accountant || accountant.role !== 'admin') {
        return {
          success: false,
          message: '❌ Only admins can review vouchers',
          vouchers: [],
        };
      }

      const pendingVouchers = await this.prisma.voucher.findMany({
        where: {
          status: 'draft',
          approvalLevel: 0,
        },
        include: {
          user: true,
          project: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      return {
        success: true,
        count: pendingVouchers.length,
        vouchers: pendingVouchers.map((v) => ({
          id: v.id,
          number: v.voucherNumber,
          amount: parseFloat(v.amount?.toString() || '0'),
          reason: v.reason,
          requestedBy: v.user?.name,
          project: v.project?.code,
          createdAt: v.createdAt,
        })),
      };
    } catch (error) {
      console.error('Error getting pending vouchers:', error);
      return {
        success: false,
        message: '❌ Error fetching vouchers',
        vouchers: [],
      };
    }
  }

  /**
   * Request voucher details for review
   */
  async requestVoucherForReview(
    telegramId: string,
    voucherId: string,
  ): Promise<{
    success: boolean;
    message: string;
    requestId?: string;
  }> {
    try {
      // Verify user is accountant
      const user = await this.prisma.user.findFirst({
        where: { telegramId },
      });

      if (!user || user.role !== 'admin') {
        return {
          success: false,
          message: '❌ Only accountants can approve vouchers',
        };
      }

      // Get voucher
      const voucher = await this.prisma.voucher.findUnique({
        where: { id: voucherId },
        include: { user: true, project: true },
      });

      if (!voucher) {
        return {
          success: false,
          message: '❌ Voucher not found',
        };
      }

      if (voucher.status !== 'draft') {
        return {
          success: false,
          message: `❌ Voucher status is ${voucher.status}, not draft`,
        };
      }

      // Create approval request
      const requestId = `app_${Date.now()}_${telegramId}`;
      const approvalState: ApprovalState = {
        voucherId,
        telegramId,
        step: 'review',
        voucherData: voucher,
        requestId,
        timestamp: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min
      };

      this.pendingApprovals.set(requestId, approvalState);

      // Format details for accountant
      const details = `
📋 **Xét duyệt Voucher**

🔖 ID: ${voucher.voucherNumber}
💰 Số tiền: ${parseFloat(voucher.amount?.toString() || '0').toLocaleString('vi-VN')} VND
📝 Lý do: ${voucher.reason}
👤 Người yêu cầu: ${voucher.user?.name}
📂 Dự án: ${voucher.project?.code || 'N/A'}
📅 Ngày tạo: ${voucher.createdAt.toLocaleDateString('vi-VN')}

Trả lời:
- "APPROVE ${requestId}" để duyệt
- "REJECT ${requestId}" để từ chối
      `.trim();

      return {
        success: true,
        message: details,
        requestId,
      };
    } catch (error) {
      console.error('Error requesting voucher review:', error);
      return {
        success: false,
        message: '❌ Error loading voucher details',
      };
    }
  }

  /**
   * Approve voucher → Create PhieuChi
   */
  async approveVoucher(
    telegramId: string,
    requestId: string,
  ): Promise<{
    success: boolean;
    message: string;
    phieuChiId?: string;
  }> {
    const approval = this.pendingApprovals.get(requestId);

    if (!approval) {
      return {
        success: false,
        message: '❌ Approval request expired or not found',
      };
    }

    if (approval.expiresAt < new Date()) {
      this.pendingApprovals.delete(requestId);
      return {
        success: false,
        message: '❌ Approval expired (30 phút)',
      };
    }

    if (approval.telegramId !== telegramId) {
      return {
        success: false,
        message: '❌ Không phải người xét duyệt',
      };
    }

    try {
      // Update voucher status
      const updatedVoucher = await this.prisma.voucher.update({
        where: { id: approval.voucherId },
        data: {
          status: 'approved',
          approvalLevel: 1,
          approvedAt: new Date(),
        },
      });

      // Create PhieuChi (payment slip)
      const phieuChi = await this.prisma.phieuChi.create({
        data: {
          voucherId: approval.voucherId,
          phieuChiNumber: `PC-${Date.now()}`,
          content: `Phiếu chi - ${approval.voucherData.reason}`,
          generatedAt: new Date(),
        },
      });

      // Log approval
      await this.prisma.botLog.create({
        data: {
          action: 'voucher_approved',
          status: 'success',
          voucherId: approval.voucherId,
          details: {
            approvalId: requestId,
            phieuChiId: phieuChi.id,
            amount: approval.voucherData.amount,
          },
        },
      });

      // Clean up
      this.pendingApprovals.delete(requestId);

      return {
        success: true,
        phieuChiId: phieuChi.id,
        message: `✅ Voucher đã được duyệt!

🔖 Phiếu chi: ${phieuChi.phieuChiNumber}
💰 Số tiền: ${parseFloat(approval.voucherData.amount?.toString() || '0').toLocaleString('vi-VN')} VND
📝 Nội dung: ${approval.voucherData.reason}

⏳ Chờ HR xử lý chi trả...`,
      };
    } catch (error) {
      console.error('Error approving voucher:', error);
      return {
        success: false,
        message: '❌ Lỗi khi duyệt voucher',
      };
    }
  }

  /**
   * Reject voucher
   */
  async rejectVoucher(
    telegramId: string,
    requestId: string,
    reason: string,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const approval = this.pendingApprovals.get(requestId);

    if (!approval) {
      return {
        success: false,
        message: '❌ Approval request not found',
      };
    }

    if (approval.telegramId !== telegramId) {
      return {
        success: false,
        message: '❌ Không phải người xét duyệt',
      };
    }

    try {
      // Update voucher status
      await this.prisma.voucher.update({
        where: { id: approval.voucherId },
        data: {
          status: 'rejected',
          approvalLevel: -1,
        },
      });

      // Log rejection
      await this.prisma.botLog.create({
        data: {
          action: 'voucher_rejected',
          status: 'success',
          voucherId: approval.voucherId,
          details: {
            rejectionReason: reason,
            approvalId: requestId,
          },
        },
      });

      // Clean up
      this.pendingApprovals.delete(requestId);

      return {
        success: true,
        message: `❌ Voucher đã bị từ chối

Lý do: ${reason}`,
      };
    } catch (error) {
      console.error('Error rejecting voucher:', error);
      return {
        success: false,
        message: '❌ Lỗi khi từ chối voucher',
      };
    }
  }

  /**
   * Get pending approvals for user
   */
  getPendingApprovals(telegramId: string): ApprovalState[] {
    return Array.from(this.pendingApprovals.values()).filter(
      (a) => a.telegramId === telegramId && a.expiresAt > new Date(),
    );
  }

  /**
   * Clean up expired approvals
   */
  cleanupExpiredApprovals(): number {
    const now = new Date();
    let count = 0;

    for (const [key, approval] of this.pendingApprovals.entries()) {
      if (approval.expiresAt < now) {
        this.pendingApprovals.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Get voucher summary for dashboard
   */
  async getVoucherSummary(): Promise<{
    totalDraft: number;
    totalApproved: number;
    totalRejected: number;
    totalAmount: number;
  }> {
    const [draftCount, approvedCount, rejectedCount, allVouchers] =
      await Promise.all([
        this.prisma.voucher.count({ where: { status: 'draft' } }),
        this.prisma.voucher.count({ where: { status: 'approved' } }),
        this.prisma.voucher.count({ where: { status: 'rejected' } }),
        this.prisma.voucher.findMany({
          where: { status: 'approved' },
        }),
      ]);

    const totalAmount = allVouchers.reduce((sum, v) => {
      return sum + parseFloat(v.amount?.toString() || '0');
    }, 0);

    return {
      totalDraft: draftCount,
      totalApproved: approvedCount,
      totalRejected: rejectedCount,
      totalAmount,
    };
  }
}
