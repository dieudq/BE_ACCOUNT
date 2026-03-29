import { Controller, Get } from '@nestjs/common';
import { LLMGatewayService } from './llm-gateway.service';

@Controller('api/llm-gateway')
export class LLMGatewayController {
  constructor(private llmGateway: LLMGatewayService) {}

  @Get('health')
  async healthCheck() {
    return this.llmGateway.healthCheck();
  }
}
