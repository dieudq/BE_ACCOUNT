import { Controller, Post, Body, Logger } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramGroupService } from './telegram-group.service';
import { GLFileProcessorService } from '../financial/gl-file-processor.service';
import { VoucherApprovalService } from '../approvals/voucher-approval.service';
import { BotCommandsService } from './bot-commands.service';
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
    private glProcessor: GLFileProcessorService,
    private voucherApprovalService: VoucherApprovalService,
    private botCommands: BotCommandsService,
    private prisma: PrismaService,
  ) {}

  @Post()
  async handleWebhook(@Body() payload: any) {
    console.log(`📨 Telegram Webhook received`);

    try {
      const { message, edited_message, callback_query } = payload;
      
      // Handle button callbacks (approve/reject)
      if (callback_query) {
        return await this.handleCallbackQuery(callback_query);
      }

      const msg = message || edited_message;

      if (!msg) {
        return { ok: true };
      }

      const { chat, from, text, document } = msg;

      // Auto-register group if it's a group chat
      if (chat.type === 'group' || chat.type === 'supergroup') {
        console.log(`👥 Group detected: ${chat.id} (${chat.title})`);
        await this.telegramGroup.registerGroup(
          chat.id.toString(),
          chat.title,
          chat.description,
        );
      }

      // === Handle file uploads ===
      if (document) {
        console.log(`📁 File received: ${document.file_name}`);
        await this.handleFileUpload(chat.id, from?.id?.toString(), document);
        return { ok: true };
      }

      // Handle text message
      if (text) {
        // Check for commands first
        if (text.startsWith('/')) {
          const bot = this.telegram.getBot();
          const parts = text.split(' ');
          const command = parts[0].toLowerCase();

          try {
            switch (command) {
              case '/pending':
                const pendingMsg = await this.botCommands.getPendingVouchers(chat.id.toString());
                await bot.sendMessage(chat.id, pendingMsg, { parse_mode: 'HTML' });
                break;

              case '/approvals':
                const approvalsMsg = await this.botCommands.getApprovalsSummary(chat.id.toString());
                await bot.sendMessage(chat.id, approvalsMsg, { parse_mode: 'HTML' });
                break;

              case '/status':
                if (parts.length < 2) {
                  await bot.sendMessage(chat.id, '❌ Vui lòng cung cấp mã phiếu chi: /status AX99', { parse_mode: 'HTML' });
                } else {
                  const code = parts[1];
                  const statusMsg = await this.botCommands.getVoucherStatus(code);
                  await bot.sendMessage(chat.id, statusMsg, { parse_mode: 'HTML' });
                }
                break;

              case '/list':
                const listMsg = await this.botCommands.listAllVouchers(chat.id.toString());
                await bot.sendMessage(chat.id, listMsg, { parse_mode: 'HTML' });
                break;

              case '/help':
                const helpMsg = this.botCommands.getHelpMessage();
                await bot.sendMessage(chat.id, helpMsg, { parse_mode: 'HTML' });
                break;

              default:
                await bot.sendMessage(chat.id, `❌ Lệnh không biết: ${command}\n\nGõ /help để xem hướng dẫn`, { parse_mode: 'HTML' });
            }
          } catch (cmdError) {
            this.logger.error(`Command error: ${cmdError.message}`);
            await bot.sendMessage(chat.id, `❌ Lỗi: ${cmdError.message}`, { parse_mode: 'HTML' });
          }
          return { ok: true };
        }

        // Not a command - handle as regular message
        await this.telegram.handleMessage(chat.id, text, from?.id?.toString());
      }

      return { ok: true };
    } catch (error) {
      console.error('Error handling Telegram webhook:', error);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Handle button callback (approve/reject)
   */
  private async handleCallbackQuery(callbackQuery: any) {
    const { id: callbackId, from, data: callbackData, message } = callbackQuery;
    const chatId = message?.chat?.id;

    this.logger.log(`🔘 Callback received: ${callbackData} from ${from?.id}`);

    try {
      const bot = this.telegram.getBot();

      // Parse callback data: voucher_approve_ID or voucher_reject_ID
      if (callbackData.startsWith('voucher_approve_')) {
        const voucherId = callbackData.replace('voucher_approve_', '');
        
        // Get pending approval for this voucher by current approver
        // Query for the first pending approval (earliest in chain)
        const pendingApproval = await this.prisma.approval.findFirst({
          where: { 
            voucherId,
            status: 'pending'
          },
          orderBy: { createdAt: 'asc' }
        });

        if (!pendingApproval || !pendingApproval.approvedBy) {
          await bot.answerCallbackQuery(callbackId, {
            text: '⚠️ Phiếu chi đã được duyệt hoặc không có để duyệt',
            show_alert: true,
          });
          return { ok: true };
        }

        const approverEmail = pendingApproval.approvedBy;
        
        this.logger.log(`✅ Approving voucher ${voucherId} by ${approverEmail}`);
        
        const result = await this.voucherApprovalService.approve(voucherId, approverEmail);
        
        if (result) {
          await bot.answerCallbackQuery(callbackId, {
            text: '✅ Phiếu chi đã được duyệt!',
            show_alert: false,
          });
          
          // Edit message to show approval status
          await bot.editMessageText(
            `✅ Bạn đã duyệt phiếu chi này.\n\n⏳ Chờ duyệt từ người tiếp theo...`,
            { chat_id: chatId, message_id: message.message_id }
          );
        } else {
          await bot.answerCallbackQuery(callbackId, {
            text: '❌ Lỗi duyệt phiếu chi!',
            show_alert: true,
          });
        }
        
      } else if (callbackData.startsWith('voucher_reject_')) {
        const voucherId = callbackData.replace('voucher_reject_', '');
        
        // Get pending approval
        const pendingApproval = await this.prisma.approval.findFirst({
          where: { 
            voucherId,
            status: 'pending'
          },
          orderBy: { createdAt: 'asc' }
        });

        if (!pendingApproval || !pendingApproval.approvedBy) {
          await bot.answerCallbackQuery(callbackId, {
            text: '⚠️ Phiếu chi không có để từ chối',
            show_alert: true,
          });
          return { ok: true };
        }

        const approverEmail = pendingApproval.approvedBy;
        
        this.logger.log(`❌ Rejecting voucher ${voucherId} by ${approverEmail}`);
        
        const result = await this.voucherApprovalService.reject(
          voucherId,
          approverEmail,
          'Rejected via Telegram button'
        );
        
        if (result) {
          await bot.answerCallbackQuery(callbackId, {
            text: '❌ Phiếu chi đã bị từ chối!',
            show_alert: false,
          });
          
          // Edit message to show rejection status
          await bot.editMessageText(
            `❌ Bạn đã từ chối phiếu chi này.\n\nNgười lập sẽ được thông báo để sửa chữa.`,
            { chat_id: chatId, message_id: message.message_id }
          );
        } else {
          await bot.answerCallbackQuery(callbackId, {
            text: '❌ Lỗi từ chối phiếu chi!',
            show_alert: true,
          });
        }
      }

      return { ok: true };
    } catch (error) {
      this.logger.error(`Error handling callback: ${error.message}`);
      const bot = this.telegram.getBot();
      await bot.answerCallbackQuery(callbackId, {
        text: `❌ Lỗi: ${error.message}`,
        show_alert: true,
      });
      return { ok: false };
    }
  }

  /**
   * Handle file upload from Telegram
   * Download file → Process → Send result back
   */
  private async handleFileUpload(
    chatId: number,
    userId: string | undefined,
    document: any,
  ) {
    try {
      const bot = this.telegram.getBot();

      // Send processing message
      await bot.sendMessage(chatId, '⏳ Processing file...');

      // Get file info
      const fileInfo = await bot.getFile(document.file_id);
      if (!fileInfo || !fileInfo.file_path) {
        throw new Error('Could not get file path from Telegram');
      }

      // Download file
      console.log(`📥 Downloading: ${fileInfo.file_path}`);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
      const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });

      // Save to uploads folder
      const uploadDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filename = `gl_${Date.now()}_${document.file_name}`;
      const filepath = path.join(uploadDir, filename);
      fs.writeFileSync(filepath, response.data);

      console.log(`✅ File saved: ${filepath}`);

      // Process GL file → Generate Cashflow Excel
      console.log(`🧮 Processing GL file...`);
      const coaPath = path.join(process.cwd(), 'templates/Danh_sach_he_thong_tai_khoan.xlsx');
      const cashflowPath = await this.glProcessor.processGLFileAndGenerateCashflow(
        filepath,
        coaPath,
      );

      console.log(`✅ Cashflow generated: ${cashflowPath}`);

      // Send cashflow file back to user
      const fileStream = fs.createReadStream(cashflowPath);
      await bot.sendDocument(chatId, fileStream, {
        caption: '📊 Cashflow Report Generated',
        parse_mode: 'HTML',
      });

      console.log(`✅ File sent back to Telegram chat: ${chatId}`);
    } catch (err) {
      const bot = this.telegram.getBot();
      console.error('File processing error:', err);
      await bot.sendMessage(
        chatId,
        `❌ Error processing file: ${(err as Error).message}`,
      );
    }
  }
}
