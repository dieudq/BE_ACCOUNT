import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';

export interface ERPEvent {
  eventId: string;
  eventType: string; // "payment_approved", "payment_rejected", etc.
  timestamp: Date;
  processId: string; // Quy trình ID từ ERP
  data: {
    voucherId?: string;
    amount: number;
    reason: string;
    recipientName: string;
    recipientAccount?: string;
    paymentDate: string;
    approverName: string;
    attachments?: string[];
  };
}

@Injectable()
export class ERPEventListenerService {
  constructor(private prisma: PrismaService, private telegram: TelegramService) {}

  /**
   * Process event from ERP
   * Main entry point for webhook
   */
  async processEvent(event: ERPEvent): Promise<any> {
    console.log(`📨 ERP Event received: ${event.eventType} (${event.eventId})`);

    // Prevent duplicate processing
    const existingLog = await this.prisma.botLog.findFirst({
      where: {
        details: {
          path: ['erpEventId'],
          equals: event.eventId,
        },
      },
    });

    if (existingLog) {
      console.log(`⚠️ Event ${event.eventId} already processed`);
      return { status: 'duplicate', message: 'Event already processed' };
    }

    try {
      switch (event.eventType) {
        case 'payment_approved':
          return await this.handlePaymentApproved(event);

        case 'payment_rejected':
          return await this.handlePaymentRejected(event);

        case 'process_completed':
          return await this.handleProcessCompleted(event);

        default:
          console.warn(`Unknown event type: ${event.eventType}`);
          return { status: 'ignored', message: 'Unknown event type' };
      }
    } catch (error) {
      console.error(`Error processing ERP event: ${error.message}`, error);

      // Log error
      await this.prisma.botLog.create({
        data: {
          action: 'erp_event_error',
          status: 'error',
          details: {
            erpEventId: event.eventId,
            eventType: event.eventType,
            error: error.message,
            timestamp: new Date(),
          },
        },
      });

      throw error;
    }
  }

  /**
   * Helper: Send Telegram notification
   */
  private async sendTelegramNotification(text: string) {
    const allowedUsers = (process.env.ALLOWED_TELEGRAM_USERS || '').split(',').filter(Boolean);
    if (allowedUsers.length === 0) {
      console.warn('No ALLOWED_TELEGRAM_USERS configured');
      return;
    }

    try {
      const bot = this.telegram.getBot();
      for (const userId of allowedUsers) {
        await bot.sendMessage(userId, text);
      }
    } catch (err) {
      console.error('Error sending Telegram notification:', err);
    }
  }

  /**
   * Handle: Payment Approved
   * Auto-create PhieuChi + notify
   */
  async handlePaymentApproved(event: ERPEvent): Promise<any> {
    console.log(`💰 Payment approved: ${event.data.voucherId}`);

    // Find or create voucher
    let voucher: any = null;
    if (event.data.voucherId) {
      voucher = await this.prisma.voucher.findUnique({
        where: { id: event.data.voucherId },
      });
    }

    // If no voucher found, create one from ERP data
    if (!voucher) {
      const employee = await this.prisma.user.findFirst({
        where: { role: 'employee' },
      });

      voucher = await this.prisma.voucher.create({
        data: {
          voucherNumber: `VCH-${Date.now()}`,
          amount: event.data.amount,
          reason: event.data.reason,
          userId: employee?.id || 'system',
          status: 'approved',
          approvedAt: new Date(event.timestamp),
          erpId: event.processId,
        },
      });

      console.log(`✅ Voucher created from ERP: ${voucher.voucherNumber}`);
    }

    if (!voucher) {
      throw new Error('Failed to create or find voucher');
    }

    // Auto-create PhieuChi
    const phieuChi = await this.prisma.phieuChi.create({
      data: {
        voucherId: voucher.id,
        phieuChiNumber: `PC-${event.data.paymentDate}-${Date.now()}`,
        content: `${event.data.reason} - Approved by ${event.data.approverName}`,
        generatedAt: new Date(),
      },
    });

    console.log(`🎟️ PhieuChi created: ${phieuChi.phieuChiNumber}`);

    // Lock voucher
    await this.prisma.voucher.update({
      where: { id: voucher.id },
      data: {
        isLocked: true,
        lockedAt: new Date(),
      },
    });

    // Log event
    await this.prisma.botLog.create({
      data: {
        action: 'erp_payment_approved',
        status: 'success',
        voucherId: voucher.id,
        details: {
          erpEventId: event.eventId,
          erpProcessId: event.processId,
          phieuChiId: phieuChi.id,
          phieuChiNumber: phieuChi.phieuChiNumber,
          amount: event.data.amount,
          approver: event.data.approverName,
          timestamp: event.timestamp,
        },
      },
    });

    // Send Telegram notification
    const message = `✅ PHIẾU CHI TỰ ĐỘNG TỪ ERP

🎟️ Phiếu chi: ${phieuChi.phieuChiNumber}
💰 Số tiền: ${event.data.amount.toLocaleString('vi-VN')} VND
📝 Nội dung: ${event.data.reason}
👤 Người phê duyệt: ${event.data.approverName}
📅 Ngày thanh toán: ${event.data.paymentDate}

📌 Được tạo tự động từ quy trình ERP
🔒 Phiếu đã khóa (không sửa)`;

    await this.sendTelegramNotification(message);

    return {
      status: 'ok',
      message: 'Payment approved - PhieuChi created',
      data: {
        voucherId: voucher.id,
        phieuChiId: phieuChi.id,
        phieuChiNumber: phieuChi.phieuChiNumber,
      },
    };
  }

  /**
   * Handle: Payment Rejected
   * Update voucher status + notify
   */
  async handlePaymentRejected(event: ERPEvent): Promise<any> {
    console.log(`❌ Payment rejected: ${event.data.voucherId}`);

    const voucher = await this.prisma.voucher.findUnique({
      where: { id: event.data.voucherId },
    });

    if (!voucher) {
      throw new Error(`Voucher ${event.data.voucherId} not found`);
    }

    // Update status
    await this.prisma.voucher.update({
      where: { id: voucher.id },
      data: {
        status: 'rejected',
        approvalLevel: -1,
      },
    });

    // Log
    await this.prisma.botLog.create({
      data: {
        action: 'erp_payment_rejected',
        status: 'success',
        voucherId: voucher.id,
        details: {
          erpEventId: event.eventId,
          reason: event.data.reason,
          rejectedBy: event.data.approverName,
          timestamp: event.timestamp,
        },
      },
    });

    // Notify
    const message = `❌ PHIẾU CHI BỊ TỪ CHỐI

🎟️ Phiếu chi: ${voucher.voucherNumber}
💰 Số tiền: ${event.data.amount.toLocaleString('vi-VN')} VND
📝 Nội dung: ${event.data.reason}
👤 Người từ chối: ${event.data.approverName}

⏳ Vui lòng sửa và gửi lại.`;

    await this.sendTelegramNotification(message);

    return {
      status: 'ok',
      message: 'Payment rejected',
      data: { voucherId: voucher.id },
    };
  }

  /**
   * Handle: Process Completed
   * Multi-step quy trình hoàn thành
   */
  async handleProcessCompleted(event: ERPEvent): Promise<any> {
    console.log(`✅ Process completed: ${event.processId}`);

    // Log completion
    await this.prisma.botLog.create({
      data: {
        action: 'erp_process_completed',
        status: 'success',
        details: {
          erpEventId: event.eventId,
          erpProcessId: event.processId,
          data: event.data,
          timestamp: event.timestamp,
        },
      },
    });

    // Notify
    const message = `✅ QUY TRÌNH HOÀN THÀNH

📌 Mã quy trình: ${event.processId}
💰 Số tiền: ${event.data.amount.toLocaleString('vi-VN')} VND
📝 Nội dung: ${event.data.reason}

🎉 Tất cả bước đã hoàn thành!`;

    await this.sendTelegramNotification(message);

    return {
      status: 'ok',
      message: 'Process completed',
      data: { processId: event.processId },
    };
  }

  /**
   * Health check for ERP integration
   */
  async getStatus(): Promise<any> {
    const recentEvents = await this.prisma.botLog.findMany({
      where: { action: { startsWith: 'erp_' } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      status: 'ok',
      recentEvents: recentEvents.length,
      lastEvent: recentEvents[0]?.createdAt || null,
    };
  }
}
