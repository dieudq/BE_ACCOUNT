import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class TelegramNotiService {
  private readonly logger = new Logger(TelegramNotiService.name);
  private readonly botToken = process.env.TELEGRAM_BOT_TOKEN;
  private readonly telegramApiUrl = `https://api.telegram.org/bot${this.botToken}`;

  async sendMessage(chatId: string | number, message: string): Promise<any> {
    try {
      const payload = {
        chat_id: parseInt(chatId.toString()),
        text: message,
        parse_mode: 'HTML',
      };
      this.logger.log(`📤 Sending to Telegram: ${JSON.stringify(payload)}`);
      
      const response = await axios.post(`${this.telegramApiUrl}/sendMessage`, payload);
      this.logger.log(`✅ Telegram message sent to ${chatId}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Telegram send failed: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`📋 Telegram error details: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  async sendMessageWithButtons(
    chatId: string | number,
    message: string,
    buttons: any,
  ): Promise<any> {
    try {
      const payload = {
        chat_id: parseInt(chatId.toString()),
        text: message,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: buttons,
        },
      };
      const response = await axios.post(`${this.telegramApiUrl}/sendMessage`, payload);
      this.logger.log(`✅ Telegram message with buttons sent to ${chatId}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Telegram send failed: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`📋 Telegram error details: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  async editMessage(
    chatId: string | number,
    messageId: number,
    text: string,
  ): Promise<any> {
    try {
      const payload = {
        chat_id: parseInt(chatId.toString()),
        message_id: messageId,
        text: text,
        parse_mode: 'HTML',
      };
      this.logger.log(`📤 Editing Telegram message: ${JSON.stringify(payload)}`);
      
      const response = await axios.post(
        `${this.telegramApiUrl}/editMessageText`,
        payload,
      );
      this.logger.log(`✅ Telegram message edited`);
      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Edit message failed: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`📋 Telegram error details: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text: string,
    showAlert: boolean = false,
  ): Promise<any> {
    try {
      const payload = {
        callback_query_id: callbackQueryId,
        text: text,
        show_alert: showAlert,
      };
      
      const response = await axios.post(
        `${this.telegramApiUrl}/answerCallbackQuery`,
        payload,
      );
      this.logger.log(`✅ Callback query answered`);
      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Answer callback failed: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`📋 Telegram error details: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }
}
