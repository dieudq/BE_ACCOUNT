import { Injectable } from '@nestjs/common';

export enum ActionRisk {
  READ = 'READ',
  WRITE = 'WRITE',
  FINANCIAL = 'FINANCIAL',
}

export interface PolicyContext {
  userId: string;
  userRole: string;
  action: string;
  riskLevel: ActionRisk;
  resourceId?: string;
  metadata?: any;
}

@Injectable()
export class PolicyEngine {
  /**
   * Validate action against business rules
   * Returns { allowed: boolean, requiresConfirmation?: boolean, reason?: string }
   */
  async validateAction(context: PolicyContext): Promise<{ allowed: boolean; requiresConfirmation?: boolean; reason?: string }> {
    // Rule 1: Permission check
    if (!this.hasPermission(context.userRole, context.action)) {
      return { allowed: false, reason: `User role ${context.userRole} cannot perform ${context.action}` };
    }

    // Rule 2: Risk level check
    if (context.riskLevel === ActionRisk.FINANCIAL && context.userRole !== 'accountant') {
      return { allowed: false, reason: 'Financial actions require accountant role' };
    }

    // Rule 3: Write actions require confirmation
    if (context.riskLevel === ActionRisk.WRITE || context.riskLevel === ActionRisk.FINANCIAL) {
      return { allowed: true, requiresConfirmation: true };
    }

    return { allowed: true };
  }

  private hasPermission(role: string, action: string): boolean {
    const permissions = {
      employee: ['read', 'query_participation', 'query_voucher'],
      manager: ['read', 'query_participation', 'query_voucher', 'create_voucher_draft'],
      accountant: ['read', 'create_voucher', 'approve_voucher', 'create_report'],
      admin: ['*'],
    };

    const rolePerms = permissions[role] || [];
    return rolePerms.includes('*') || rolePerms.includes(action);
  }
}
