import { Injectable, Logger } from '@nestjs/common';

export interface ERPProjectHours {
  projectId: string;
  projectKey: string;
  projectName: string;
  hours: number;
  percent: number;
}

export interface ERPMonthlyEmployee {
  employeeId: string;
  employeeCode: string | null;
  fullName: string | null;
  department: string | null;
  standardHoursRaw: number;
  excludedHolidayHours: number;
  excludedApprovedLeaveHours: number;
  effectiveStandardHours: number;
  actualLoggedHours: number;
  selfLearningHours: number;
  selfLearningPercent: number;
  actualPercent: number;
  isAtRisk: boolean;
  projects: ERPProjectHours[];
}

export interface ERPMonthlyReport {
  month: string;
  year: number;
  monthNum: number;
  deptCode: string;
  periodStart: string;
  periodEnd: string;
  employees: ERPMonthlyEmployee[];
  summary: {
    totalEmployees: number;
    atRiskCount: number;
    avgSelfLearningPercent: number;
    selfLearningThreshold: number;
  };
}

export interface ERPSelfLearningRisk {
  employeeId: string;
  employeeCode: string | null;
  fullName: string | null;
  selfLearningHours: number;
  effectiveStandardHours: number;
  selfLearningPercent: number;
  isExceeded: boolean;
  lastJiraLogDate: string | null;
}

@Injectable()
export class ERPClientService {
  private readonly logger = new Logger(ERPClientService.name);
  private accessToken: string = '';
  private tokenExpiresAt: number = 0;

  constructor() {}

  /**
   * Login to ERP and get access token (cached until expiry)
   */
  async login(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const username = process.env.ERP_USERNAME;
    const password = process.env.ERP_PASSWORD;
    const erpUrl = process.env.ERP_API_URL || 'http://localhost:9999';

    if (!username || !password) {
      throw new Error('ERP_USERNAME or ERP_PASSWORD not configured');
    }

    this.logger.log(`🔓 Logging into ERP as ${username}...`);

    const response = await fetch(`${erpUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      throw new Error(`ERP login failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    this.accessToken = data.accessToken;
    this.tokenExpiresAt = Date.now() + (data.expiresIn || 3600) * 1000 - 60_000; // 1min buffer

    this.logger.log(`✅ ERP login successful`);
    return this.accessToken;
  }

  /**
   * GET /workload-warning/admin/report/monthly
   * Returns per-employee workload metrics + per-project breakdown for the month.
   */
  async getMonthlyWorkloadReport(
    month: string,
    deptCode?: string,
  ): Promise<ERPMonthlyReport> {
    console.log(month);
    const token = await this.login();
    const erpUrl = process.env.ERP_API_URL || 'http://localhost:3100';

    const params = new URLSearchParams({ month });
    if (deptCode) params.set('deptCode', deptCode);

    this.logger.log(`📡 Fetching monthly workload report: month=${month} dept=${deptCode ?? 'default'}`);

    const response = await fetch(
      `${erpUrl}/api/workload-warning/admin/report/monthly?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ERP report failed: ${response.status} - ${text}`);
    }

    return response.json();
  }

  /**
   * GET /workload-warning/admin/report/self-learning-risks
   * Returns employees approaching / exceeding self-learning threshold.
   */
  async getSelfLearningRisks(
    month: string,
    deptCode?: string,
    threshold = 30,
  ): Promise<{ risks: ERPSelfLearningRisk[] }> {
    const token = await this.login();
    const erpUrl = process.env.ERP_API_URL || 'http://localhost:3100';

    const params = new URLSearchParams({ month, threshold: String(threshold) });
    if (deptCode) params.set('deptCode', deptCode);

    this.logger.log(`📡 Fetching self-learning risks: month=${month} threshold=${threshold}h`);

    const response = await fetch(
      `${erpUrl}/api/workload-warning/admin/report/self-learning-risks?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ERP risks failed: ${response.status} - ${text}`);
    }

    return response.json();
  }

  /**
   * Approve a voucher in ERP
   */
  async approveVoucher(voucher: any, approvalReason?: string): Promise<any> {
    const token = await this.login();
    const erpUrl = process.env.ERP_API_URL || 'http://localhost:3100';
    const voucherCode = voucher.voucherNumber || voucher.code || voucher.id;

    this.logger.log(`✅ Approving ERP voucher ${voucherCode}...`);

    const response = await fetch(
      `${erpUrl}/api/accounting/vouchers/${voucherCode}/approve`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: approvalReason || 'Approved via Telegram Bot' }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ERP approve failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Reject a voucher in ERP
   */
  async rejectVoucher(voucherId: string, rejectionReason: string): Promise<any> {
    const token = await this.login();
    const erpUrl = process.env.ERP_API_URL || 'http://localhost:3100';

    this.logger.log(`❌ Rejecting ERP voucher ${voucherId}...`);

    const response = await fetch(
      `${erpUrl}/api/accounting/vouchers/${voucherId}/reject`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: rejectionReason || 'Rejected via Telegram Bot' }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ERP reject failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Health check - verify ERP connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      const erpUrl = process.env.ERP_API_URL || 'http://localhost:9999';
      const resp = await fetch(`${erpUrl}/api/ui/health`, { signal: AbortSignal.timeout(5000) });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
