import { Injectable, OnModuleInit } from '@nestjs/common';
import { ChatService } from '../chat/chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { VoucherAutomationService } from '../vouchers/voucher-automation.service';
import { ApprovalWorkflowService } from '../approvals/approval-workflow.service';
import { BotCommandService } from './bot-command.service';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';

@Injectable()
export class TelegramService implements OnModuleInit {
  private bot: TelegramBot;
  private allowedUsers: string[];
  private allowedRoles: string[];

  constructor(
    private chat: ChatService,
    private prisma: PrismaService,
    private voucherAutomation: VoucherAutomationService,
    private approvalWorkflow: ApprovalWorkflowService,
    private commandService: BotCommandService,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN not set');
    }
    this.bot = new TelegramBot(token);
    
    // Parse allowed users & roles
    this.allowedUsers = (process.env.ALLOWED_TELEGRAM_USERS || '').split(',').filter(Boolean);
    this.allowedRoles = (process.env.ALLOWED_ROLES || '').split(',').filter(Boolean);
  }

  getBot(): TelegramBot {
    return this.bot;
  }

  async onModuleInit() {
    // Try to setup webhook on startup
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

      console.log('✅ Telegram webhook setup:', response.data);
    } catch (error) {
      console.error('❌ Failed to setup webhook:', error.message);
    }
  }

  private isUserAllowed(userId: string): boolean {
    // Allow if allowedUsers is empty (allow all) or user is in list
    if (this.allowedUsers.length === 0) return true;
    return this.allowedUsers.includes(userId);
  }

  async handleMessage(chatId: number, message: string, userId?: string) {
    try {
      const userIdForQuery = userId || `telegram-${chatId}`;
      
      // Check authorization
      if (!this.isUserAllowed(userIdForQuery)) {
        await this.bot.sendMessage(chatId, '❌ You are not authorized to use this bot.');
        return;
      }

      // Get or create user
      let user = await this.prisma.user.findFirst({
        where: { telegramId: userIdForQuery },
      });

      if (!user) {
        // Auto-create user
        user = await this.prisma.user.create({
          data: {
            name: `User ${userIdForQuery}`,
            email: `${userIdForQuery}@bot.local`,
            telegramId: userIdForQuery,
            role: 'employee',
          },
        });
      }

      // Check role authorization
      if (this.allowedRoles.length > 0 && !this.allowedRoles.includes(user.role)) {
        await this.bot.sendMessage(chatId, `❌ Your role (${user.role}) is not authorized.`);
        return;
      }

      // === HANDLE BOT COMMANDS (8 standard commands) ===
      const cmd = message.trim().toLowerCase().split(' ')[0];
      const args = message.trim().split(' ').slice(1);

      if (cmd === '/start') {
        await this.commandService.handleStart(this.bot, chatId);
        return;
      }

      if (cmd === '/help') {
        await this.commandService.handleHelp(this.bot, chatId);
        return;
      }

      if (cmd === '/report') {
        await this.commandService.handleReport(this.bot, chatId, args);
        return;
      }

      if (cmd === '/approvals') {
        await this.commandService.handleApprovals(this.bot, chatId);
        return;
      }

      if (cmd === '/vouchers') {
        await this.commandService.handleVouchers(this.bot, chatId);
        return;
      }

      if (cmd === '/balance') {
        await this.commandService.handleBalance(this.bot, chatId, args);
        return;
      }

      if (cmd === '/export') {
        await this.commandService.handleExport(this.bot, chatId, args);
        return;
      }

      if (cmd === '/status') {
        await this.commandService.handleStatus(this.bot, chatId);
        return;
      }

      if (cmd === '/warnings') {
        await this.commandService.handleWarnings(this.bot, chatId);
        return;
      }

      if (cmd === '/workload') {
        await this.commandService.handleWorkload(this.bot, chatId, args);
        return;
      }

      if (cmd === '/analyze') {
        await this.commandService.handleAnalyze(this.bot, chatId, args);
        return;
      }

      if (cmd === '/insights') {
        await this.commandService.handleInsights(this.bot, chatId, args);
        return;
      }

      // === LEGACY COMMANDS (Phase 3-4 compatibility) ===
      if (message.startsWith('APPROVE ')) {
        const requestId = message.substring(8).trim();
        const result = await this.approvalWorkflow.approveVoucher(userIdForQuery, requestId);
        await this.bot.sendMessage(chatId, result.message);
        return;
      }

      if (message.startsWith('REJECT ')) {
        const parts = message.substring(7).trim().split(' ');
        const requestId = parts[0];
        const reason = parts.slice(1).join(' ') || 'No reason provided';
        const result = await this.approvalWorkflow.rejectVoucher(
          userIdForQuery,
          requestId,
          reason,
        );
        await this.bot.sendMessage(chatId, result.message);
        return;
      }

      // PHASE 4: Voucher list command
      if (message.toUpperCase() === 'LIST' || message.toUpperCase() === '/LIST') {
        const pending = await this.approvalWorkflow.getPendingVouchers(user.id);
        if (!pending.success || pending.vouchers.length === 0) {
          await this.bot.sendMessage(chatId, '✅ Không có voucher nào chờ duyệt');
          return;
        }

        let response = `📋 **${pending.count} Voucher chờ duyệt:**\n\n`;
        (pending.vouchers as any[]).forEach((v: any, i: number) => {
          response += `${i + 1}. ${v.number}\n   💰 ${v.amount.toLocaleString('vi-VN')} VND\n   📝 ${v.reason}\n   👤 ${v.requestedBy}\n\n`;
        });
        response += `Gửi: REVIEW <voucherId> để xem chi tiết\n`;

        await this.bot.sendMessage(chatId, response);
        return;
      }

      // PHASE 4: Review voucher command
      if (message.startsWith('REVIEW ')) {
        const voucherId = message.substring(7).trim();
        const result = await this.approvalWorkflow.requestVoucherForReview(userIdForQuery, voucherId);
        if (result.success) {
          await this.bot.sendMessage(chatId, result.message);
        } else {
          await this.bot.sendMessage(chatId, result.message);
        }
        return;
      }

      // PHASE 3: Check if message is voucher confirmation
      if (message.startsWith('YES ')) {
        const confirmationId = message.substring(4).trim();
        const result = await this.voucherAutomation.confirmVoucher(userIdForQuery, confirmationId);
        await this.bot.sendMessage(chatId, result.message);
        return;
      }

      if (message.toUpperCase() === 'NO') {
        const pending = this.voucherAutomation.getPendingConfirmations(userIdForQuery);
        if (pending.length > 0) {
          const confirmationId = pending[0].requestId;
          const msg = await this.voucherAutomation.rejectVoucher(confirmationId);
          await this.bot.sendMessage(chatId, msg);
        } else {
          await this.bot.sendMessage(chatId, '❌ Không có xác nhận nào để hủy.');
        }
        return;
      }

      // PHASE 3: Parse voucher intent
      const voucherResult = await this.voucherAutomation.parseVoucherIntent(userIdForQuery, message);
      
      if (voucherResult.requiresConfirmation) {
        await this.bot.sendMessage(chatId, voucherResult.message);
        return;
      }

      // Fallback: Get AI response
      const answer = await this.chat.processQuery(message, user.id);

      // Save to database
      await this.prisma.chatLog.create({
        data: {
          userId: user.id,
          message,
          response: answer,
          source: 'telegram',
          metadata: {
            chatId,
            telegramUserId: userId,
          },
        },
      });

      // Send back to Telegram
      await this.bot.sendMessage(chatId, answer);
    } catch (error) {
      await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
  }

  async sendAlert(chatId: number, message: string) {
    try {
      await this.bot.sendMessage(chatId, message);
    } catch (error) {
      console.error(`Failed to send alert to ${chatId}:`, error);
    }
  }

  async sendAlertToUser(userId: string, message: string) {
    // Will be implemented when we have telegramId in User model
    console.log(`Alert to user ${userId}: ${message}`);
  }
}
