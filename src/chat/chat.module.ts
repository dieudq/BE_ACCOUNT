import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { GroqModule } from '../groq/groq.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [GroqModule, PrismaModule],
  providers: [ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
