import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { LLMGatewayModule } from '../llm-gateway/llm-gateway.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [LLMGatewayModule, PrismaModule],
  providers: [ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
