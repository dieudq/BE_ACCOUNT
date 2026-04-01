import { Injectable } from '@nestjs/common';
import { LLMGatewayService } from '../llm-gateway/llm-gateway.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmartQueryService } from '../common/services/smart-query.service';

@Injectable()
export class ChatService {
  constructor(
    private llmGateway: LLMGatewayService,
    private prisma: PrismaService,
    private smartQuery: SmartQueryService,
  ) {}

  /**
   * Process user message - use SmartQueryService for accounting questions
   */
  async processQuery(message: string, userId: string): Promise<string> {
    try {
      // Use SmartQueryService to answer (handles all accounting queries)
      return await this.smartQuery.answerQuestion(message);
    } catch (error) {
      console.error('Chat error:', error);
      return `❌ Lỗi: ${(error as Error).message}. Vui lòng thử lại sau.`;
    }
  }
}

