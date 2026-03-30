import { Controller, Post, Body } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramGroupService } from './telegram-group.service';

@Controller('webhooks/telegram')
export class TelegramController {
  constructor(
    private telegram: TelegramService,
    private telegramGroup: TelegramGroupService,
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

      const { chat, from, text } = msg;

      // Auto-register group if it's a group chat
      if (chat.type === 'group' || chat.type === 'supergroup') {
        console.log(`👥 Group detected: ${chat.id} (${chat.title})`);
        await this.telegramGroup.registerGroup(
          chat.id.toString(),
          chat.title,
          chat.description,
        );
      }

      // Handle message
      await this.telegram.handleMessage(chat.id, text, from?.id?.toString());

      return { ok: true };
    } catch (error) {
      console.error('Error handling Telegram webhook:', error);
      return { ok: false, error: error.message };
    }
  }
}
