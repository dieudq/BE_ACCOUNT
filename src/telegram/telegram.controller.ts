import { Controller, Post, Body } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramGroupService } from './telegram-group.service';
import { GLFileProcessorService } from '../financial/gl-file-processor.service';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';

@Controller('webhooks/telegram')
export class TelegramController {
  constructor(
    private telegram: TelegramService,
    private telegramGroup: TelegramGroupService,
    private glProcessor: GLFileProcessorService,
  ) {}

  @Post()
  async handleWebhook(@Body() payload: any) {
    console.log(`📨 Telegram Webhook received`);

    try {
      const { message, edited_message } = payload;
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
        await this.telegram.handleMessage(chat.id, text, from?.id?.toString());
      }

      return { ok: true };
    } catch (error) {
      console.error('Error handling Telegram webhook:', error);
      return { ok: false, error: error.message };
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
      const cashflowPath = await this.glProcessor.processGLFileAndGenerateCashflow(filepath);

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
