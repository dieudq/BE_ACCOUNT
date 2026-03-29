import { Module } from '@nestjs/common';
import { VouchersService } from './vouchers.service';
import { VouchersController } from './vouchers.controller';
import { VoucherAutomationService } from './voucher-automation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LLMGatewayModule } from '../llm-gateway/llm-gateway.module';

@Module({
  imports: [PrismaModule, LLMGatewayModule],
  providers: [VouchersService, VoucherAutomationService],
  controllers: [VouchersController],
  exports: [VoucherAutomationService],
})
export class VouchersModule {}
