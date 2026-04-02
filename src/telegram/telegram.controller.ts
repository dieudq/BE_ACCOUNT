import { Controller, Post, Body, Logger } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramGroupService } from './telegram-group.service';
import { CashflowAgentService } from '../financial/cashflow-agent.service';
import { BotCommandsService } from './bot-commands.service';
import { TelegramVoucherService } from './telegram-voucher.service';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';

@Controller('webhooks/telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private telegram: TelegramService,
    private telegramGroup: TelegramGroupService,
    private cashflowAgent: CashflowAgentService,
    private telegramVoucherService: TelegramVoucherService,
    private botCommands: BotCommandsService,
    private prisma: PrismaService,
  ) {}

  @Post()
  async handleWebhook(@Body() payload: any) {
    try {
      const { message, edited_message, callback_query } = payload;

      if (callback_query) {
        return await this.handleCallbackQuery(callback_query);
      }

      const msg = message || edited_message;
      if (!msg) return { ok: true };

      const { chat, from, text, document } = msg;

      if (chat.type === 'group' || chat.type === 'supergroup') {
        await this.telegramGroup.registerGroup(
          chat.id.toString(),
          chat.title,
          chat.description,
        );
      }

      if (document) {
        await this.handleFileUpload(chat.id, from?.id?.toString(), document);
        return { ok: true };
      }

      if (text && text.startsWith('/')) {
        const bot = this.telegram.getBot();
        const parts = text.split(' ');
        const command = parts[0].toLowerCase();

        try {
          switch (command) {
            case '/pending':
              const pendingMsg = await this.botCommands.getPendingVouchers(
                chat.id.toString(),
              );
              await bot.sendMessage(chat.id, pendingMsg, {
                parse_mode: 'HTML',
              });
              break;
            case '/status':
              const statusMsg = await this.botCommands.getVoucherStatus(
                parts[1] || '',
              );
              await bot.sendMessage(chat.id, statusMsg, { parse_mode: 'HTML' });
              break;
            default:
              await this.telegram.handleMessage(
                chat.id,
                text,
                from?.id?.toString(),
              );
          }
        } catch (cmdError) {
          await bot.sendMessage(chat.id, `❌ Lỗi: ${cmdError.message}`, {
            parse_mode: 'HTML',
          });
        }
        return { ok: true };
      }

      if (text) {
        await this.telegram.handleMessage(chat.id, text, from?.id?.toString());
      }

      return { ok: true };
    } catch (error) {
      this.logger.error(`Webhook Error: ${error.message}`);
      return { ok: false };
    }
  }

  private async handleCallbackQuery(callbackQuery: any) {
    const { id: callbackId, from, data: callbackData, message } = callbackQuery;
    const chatId = message?.chat?.id;
    const bot = this.telegram.getBot();

    const approver = (this.telegramVoucherService as any).APPROVAL_CHAIN.find(
      (a: any) => a.telegramId === from.id.toString(),
    );

    if (!approver) {
      return await bot.answerCallbackQuery(callbackId, {
        text: '❌ Bạn không có quyền thực hiện thao tác này.',
        show_alert: true,
      });
    }

    try {
      if (callbackData.startsWith('voucher_approve_')) {
        const voucherId = callbackData.replace('voucher_approve_', '');

        await this.telegramVoucherService.handleAcceptVoucher(
          voucherId,
          approver.email,
        );

        await bot.answerCallbackQuery(callbackId, { text: '✅ ERP Approved!' });

        await bot.editMessageText(
          `✅ <b>${approver.name}</b> đã phê duyệt thành công.\n🚀 Dữ liệu đã đồng bộ lên ERP.`,
          {
            chat_id: chatId,
            message_id: message.message_id,
            parse_mode: 'HTML',
          },
        );
      } else if (callbackData.startsWith('voucher_reject_')) {
        const voucherId = callbackData.replace('voucher_reject_', '');

        await this.telegramVoucherService.handleRejectVoucher(
          voucherId,
          approver.email,
          'Rejected via Telegram',
        );

        await bot.answerCallbackQuery(callbackId, {
          text: '🚫 ERP Rejected/Cancelled!',
        });

        await bot.editMessageText(
          `🚫 <b>${approver.name}</b> đã từ chối phiếu chi này.`,
          {
            chat_id: chatId,
            message_id: message.message_id,
            parse_mode: 'HTML',
          },
        );
      }

      return { ok: true };
    } catch (error) {
      this.logger.error(`Callback Error: ${error.message}`);
      return await bot.answerCallbackQuery(callbackId, {
        text: `❌ Lỗi ERP: ${error.message}`,
        show_alert: true,
      });
    }
  }

  private async handleFileUpload(
    chatId: number,
    userId: string | undefined,
    document: any,
  ) {
    try {
      const bot = this.telegram.getBot();
      await bot.sendMessage(chatId, '⏳ Processing file...');
      const fileInfo = await bot.getFile(document.file_id);
      if (!fileInfo || !fileInfo.file_path) throw new Error('File path error');

      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
      const response = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
      });

      const uploadDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadDir))
        fs.mkdirSync(uploadDir, { recursive: true });

      const filename = `gl_${Date.now()}_${document.file_name}`;
      const filepath = path.join(uploadDir, filename);
      fs.writeFileSync(filepath, response.data);

      const generated = await this.cashflowAgent.generateAutoReport(filepath);
      const fileStream = fs.createReadStream(generated.outputFilePath);
      await bot.sendDocument(chatId, fileStream, {
        caption: `📊 Cashflow Report Generated (${generated.period})`,
        parse_mode: 'HTML',
      });

      await bot.sendMessage(
        chatId,
        `✅ Đã tạo báo cáo tự động thành công.\n` +
          `• Kỳ: ${generated.period}\n` +
          `• Nguồn: ${path.basename(generated.sourceFilePath)}\n\n` +
          `Bạn có thể hỏi tiếp:\n` +
          `"Tổng thu/chi cashflow kỳ ${generated.period} là bao nhiêu?"`,
      );
    } catch (err) {
      const bot = this.telegram.getBot();
      await bot.sendMessage(chatId, `❌ Error processing file: ${err.message}`);
    }
  }
}
