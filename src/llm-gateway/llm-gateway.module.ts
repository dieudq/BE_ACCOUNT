import { Module } from '@nestjs/common';
import { LLMGatewayService } from './llm-gateway.service';
import { LLMGatewayController } from './llm-gateway.controller';

@Module({
  providers: [LLMGatewayService],
  controllers: [LLMGatewayController],
  exports: [LLMGatewayService],
})
export class LLMGatewayModule {}
