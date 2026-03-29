import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LLMGatewayService } from '../llm-gateway/llm-gateway.service';

interface VoucherDraftRequest {
  userId: string;
  projectId?: string;
  amount: number;
  reason: string;
  telegramId?: string;
}

interface ConfirmationState {
  telegramId: string;
  step: 'confirm' | 'approved';
  voucherData: VoucherDraftRequest;
  requestId: string;
  timestamp: Date;
  expiresAt: Date;
}

@Injectable()
export class VoucherAutomationService {
  // Store pending confirmations (in-memory, can upgrade to Redis)
  private pendingConfirmations = new Map<string, ConfirmationState>();

  constructor(private prisma: PrismaService, private llmGateway: LLMGatewayService) {}

  /**
   * Step 1: Parse Telegram intent → Create voucher draft
   * Returns: Confirmation message for user to approve
   */
  async parseVoucherIntent(
    telegramId: string,
    message: string,
  ): Promise<{
    requiresConfirmation: boolean;
    confirmationId?: string;
    voucherData?: VoucherDraftRequest;
    message: string;
  }> {
    try {
      // Use Groq to extract voucher intent
      const systemPrompt = `
Bạn là AI trợ lý cho hệ thống quản lý voucher.
Phân tích tin nhắn tiếng Việt để trích xuất ý định tạo voucher.

Nếu người dùng muốn tạo voucher, trả lời JSON format:
{
  "intent": "create_voucher",
  "amount": <số tiền>,
  "reason": "<lý do>",
  "projectCode": "<mã dự án nếu có>"
}

Nếu không phải voucher, trả lời:
{
  "intent": "other",
  "message": "<trả lời giúp đỡ>"
}
`;

      const response = await this.llmGateway.chat(message, systemPrompt);

      let parsed;
      try {
        parsed = JSON.parse(response);
      } catch {
        return {
          requiresConfirmation: false,
          message: response,
        };
      }

      if (parsed.intent !== 'create_voucher') {
        return {
          requiresConfirmation: false,
          message: parsed.message || 'Tôi hiểu, nhưng bạn muốn làm gì?',
        };
      }

      // Find project by code
      let projectId: string | undefined;
      if (parsed.projectCode) {
        const project = await this.prisma.project.findFirst({
          where: { code: parsed.projectCode },
        });
        projectId = project?.id;
      }

      // Get user by telegramId
      const user = await this.prisma.user.findFirst({
        where: { telegramId },
      });

      if (!user) {
        return {
          requiresConfirmation: false,
          message: '❌ Người dùng không tìm thấy. Liên hệ admin.',
        };
      }

      const voucherData: VoucherDraftRequest = {
        userId: user.id,
        projectId,
        amount: parsed.amount,
        reason: parsed.reason,
        telegramId,
      };

      // Create confirmation state
      const requestId = `vch_${Date.now()}_${telegramId}`;
      const confirmationState: ConfirmationState = {
        telegramId,
        step: 'confirm',
        voucherData,
        requestId,
        timestamp: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min expiry
      };

      this.pendingConfirmations.set(requestId, confirmationState);

      return {
        requiresConfirmation: true,
        confirmationId: requestId,
        voucherData,
        message: `✅ Xác nhận tạo voucher:\n\n📌 Số tiền: ${parsed.amount.toLocaleString('vi-VN')} VND\n📝 Lý do: ${parsed.reason}\n\n👉 Gửi "YES ${requestId}" để xác nhận\n👉 Gửi "NO" để hủy`,
      };
    } catch (error) {
      console.error('Error parsing voucher intent:', error);
      return {
        requiresConfirmation: false,
        message: '❌ Có lỗi khi xử lý. Thử lại sau.',
      };
    }
  }

  /**
   * Step 2: User confirms → Create voucher draft
   */
  async confirmVoucher(
    telegramId: string,
    confirmationId: string,
  ): Promise<{
    success: boolean;
    voucherId?: string;
    message: string;
  }> {
    const confirmation = this.pendingConfirmations.get(confirmationId);

    if (!confirmation) {
      return {
        success: false,
        message: '❌ Xác nhận hết hạn hoặc không tìm thấy.',
      };
    }

    if (confirmation.expiresAt < new Date()) {
      this.pendingConfirmations.delete(confirmationId);
      return {
        success: false,
        message: '❌ Xác nhận hết hạn (5 phút).',
      };
    }

    if (confirmation.telegramId !== telegramId) {
      return {
        success: false,
        message: '❌ Người xác nhận không khớp.',
      };
    }

    try {
      const voucherData = confirmation.voucherData;

      // Create voucher draft
      const voucher = await this.prisma.voucher.create({
        data: {
          voucherNumber: `VCH-${Date.now()}`,
          userId: voucherData.userId,
          projectId: voucherData.projectId,
          amount: voucherData.amount.toString(),
          reason: voucherData.reason,
          status: 'draft',
          approvalLevel: 0,
          createdAt: new Date(),
        },
      });

      // Clean up confirmation
      this.pendingConfirmations.delete(confirmationId);

      // Log to audit
      await this.prisma.botLog.create({
        data: {
          action: 'voucher_draft_created',
          status: 'success',
          voucherId: voucher.id,
          details: {
            confirmationId,
            amount: voucherData.amount,
            reason: voucherData.reason,
          },
        },
      });

      return {
        success: true,
        voucherId: voucher.id,
        message: `✅ Tạo voucher nháp thành công!\n🔖 ID: ${voucher.voucherNumber}\n📌 Số tiền: ${voucherData.amount.toLocaleString('vi-VN')} VND\n\n⏳ Chờ accountant duyệt...`,
      };
    } catch (error) {
      console.error('Error confirming voucher:', error);
      return {
        success: false,
        message: '❌ Lỗi tạo voucher. Thử lại sau.',
      };
    }
  }

  /**
   * Step 3: Reject confirmation
   */
  async rejectVoucher(confirmationId: string): Promise<string> {
    this.pendingConfirmations.delete(confirmationId);
    return '❌ Đã hủy.';
  }

  /**
   * Get pending confirmations for user (for monitoring)
   */
  getPendingConfirmations(telegramId: string): ConfirmationState[] {
    return Array.from(this.pendingConfirmations.values()).filter(
      (c) => c.telegramId === telegramId && c.expiresAt > new Date(),
    );
  }

  /**
   * Clean up expired confirmations (periodic task)
   */
  cleanupExpiredConfirmations(): number {
    const now = new Date();
    let count = 0;

    for (const [key, confirmation] of this.pendingConfirmations.entries()) {
      if (confirmation.expiresAt < now) {
        this.pendingConfirmations.delete(key);
        count++;
      }
    }

    return count;
  }
}
