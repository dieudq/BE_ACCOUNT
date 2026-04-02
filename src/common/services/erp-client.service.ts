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
   * GET /api/accounting/vouchers
   * Lấy danh sách phiếu thu/chi từ ERP
   * @param voucherType - "RECEIPT" (phiếu thu) | "PAYMENT" (phiếu chi) | undefined (tất cả)
   * @param month - "2026-03" → tự động convert sang issueDateFrom/To
   * @param status - "DRAFT" | "PROCESSING" | "APPROVED" | "REJECTED" | "CANCELLED"
   */
  async getVouchers(params: {
    month?: string;
    voucherType?: 'RECEIPT' | 'PAYMENT';
    status?: string;
    limit?: number;
    filterWaitingApproval?: boolean;
  } = {}): Promise<any[]> {
    const token = await this.login();
    const erpUrl = process.env.ERP_API_URL || 'http://localhost:9999';

    const query = new URLSearchParams();

    // Convert "2026-03" → issueDateFrom="2026-03-01" & issueDateTo="2026-03-31"
    if (params.month) {
      const [y, m] = params.month.split('-').map(Number);
      const from = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const to = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
      query.set('issueDateFrom', from);
      query.set('issueDateTo', to);
    }

    if (params.voucherType) query.set('voucherType', params.voucherType);
    if (params.status) query.set('status', params.status);
    if (params.limit) query.set('limit', String(params.limit));
    else query.set('limit', '50');
    if (params.filterWaitingApproval) query.set('filterWaitingApproval', 'true');
    this.logger.log(`📡 ERP getVouchers: ${query.toString()}`);

    const response = await fetch(`${erpUrl}/api/accounting/vouchers?${query}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ERP getVouchers failed: ${response.status} - ${text}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : (data.data ?? data.items ?? data.vouchers ?? []);
  }

  /**
   * GET /api/accounting/vouchers/statistics/summary
   * Thống kê nhanh phiếu thu/chi theo khoảng thời gian
   */
  async getVouchersSummary(params: { month?: string; startDate?: string; endDate?: string } = {}): Promise<any> {
    const token = await this.login();
    const erpUrl = process.env.ERP_API_URL || 'http://localhost:9999';

    const query = new URLSearchParams();

    if (params.month) {
      const [y, m] = params.month.split('-').map(Number);
      query.set('startDate', `${y}-${String(m).padStart(2, '0')}-01`);
      const lastDay = new Date(y, m, 0).getDate();
      query.set('endDate', `${y}-${String(m).padStart(2, '0')}-${lastDay}`);
    } else {
      if (params.startDate) query.set('startDate', params.startDate);
      if (params.endDate) query.set('endDate', params.endDate);
    }

    this.logger.log(`📡 ERP getVouchersSummary: ${query.toString()}`);

    const response = await fetch(`${erpUrl}/api/accounting/vouchers/statistics/summary?${query}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ERP getVouchersSummary failed: ${response.status} - ${text}`);
    }

    return response.json();
  }

  /**
   * GET /api/hr/employees
   * Lấy danh sách nhân sự từ ERP
   */
  async getEmployees(params: {
    department?: string;
    status?: string;
    search?: string;
    limit?: number;
  } = {}): Promise<any[]> {
    const token = await this.login();
    const erpUrl = process.env.ERP_API_URL || 'http://localhost:9999';

    const query = new URLSearchParams();
    if (params.department) query.set('department', params.department);
    if (params.status) query.set('status', params.status || 'ACTIVE');
    if (params.search) query.set('search', params.search);
    query.set('limit', String(params.limit ?? 200));

    this.logger.log(`📡 ERP getEmployees: ${query.toString()}`);

    const response = await fetch(`${erpUrl}/api/hr/employees?${query}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ERP getEmployees failed: ${response.status} - ${text}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : (data.data ?? data.employees ?? data.items ?? []);
  }

  /**
   * GET /api/application/time-applications
   * Lấy danh sách đơn nghỉ phép từ ERP
   */
  async getLeaveApplications(params: {
    status?: string;
    filterWaitingApproval?: boolean;
    limit?: number;
  } = {}): Promise<any[]> {
    const token = await this.login();
    const erpUrl = process.env.ERP_API_URL || 'http://localhost:9999';

    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.filterWaitingApproval) query.set('filterWaitingApproval', 'true');
    query.set('limit', String(params.limit ?? 50));

    const response = await fetch(`${erpUrl}/api/application/time-applications?${query}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ERP getLeaveApplications failed: ${response.status} - ${text}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : (data.data ?? data.items ?? []);
  }

  /**
   * Generic GET - dùng khi cần gọi endpoint bất kỳ
   */
  async get<T = any>(path: string, queryParams?: Record<string, string>): Promise<T> {
    const token = await this.login();
    const erpUrl = process.env.ERP_API_URL || 'http://localhost:9999';

    const query = queryParams ? '?' + new URLSearchParams(queryParams).toString() : '';
    this.logger.log(`📡 ERP GET: ${path}${query}`);

    const response = await fetch(`${erpUrl}${path}${query}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ERP GET ${path} failed: ${response.status} - ${text}`);
    }

    return response.json();
  }

  /**
   * Probe ERP - thử các endpoint phổ biến để tìm endpoint hợp lệ cho vouchers
   * Dùng để debug khi không biết chính xác URL ERP
   */
  async probeEndpoints(): Promise<{ working: string[]; failed: Array<{ path: string; error: string }> }> {
    const erpUrl = process.env.ERP_API_URL || 'http://localhost:9999';
    let token = '';
    try { token = await this.login(); } catch { /* skip auth endpoints */ }

    const candidatePaths = [
      '/api/ui/health',
      '/api/accounting/vouchers',
      '/api/vouchers',
      '/api/payments',
      '/api/accounting/payments',
      '/api/accounting/receipts',
      '/api/accounting/transactions',
      '/api/finance/vouchers',
      '/api/workload-warning/admin/report/monthly?month=2026-04',
    ];

    const working: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];

    await Promise.all(
      candidatePaths.map(async (path) => {
        try {
          const res = await fetch(`${erpUrl}${path}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok || res.status === 400 || res.status === 422) {
            // 400/422 = endpoint exists but bad params
            working.push(`${path} → ${res.status}`);
          } else {
            failed.push({ path, error: `HTTP ${res.status}` });
          }
        } catch (e: any) {
          failed.push({ path, error: e.message });
        }
      }),
    );

    return { working, failed };
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
