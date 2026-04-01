import { Controller, Post, Body, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramVoucherService } from '../telegram/telegram-voucher.service';
import { Prisma } from '@prisma/client';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private prisma: PrismaService,
    private telegramVoucherService: TelegramVoucherService,
  ) {}

  @Post('erp')
  async handleERPWebhook(@Body() payload: any) {
    this.logger.log(
      `📥 Nhận Webhook ERP cho phiếu: ${payload.voucherCode || payload.code}`,
    );

    try {
      const {
        voucherId, // ID gốc từ DB ERP (UUID/CUID)
        voucherCode,
        code,
        createdBy,
        totalAmount,
        content,
      } = payload;

      const finalCode = voucherCode || code;
      if (!finalCode) {
        throw new Error('Thiếu mã phiếu chi (voucherCode/code)');
      }

      // 1. Xử lý User (Người lập phiếu từ ERP)
      const creatorId = createdBy?.userId || 'system';
      const creatorName = createdBy?.fullName || createdBy?.name || 'ERP User';
      const creatorEmail = createdBy?.email || 'system@company.com';

      await this.prisma.user.upsert({
        where: { id: creatorId },
        update: {
          name: creatorName,
          email: creatorEmail,
        },
        create: {
          id: creatorId,
          name: creatorName,
          email: creatorEmail,
          role: 'employee',
        },
      });

      // 2. Lưu Voucher và Metadata vào Database của Bot
      // Lưu ý: erpId là trường quan trọng nhất để gọi ngược lại API ERP
      const voucher = await this.prisma.voucher.upsert({
        where: { voucherNumber: finalCode },
        update: {
          erpId: voucherId,
          amount: new Prisma.Decimal(totalAmount || 0),
          reason: content || 'Không có nội dung',
          metadata: { payload }, // Lưu Object trực tiếp vào cột Json
        },
        create: {
          erpId: voucherId,
          voucherNumber: finalCode,
          amount: new Prisma.Decimal(totalAmount || 0),
          reason: content || 'Không có nội dung',
          userId: creatorId,
          metadata: { payload },
        },
      });

      // 3. Kích hoạt quy trình duyệt trên Telegram
      // Gửi sang Service để bắn tin cho người duyệt cấp 1 (Như Quỳnh)
      await this.telegramVoucherService.startApprovalProcess(
        voucher,
        { fullName: creatorName, email: creatorEmail },
        payload,
      );

      return {
        success: true,
        message: 'Webhook processed and Telegram notification sent',
        botVoucherId: voucher.id,
      };
    } catch (error: any) {
      this.logger.error('❌ Webhook error: ' + error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
