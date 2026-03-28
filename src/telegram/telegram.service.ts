import { Injectable, OnModuleInit } from '@nestjs/common';
import { ChatService } from '../chat/chat.service';
import { PrismaService } from '../prisma/prisma.service';
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
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN_ACCOUNTING;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN_ACCOUNTING not set');
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
    const webhookUrl = process.env.WEBHOOK_URL;
    if (webhookUrl) {
      await this.setupWebhook(webhookUrl);
    }
  }

  async setupWebhook(webhookUrl: string) {
    try {
      const token = process.env.TELEGRAM_BOT_TOKEN_ACCOUNTING;
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

      // Get user for role check
      let user = await this.prisma.user.findUnique({
        where: { id: userIdForQuery },
      });

      if (!user) {
        // Auto-create user
        user = await this.prisma.user.create({
          data: {
            id: userIdForQuery,
            name: `User ${userIdForQuery}`,
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

      // Get AI response
      const answer = await this.chat.processQuery(message, userIdForQuery);

      // Save to database
      await this.prisma.chatLog.create({
        data: {
          userId: userIdForQuery,
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
