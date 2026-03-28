import { Module } from '@nestjs/common';
import { PolicyEngine } from './policy.engine';
import { IdempotencyService } from './idempotency.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PolicyEngine, IdempotencyService],
  exports: [PolicyEngine, IdempotencyService],
})
export class PoliciesModule {}
