import { Injectable } from '@nestjs/common';
import { ChatService } from '../chat/chat.service';
import { PolicyEngine, ActionRisk, PolicyContext } from '../policies/policy.engine';
import { IdempotencyService } from '../policies/idempotency.service';

export interface AgentRequest {
  userId: string;
  userRole: string;
  message: string;
  actionType?: string;
  riskLevel?: ActionRisk;
  confirmationToken?: string;
}

export interface AgentResponse {
  success: boolean;
  message?: string;
  action?: string;
  requiresConfirmation?: boolean;
  confirmationToken?: string;
  auditId?: string;
  result?: any;
  error?: string;
}

@Injectable()
export class AgentOrchestrator {
  constructor(
    private chat: ChatService,
    private policy: PolicyEngine,
    private idempotency: IdempotencyService,
  ) {}

  /**
   * Main orchestration entry point
   */
  async process(request: AgentRequest): Promise<AgentResponse> {
    try {
      // Step 1: Parse intent using LLM
      const intent = await this.parseIntent(request.message, request.userId);

      // Step 2: Policy validation
      const policyCtx: PolicyContext = {
        userId: request.userId,
        userRole: request.userRole,
        action: intent.action,
        riskLevel: this.getRiskLevel(intent.action),
        resourceId: intent.resourceId,
        metadata: intent.metadata,
      };

      const policyResult = await this.policy.validateAction(policyCtx);
      if (!policyResult.allowed) {
        return { success: false, error: policyResult.reason };
      }

      // Step 3: Check idempotency for write actions
      if (policyResult.requiresConfirmation) {
        const idempotencyKey = this.idempotency.generateKey(
          request.userId,
          intent.action,
          intent.resourceId,
        );

        if (await this.idempotency.isDuplicate(idempotencyKey)) {
          return { success: false, error: 'Duplicate action detected. Please try again.' };
        }

        // Generate confirmation token
        const confirmationToken = this.generateConfirmationToken();
        return {
          success: true,
          action: intent.action,
          requiresConfirmation: true,
          message: intent.summary,
          confirmationToken,
        };
      }

      // Step 4: Execute read-only action
      const result = await this.executeAction(intent, request.userId);
      return {
        success: true,
        message: `Successfully executed: ${intent.action}`,
        result,
        auditId: `audit_${Date.now()}`,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  private async parseIntent(
    message: string,
    userId: string,
  ): Promise<{ action: string; summary: string; resourceId?: string; metadata?: any }> {
    // Use LLM to understand intent
    const intent = await this.chat.processQuery(message, userId);
    return {
      action: 'query', // simplified - would parse from LLM response
      summary: intent,
    };
  }

  private getRiskLevel(action: string): ActionRisk {
    if (action.includes('create_voucher') || action.includes('approve')) {
      return ActionRisk.FINANCIAL;
    }
    if (action.includes('update') || action.includes('create')) {
      return ActionRisk.WRITE;
    }
    return ActionRisk.READ;
  }

  private async executeAction(
    intent: any,
    userId: string,
  ): Promise<any> {
    // Placeholder for action execution
    return { status: 'executed', action: intent.action };
  }

  private generateConfirmationToken(): string {
    return `confirm_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}
