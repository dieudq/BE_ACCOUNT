import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotiService } from './services/telegram-noti.service';

@Module({
  providers: [PrismaService, TelegramNotiService],
  exports: [PrismaService, TelegramNotiService],
})
export class CommonModule {}
