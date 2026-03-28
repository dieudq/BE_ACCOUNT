import { Controller, Post, Body } from '@nestjs/common';
import { TelegramService } from './telegram.service';

@Controller('webhooks/telegram')
export class TelegramController {
  constructor(private telegram: TelegramService) {}

  @Post()
  async handleWebhook(@Body() body: any) {
    if (body.message) {
      const { chat, text, from } = body.message;
      await this.telegram.handleMessage(chat.id, text, from.id.toString());
    }
    return { ok: true };
  }
}
