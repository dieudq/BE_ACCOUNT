import { Controller, Post, Body } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('api/chat')
export class ChatController {
  constructor(private chat: ChatService) {}

  @Post()
  async ask(
    @Body() body: { message: string; userId: string },
  ): Promise<{ answer: string }> {
    const answer = await this.chat.processQuery(body.message, body.userId);
    return { answer };
  }
}
