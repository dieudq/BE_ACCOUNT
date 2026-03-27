import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  controllers: [WebhooksController],
  providers: [PrismaService],
})
export class WebhooksModule {}
