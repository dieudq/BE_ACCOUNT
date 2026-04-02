import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VoucherAutomationService } from '../vouchers/voucher-automation.service';
import { ApprovalWorkflowService } from '../approvals/approval-workflow.service';
import { BotCommandService } from './bot-command.service';
import { AgentOrchestrator } from '../agent/agent.orchestrator';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot;
  private allowedUsers: string[];
  private allowedRoles: string[];

  constructor(
    private prisma: PrismaService,
    private voucherAutomation: VoucherAutomationService,
    private approvalWorkflow: ApprovalWorkflowService,
    private commandService: BotCommandService,
    private agent: AgentOrchestrator,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN not set');
    }
    this.bot = new TelegramBot(token);
    this.allowedUsers = (process.env.ALLOWED_TELEGRAM_USERS || '').split(',').filter(Boolean);
    this.allowedRoles = (process.env.ALLOWED_ROLES || '').split(',').filter(Boolean);
  }

  getBot(): TelegramBot {
    return this.bot;
  }

  async onModuleInit() {
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    if (webhookUrl) {
      await this.setupWebhook(webhookUrl);
    }
  }

  async setupWebhook(webhookUrl: string) {
    try {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const url = `https://api.telegram.org/bot${token}/setWebhook`;
      const response = await axios.post(url, {
        url: `${webhookUrl}/webhooks/telegram`,
      });
      this.logger.log(`Telegram webhook setup: ${JSON.stringify(response.data)}`);
    } catch (error: any) {
      this.logger.error(`Failed to setup webhook: ${error.message}`);
    }
  }

  private isUserAllowed(userId: string): boolean {
    if (this.allowedUsers.length === 0) return true;
    return this.allowedUsers.includes(userId);
  }

  async handleMessage(chatId: number, message: string, userId?: string) {
    try {
      const userIdForQuery = userId || `telegram-${chatId}`;

      if (!this.isUserAllowed(userIdForQuery)) {
        await this.bot.sendMessage(chatId, 'Bạn không có quyền sử dụng bot này.');
        return;
      }

      // Lấy hoặc tạo user
      let user = await this.prisma.user.findFirst({
        where: { telegramId: userIdForQuery },
      });
      if (!user) {
        user = await this.prisma.user.create({
          data: {
            name: `User ${userIdForQuery}`,
            email: `${userIdForQuery}@bot.local`,
            telegramId: userIdForQuery,
            role: 'employee',
          },
        });
      }

      if (this.allowedRoles.length > 0 && !this.allowedRoles.includes(user.role)) {
        await this.bot.sendMessage(chatId, `Role "${user.role}" không có quyền sử dụng bot.`);
        return;
      }

      const cmd = message.trim().toLowerCase().split(' ')[0];
      const args = message.trim().split(' ').slice(1);

      // /start và /help giữ nguyên là direct command vì không cần context
      if (cmd === '/start') {
        await this.commandService.handleStart(this.bot, chatId);
        return;
      }
      if (cmd === '/help') {
        await this.commandService.handleHelp(this.bot, chatId);
        return;
      }

      // /broadcast yêu cầu admin
      if (cmd === '/broadcast') {
        if (user.role !== 'admin') {
          await this.bot.sendMessage(chatId, 'Lệnh này yêu cầu quyền Admin.');
          return;
        }
        await this.commandService.handleBroadcast(this.bot, chatId, args);
        return;
      }

      // Xác nhận phiếu chi (APPROVE / REJECT / YES / NO / REVIEW)
      const upperMsg = message.trim().toUpperCase();
      if (upperMsg.startsWith('APPROVE ') || upperMsg.startsWith('REJECT ') ||
          upperMsg === 'YES' || upperMsg.startsWith('YES ') ||
          upperMsg === 'NO' || upperMsg.startsWith('REVIEW ') ||
          upperMsg === 'LIST' || upperMsg === '/LIST') {
        await this.handleVoucherConfirmation(chatId, message, userIdForQuery, user);
        return;
      }

      // === TẤT CẢ các message còn lại (bao gồm text tự nhiên VÀ /commands khác)
      //     đều đi qua AgentOrchestrator — agentic reasoning ===
      await this.bot.sendChatAction(chatId, 'typing');

      // Nếu là lệnh slash cũ, chuyển thành text tự nhiên để agent hiểu
      const agentInput = this.normalizeToNaturalLanguage(message);

      const response = await this.agent.processMessage(
        userIdForQuery,
        user.role,
        agentInput,
      );

      // Lưu vào DB
      await this.prisma.chatLog.create({
        data: {
          userId: user.id,
          message,
          response,
          source: 'telegram',
          metadata: { chatId, telegramUserId: userId },
        },
      });

      await this.sendResponseWithFile(chatId, response);
    } catch (error: any) {
      this.logger.error(`handleMessage error: ${error.message}`, error.stack);
      await this.bot.sendMessage(chatId, `Đã có lỗi xảy ra: ${error.message}`);
    }
  }

  /**
   * Chuyển slash commands cũ thành text tự nhiên để agent xử lý thống nhất
   * Người dùng vẫn có thể gõ /report nhưng agent sẽ hiểu ngữ nghĩa
   */
  private normalizeToNaturalLanguage(message: string): string {
    const trimmed = message.trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const rest = parts.slice(1).join(' ');

    const commandMap: Record<string, string> = {
      '/report': `báo cáo workload ${rest}`.trim(),
      '/workload': `báo cáo workload ${rest}`.trim(),
      '/warnings': `cảnh báo workload ${rest}`.trim(),
      '/analyze': `phân tích ${rest}`.trim(),
      '/insights': `nhận xét team ${rest}`.trim(),
      '/export': `xuất Excel báo cáo ${rest}`.trim(),
      '/cashflow': `tạo báo cáo cashflow tự động ${rest}`.trim(),
      '/approvals': 'danh sách phiếu chờ duyệt',
      '/vouchers': 'danh sách phiếu chi',
      '/balance': `số dư tài khoản ${rest}`.trim(),
      '/status': 'kiểm tra trạng thái hệ thống',
    };

    return commandMap[cmd] || trimmed;
  }

  /**
   * Xử lý xác nhận phiếu chi (APPROVE/REJECT/YES/NO/REVIEW/LIST)
   * Giữ riêng vì đây là flow xác nhận explicit, không cần agent reasoning
   */
  private async handleVoucherConfirmation(
    chatId: number,
    message: string,
    userIdForQuery: string,
    user: any,
  ) {
    const upperMsg = message.trim().toUpperCase();

    if (upperMsg.startsWith('YES ')) {
      const confirmationId = message.substring(4).trim();
      const result = await this.voucherAutomation.confirmVoucher(userIdForQuery, confirmationId);
      await this.bot.sendMessage(chatId, result.message);
      return;
    }

    if (upperMsg === 'NO') {
      const pending = this.voucherAutomation.getPendingConfirmations(userIdForQuery);
      if (pending.length > 0) {
        const msg = await this.voucherAutomation.rejectVoucher(pending[0].requestId);
        await this.bot.sendMessage(chatId, msg);
      } else {
        await this.bot.sendMessage(chatId, 'Không có xác nhận nào để hủy.');
      }
      return;
    }

    if (upperMsg.startsWith('APPROVE ')) {
      const requestId = message.substring(8).trim();
      const result = await this.approvalWorkflow.approveVoucher(userIdForQuery, requestId);
      await this.bot.sendMessage(chatId, result.message);
      return;
    }

    if (upperMsg.startsWith('REJECT ')) {
      const parts = message.substring(7).trim().split(' ');
      const requestId = parts[0];
      const reason = parts.slice(1).join(' ') || 'Không có lý do';
      const result = await this.approvalWorkflow.rejectVoucher(userIdForQuery, requestId, reason);
      await this.bot.sendMessage(chatId, result.message);
      return;
    }

    if (upperMsg === 'LIST' || upperMsg === '/LIST') {
      const pending = await this.approvalWorkflow.getPendingVouchers(user.id);
      if (!pending.success || pending.vouchers.length === 0) {
        await this.bot.sendMessage(chatId, 'Không có voucher nào chờ duyệt.');
        return;
      }
      let response = `${pending.count} Voucher chờ duyệt:\n\n`;
      (pending.vouchers as any[]).forEach((v: any, i: number) => {
        response += `${i + 1}. ${v.number}\n   ${v.amount?.toLocaleString('vi-VN')} VND\n   ${v.reason}\n   ${v.requestedBy}\n\n`;
      });
      await this.bot.sendMessage(chatId, response);
      return;
    }

    if (upperMsg.startsWith('REVIEW ')) {
      const voucherId = message.substring(7).trim();
      const result = await this.approvalWorkflow.requestVoucherForReview(userIdForQuery, voucherId);
      await this.bot.sendMessage(chatId, result.message);
      return;
    }

    // Fallback: thử parse voucher intent
    const voucherResult = await this.voucherAutomation.parseVoucherIntent(userIdForQuery, message);
    if (voucherResult.requiresConfirmation) {
      await this.bot.sendMessage(chatId, voucherResult.message);
    }
  }

  /**
   * Gửi response, tự động detect và gửi file nếu response chứa marker 📎FILE:path
   */
  private async sendResponseWithFile(chatId: number, response: string) {
    const fileMarker = response.match(/📎FILE:([^\n]+)/);
    if (fileMarker) {
      const filePath = fileMarker[1].trim();
      const textPart = response.replace(/📎FILE:[^\n]+\n?/, '').trim();
      if (textPart) {
        await this.sendSafe(chatId, textPart);
      }
      if (fs.existsSync(filePath)) {
        const filename = path.basename(filePath);
        await this.bot.sendDocument(chatId, filePath, { caption: filename });
      } else {
        await this.sendSafe(chatId, `⚠️ File không tìm thấy: ${filePath}`);
      }
    } else {
      await this.sendSafe(chatId, response);
    }
  }

  /**
   * Gửi message an toàn — thử plain text, fallback HTML nếu cần
   */
  private async sendSafe(chatId: number, text: string) {
    const MAX_LEN = 4096;
    const chunks = this.splitMessage(text, MAX_LEN);

    for (const chunk of chunks) {
      try {
        await this.bot.sendMessage(chatId, chunk);
      } catch {
        // HTML fallback
        try {
          await this.bot.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
        } catch {
          // Plain truncated fallback
          await this.bot.sendMessage(chatId, chunk.substring(0, MAX_LEN));
        }
      }
    }
  }

  /**
   * Chia message dài thành nhiều chunk ≤ maxLen ký tự
   */
  private splitMessage(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      let cutAt = maxLen;
      // Cắt tại dòng mới nếu có thể
      const lastNewline = remaining.lastIndexOf('\n', maxLen);
      if (lastNewline > maxLen * 0.5) cutAt = lastNewline + 1;
      chunks.push(remaining.substring(0, cutAt));
      remaining = remaining.substring(cutAt);
    }
    return chunks;
  }

  async sendAlert(chatId: number, message: string) {
    try {
      await this.bot.sendMessage(chatId, message);
    } catch (error: any) {
      this.logger.error(`Failed to send alert to ${chatId}: ${error.message}`);
    }
  }

  async sendAlertToUser(userId: string, message: string) {
    this.logger.log(`Alert to user ${userId}: ${message}`);
  }
}
