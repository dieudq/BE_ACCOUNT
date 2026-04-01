import { Controller, Post, Body, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VoucherApprovalService } from '../approvals/voucher-approval.service';
import { Prisma } from '@prisma/client';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  // Map ERP user IDs to email + Telegram của Bot
  private readonly USER_MAP = {
    'user_quynh_01': { email: 'quynh@company.com', telegramId: '5377791753', name: 'Chị Quỳnh' },
    'user_linh_02': { email: 'linh@company.com', telegramId: '6322212345', name: 'Chị Linh' },
    'user_long_03': { email: 'long@company.com', telegramId: '7411123456', name: 'Anh Long' },
  };

  constructor(
    private prisma: PrismaService,
    private voucherApprovalService: VoucherApprovalService,
  ) {}

  @Post('erp')
  async handleERPWebhook(@Body() payload: any) {
    this.logger.log('📥 ERP Webhook received: ' + (payload.code || 'NO_CODE'));

    try {
      const {
        voucherId,
        code, // ERP gửi là "code"
        content,
        totalAmount,
        createdBy,
        details,
        approvals,
        note,
      } = payload;

      // Kiểm tra trường bắt buộc
      if (!code) {
        this.logger.error('❌ code missing in payload');
        return { success: false, error: 'code required' };
      }

      // 1. Đảm bảo Người tạo (User) tồn tại trong DB Bot (Fix vouchers_userId_fkey)
      const creatorId = createdBy?.userId || 'system';
      await this.prisma.user.upsert({
        where: { id: creatorId },
        update: { name: createdBy?.fullName, email: createdBy?.email },
        create: {
          id: creatorId,
          name: createdBy?.fullName || 'ERP System',
          email: createdBy?.email || 'system@company.com',
          role: 'employee',
        },
      });

      // 2. Đảm bảo Project tồn tại trong DB Bot (Fix vouchers_projectId_fkey)
      const projectId = details?.[0]?.projectId || null;
      if (projectId) {
        await this.prisma.project.upsert({
          where: { id: projectId },
          update: {}, // Nếu có rồi thì giữ nguyên
          create: {
            id: projectId,
            name: details[0].project?.name || 'Project ERP',
            code: details[0].project?.code || projectId,
          },
        });
        this.logger.log(`📂 Project verified/created: ${projectId}`);
      }

      // 3. Lưu Voucher vào Database
      const voucher = await this.prisma.voucher.create({
        data: {
          id: voucherId || `vch_${Date.now()}`,
          voucherNumber: code,
          amount: totalAmount ? new Prisma.Decimal(totalAmount.toString()) : new Prisma.Decimal(0),
          reason: content || note,
          status: 'processing',
          userId: creatorId,
          projectId: projectId, // Bây giờ đã tuyệt đối an toàn
          lockedAt: null,
          metadata: JSON.stringify({
            payload: payload,
            details: details,
          }),
        },
      });

      this.logger.log(`✅ Voucher saved: ${voucher.voucherNumber}`);

      // 4. Xử lý danh sách người duyệt (Approvals)
      let approvalsToProcess = approvals;

      // Nếu ERP không gửi approvals → tự tạo chain mặc định theo USER_MAP
      if (!approvals || approvals.length === 0) {
        this.logger.log(`⚠️ No approvals in payload, using default chain`);
        approvalsToProcess = [
          { approverId: 'user_quynh_01', index: 0 },
          { approverId: 'user_linh_02', index: 1 },
          { approverId: 'user_long_03', index: 2 },
        ];
      }

      if (approvalsToProcess && Array.isArray(approvalsToProcess)) {
        for (const app of approvalsToProcess) {
          const approverInfo = this.USER_MAP[app.approverId];
          if (approverInfo) {
            await this.prisma.approval.create({
              data: {
                voucherId: voucher.id,
                approvedBy: approverInfo.email,
                status: 'pending',
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Hết hạn sau 7 ngày
              },
            });
          }
        }
      }

      // 5. Gửi tin nhắn Telegram cho người duyệt đầu tiên
      const firstApproval = approvalsToProcess?.[0];
      if (firstApproval) {
        const firstApproverInfo = this.USER_MAP[firstApproval.approverId];

        if (firstApproverInfo) {
          await this.voucherApprovalService.sendApprovalMessage(
            firstApproverInfo.telegramId,
            voucher,
            createdBy || { fullName: 'ERP System', email: 'system@company.com' },
            firstApproverInfo.email,
            details,
            payload,
          );
          this.logger.log(`📤 Approval request sent to: ${firstApproverInfo.name}`);
        } else {
          this.logger.error(`❌ Cannot find approver info for: ${firstApproval.approverId}`);
        }
      }

      return { success: true, data: voucher };

    } catch (error) {
      this.logger.error('❌ Webhook error: ' + error.message);
      return { success: false, error: error.message };
    }
  }
}