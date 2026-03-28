import { Module } from '@nestjs/common';
import { VouchersService } from './vouchers.service';
import { VouchersController } from './vouchers.controller';
import { VoucherAutomationService } from './voucher-automation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { GroqModule } from '../groq/groq.module';

@Module({
  imports: [PrismaModule, GroqModule],
  providers: [VouchersService, VoucherAutomationService],
  controllers: [VouchersController],
  exports: [VoucherAutomationService],
})
export class VouchersModule {}
