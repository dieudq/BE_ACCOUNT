import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotiService } from './services/telegram-noti.service';
import { SmartQueryService } from './services/smart-query.service';

@Module({
  providers: [PrismaService, TelegramNotiService, SmartQueryService],
  exports: [PrismaService, TelegramNotiService, SmartQueryService],
})
export class CommonModule {}
