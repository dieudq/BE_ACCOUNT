import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MonthlyScheduler } from './monthly.scheduler';
import { ReportsModule } from '../reports/reports.module';
import { TelegramModule } from '../telegram/telegram.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ScheduleModule.forRoot(), ReportsModule, TelegramModule, PrismaModule],
  providers: [MonthlyScheduler],
})
export class SchedulerModule {}
