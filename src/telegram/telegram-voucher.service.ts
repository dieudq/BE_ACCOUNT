import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotiService } from '../common/services/telegram-noti.service';
import { ErpClientService } from '../erp/erp-client.service';

@Injectable()
export class TelegramVoucherService {
  private readonly logger = new Logger(TelegramVoucherService.name);

  public readonly APPROVAL_CHAIN = [
    {
      email: 'accountant@twendeesoft.com',
      telegramId: '5377791753',
      name: 'Như Quỳnh',
      order: 0,
    },
    {
      email: 'linhtt@twendeesoft.com',
      telegramId: '5740135285',
      name: 'Thùy Linh',
      order: 1,
    },
    {
      email: 'erik@twendeesoft.com',
      telegramId: '5377791753',
      name: 'Hoàng Long',
      order: 2,
    },
  ];

  constructor(
    private prisma: PrismaService,
    private telegramNotiService: TelegramNotiService,
    @Inject(forwardRef(() => ErpClientService))
    private erpClientService: ErpClientService,
  ) {}

  async startApprovalProcess(voucher: any, createdBy: any, erpData: any) {
    const first = this.APPROVAL_CHAIN[0];
    const existing = await this.prisma.approval.findFirst({
      where: { voucherId: voucher.id, approvedBy: first.email },
    });

    if (existing) {
      await this.prisma.approval.update({
        where: { id: existing.id },
        data: { status: 'pending', approvedAt: null },
      });
    } else {
      await this.prisma.approval.create({
        data: {
          voucherId: voucher.id,
          approvedBy: first.email,
          status: 'pending',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    }
    await this.sendApprovalMessage(
      first.telegramId,
      voucher,
      createdBy,
      first,
      false,
      '',
      '',
      erpData,
    );
  }

  async handleAcceptVoucher(voucherId: string, approverEmail: string) {
    const voucher = await this.prisma.voucher.findUnique({
      where: { id: voucherId },
      include: { user: true },
    });
    if (!voucher?.erpId) throw new Error('Voucher thiếu erpId');

    const currentApprover = this.APPROVAL_CHAIN.find(
      (a) => a.email === approverEmail,
    );

    // Gọi ERP
    await this.erpClientService.approveOnErp(voucher.erpId, approverEmail);

    // Cập nhật Bot DB
    await this.prisma.approval.updateMany({
      where: { voucherId, approvedBy: approverEmail, status: 'pending' },
      data: { status: 'approved', approvedAt: new Date() },
    });

    const nextApprover = this.APPROVAL_CHAIN.find(
      (a) => a.order === (currentApprover?.order || 0) + 1,
    );
    if (nextApprover) {
      const existNext = await this.prisma.approval.findFirst({
        where: { voucherId, approvedBy: nextApprover.email },
      });
      if (!existNext) {
        await this.prisma.approval.create({
          data: {
            voucherId,
            approvedBy: nextApprover.email,
            status: 'pending',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
      }
      const metadata: any = voucher.metadata;
      const erpData = metadata?.payload || {};
      await this.sendApprovalMessage(
        nextApprover.telegramId,
        voucher,
        voucher.user,
        nextApprover,
        false,
        '',
        '',
        erpData,
      );
    } else {
      await this.prisma.voucher.update({
        where: { id: voucherId },
        data: { status: 'approved' },
      });
    }
  }

  async handleRejectVoucher(
    voucherId: string,
    approverEmail: string,
    reason: string,
  ) {
    const voucher = await this.prisma.voucher.findUnique({
      where: { id: voucherId },
      include: { user: true },
    });
    if (!voucher?.erpId) throw new Error('Voucher thiếu erpId');

    const currentApprover = this.APPROVAL_CHAIN.find(
      (a) => a.email === approverEmail,
    );
    const prevApprover = this.APPROVAL_CHAIN.find(
      (a) => a.order === (currentApprover?.order || 0) - 1,
    );

    if (prevApprover) {
      await this.erpClientService.rejectOnErp(
        voucher.erpId,
        approverEmail,
        reason,
      );
      await this.prisma.approval.updateMany({
        where: { voucherId, approvedBy: prevApprover.email },
        data: { status: 'pending', approvedAt: null },
      });
      const metadata: any = voucher.metadata;
      const erpData = metadata?.payload || {};
      await this.sendApprovalMessage(
        prevApprover.telegramId,
        voucher,
        voucher.user,
        prevApprover,
        true,
        reason,
        currentApprover?.name,
        erpData,
      );
    } else {
      await this.erpClientService.cancelOnErp(
        voucher.erpId,
        approverEmail,
        reason,
      );
      await this.prisma.voucher.update({
        where: { id: voucherId },
        data: { status: 'rejected' },
      });
    }
  }

  private async sendApprovalMessage(
    telId: string,
    voucher: any,
    creator: any,
    approver: any,
    isRe = false,
    reason = '',
    from = '',
    erpData: any,
  ) {
    const items =
      erpData.details
        ?.map((item: any, i: number) => {
          const amount = parseFloat(item.amount || 0).toLocaleString('vi-VN');
          const price = parseFloat(item.unitPrice || 0).toLocaleString('vi-VN');
          return `${i + 1}. ${item.description || item.content}\n   • Số lượng: ${item.quantity || 1}\n   • Đơn giá: ${price} ${erpData.currency || 'VND'}\n   • Thành tiền: ${amount} ${erpData.currency || 'VND'}`;
        })
        .join('\n') || 'Không có chi tiết';

    const message = `
${isRe ? '🔄 <b>DUYỆT LẠI (TRẢ VỀ)</b>' : '🎫 <b>PHIẾU CHI CHUYÊN DÙNG</b>'} (Bước ${approver.order + 1}/3)

📌 <b>THÔNG TIN CƠ BẢN</b>
Mã phiếu: <code>${erpData.voucherCode || erpData.code}</code>
Loại phiếu: ${erpData.voucherType || 'PAYMENT'}
Người lập: ${creator?.fullName || creator?.name || 'ERP System'}
Email: ${creator?.email || 'N/A'}

📅 <b>NGÀY THÁNG</b>
Ngày phát hành: ${erpData.issueDate ? new Date(erpData.issueDate).toLocaleDateString('vi-VN') : 'N/A'}
Ngày ghi sổ: ${erpData.postingDate ? new Date(erpData.postingDate).toLocaleDateString('vi-VN') : 'N/A'}

💰 <b>THÔNG TIN TIỀN TỆ</b>
Nội dung chi: ${erpData.content || erpData.reason}
Tổng tiền: <b>${parseFloat(erpData.totalAmount || 0).toLocaleString('vi-VN')} ${erpData.currency || 'VND'}</b>
Loại tiền: ${erpData.currency || 'USD'}
Tỷ giá: ${erpData.exchangeRate || '1.0'}

🏦 <b>THÔNG TIN NGÂN HÀNG</b>
Người nhận/Chi trả: ${erpData.payerReceiver || 'N/A'}
Tài khoản: <code>${erpData.bankAccount || 'N/A'}</code>
Ngân hàng: ${erpData.bankCode || 'N/A'}
Tài khoản kế toán: <code>${erpData.accountId || 'N/A'}</code>

📋 <b>CHI TIẾT HẠNG MỤC</b>
${items}

📎 <b>PHỤ LỤC</b>
Ghi chú: ${erpData.note || 'Không có ghi chú'}
Số tập tin đính kèm: ${erpData.attachments?.length || 0}
${erpData.attachments?.length > 0 ? `🔗 <a href="${erpData.attachments[0]}">Xem chứng từ</a>` : ''}

━━━━━━━━━━━━━━━━━━
${isRe ? `⚠️ <b>Lý do trả về:</b> ${reason}\n👤 <b>Từ:</b> ${from}` : '✅ Vui lòng duyệt hoặc từ chối phiếu chi này'}`;

    const buttons = [
      [
        {
          text: isRe ? '🔄 Duyệt lại' : '✅ PHÊ DUYỆT',
          callback_data: `voucher_approve_${voucher.id}`,
        },
        {
          text: '❌ TRẢ VỀ/HỦY',
          callback_data: `voucher_reject_${voucher.id}`,
        },
      ],
    ];
    await this.telegramNotiService.sendMessageWithButtons(
      telId,
      message,
      buttons,
    );
  }
}
