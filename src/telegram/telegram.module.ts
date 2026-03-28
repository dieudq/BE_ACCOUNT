import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { ChatModule } from '../chat/chat.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ChatModule, PrismaModule],
  providers: [TelegramService],
  controllers: [TelegramController],
  exports: [TelegramService],
})
export class TelegramModule {}
