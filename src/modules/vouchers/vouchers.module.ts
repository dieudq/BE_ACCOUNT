import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';

@Module({
  controllers: [VouchersController],
  providers: [VouchersService, PrismaService],
  exports: [VouchersService],
})
export class VouchersModule {}
