import { Controller, Post, Body, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private prisma: PrismaService) {}

  @Post('erp')
  async handleERPWebhook(@Body() payload: any) {
    this.logger.log('📥 ERP Webhook received:', JSON.stringify(payload));

    try {
      const { voucherNumber, userId, amount, reason, projectId, status } = payload;

      // Create voucher
      const voucher = await this.prisma.voucher.create({
        data: {
          voucherNumber,
          userId,
          amount,
          reason,
          projectId,
          status: status || 'pending',
        },
      });

      // Log webhook
      await this.prisma.botLog.create({
        data: {
          action: 'ERP_WEBHOOK',
          status: 'success',
          details: payload,
          voucherId: voucher.id,
        },
      });

      this.logger.log('✅ Voucher created:', voucher.id);
      return { success: true, data: voucher };
    } catch (error) {
      this.logger.error('❌ Webhook error:', error);

      // Log error
      await this.prisma.botLog.create({
        data: {
          action: 'ERP_WEBHOOK',
          status: 'error',
          details: { error: error.message, payload },
        },
      });

      return { success: false, error: error.message };
    }
  }
}
