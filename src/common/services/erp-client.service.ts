import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ERPClientService {
  private readonly logger = new Logger(ERPClientService.name);
  private accessToken: string = '';
  private tokenExpiresAt: number = 0;

  constructor() {}

  /**
   * Login to ERP and get access token
   */
  async login(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      this.logger.log(`🔐 Using cached ERP token`);
      return this.accessToken;
    }

    try {
      const username = process.env.ERP_USERNAME;
      const password = process.env.ERP_PASSWORD;
      const erpUrl = process.env.ERP_API_URL || 'http://localhost:3100';

      if (!username || !password) {
        throw new Error('ERP_USERNAME or ERP_PASSWORD not configured');
      }

      this.logger.log(`🔓 Logging into ERP as ${username}...`);

      const response = await fetch(`${erpUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password }),
      });

      if (!response.ok) {
        throw new Error(`ERP login failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      this.accessToken = data.accessToken;
      this.tokenExpiresAt = Date.now() + (data.expiresIn || 3600) * 1000;

      this.logger.log(`✅ ERP login successful, token expires in ${data.expiresIn || 3600}s`);
      return this.accessToken;
    } catch (error) {
      this.logger.error(`❌ ERP login error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Approve a voucher in ERP
   */
  async approveVoucher(voucher: any, approvalReason?: string): Promise<any> {
    try {
      const token = await this.login();
      const erpUrl = process.env.ERP_API_URL || 'http://localhost:3100';

      // Use voucherNumber (phiếu chi code) instead of local ID
      const voucherCode = voucher.voucherNumber || voucher.code || voucher.id;

      this.logger.log(`✅ Approving ERP voucher ${voucherCode}...`);
      this.logger.log(`📤 Voucher object:`, JSON.stringify(voucher));

      const approvePayload = { reason: approvalReason || 'Approved via Telegram Bot' };
      this.logger.log(`📤 Approve payload:`, JSON.stringify(approvePayload));

      const response = await fetch(`${erpUrl}/api/accounting/vouchers/${voucherCode}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(approvePayload),
      });

      this.logger.log(`📥 ERP response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`❌ ERP error response: ${errorText}`);
        throw new Error(`ERP approve failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      this.logger.log(`✅ Voucher ${voucherCode} approved in ERP`, JSON.stringify(result));
      return result;
    } catch (error) {
      this.logger.error(`❌ ERP approve error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reject a voucher in ERP
   */
  async rejectVoucher(voucherId: string, rejectionReason: string): Promise<any> {
    try {
      const token = await this.login();
      const erpUrl = process.env.ERP_API_URL || 'http://localhost:3100';

      this.logger.log(`❌ Rejecting ERP voucher ${voucherId}...`);

      const response = await fetch(`${erpUrl}/api/accounting/vouchers/${voucherId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: rejectionReason || 'Rejected via Telegram Bot' }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ERP reject failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      this.logger.log(`❌ Voucher ${voucherId} rejected in ERP`);
      return result;
    } catch (error) {
      this.logger.error(`❌ ERP reject error: ${error.message}`);
      throw error;
    }
  }
}
