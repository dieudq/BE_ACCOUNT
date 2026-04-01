import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ErpClientService {
  private readonly logger = new Logger(ErpClientService.name);
  private accessToken: string | null = null;
  private readonly baseUrl = 'http://localhost:9999/api';

  constructor(private readonly httpService: HttpService) {}

  /**
   * Đăng nhập vào ERP bằng tài khoản có quyền ACCOUNTING
   */
  private async login(): Promise<string> {
    try {
      this.logger.log('🔑 Đang đăng nhập vào ERP bằng tài khoản admin_bot...');

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/auth/login`, {
          // Sử dụng thông tin User bạn vừa tạo thành công
          username: 'adminbot@twendeesoft.com',
          password: 'Admin@123',
        }),
      );

      // Lưu ý: Tùy vào cấu trúc response của ERP,
      // có thể là response.data.accessToken hoặc response.data.data.accessToken
      this.accessToken =
        response.data?.accessToken || response.data?.data?.accessToken;

      if (!this.accessToken) {
        throw new Error(
          'Đăng nhập thành công nhưng không nhận được Access Token',
        );
      }

      this.logger.log('✅ Đã lấy Token mới từ ERP');
      return this.accessToken;
    } catch (error: any) {
      this.logger.error(
        `❌ ERP Login Failed: ${error.response?.data?.message || error.message}`,
      );
      throw error;
    }
  }

  private async request(method: 'post' | 'get', path: string, data?: any) {
    if (!this.accessToken) await this.login();

    const fullUrl = `${this.baseUrl}${path}`;
    const config = {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    };

    try {
      this.logger.warn(`🚀 ERP CALL: [${method.toUpperCase()}] ${fullUrl}`);
      const response = await firstValueFrom(
        method === 'post'
          ? this.httpService.post(fullUrl, data, config)
          : this.httpService.get(fullUrl, config),
      );
      return response;
    } catch (error: any) {
      // Nếu Token hết hạn (401), thử login lại và gọi lại request
      if (error.response?.status === 401) {
        this.logger.warn('⚠️ Token hết hạn, đang thử làm mới...');
        await this.login();
        return this.request(method, path, data);
      }

      this.logger.error(
        `❌ ERP Request Error ${error.response?.status}: ${JSON.stringify(error.response?.data)}`,
      );
      throw error;
    }
  }

  /**
   * Gọi API duyệt lên ERP
   */
  async approveOnErp(erpId: string, email: string) {
    const payload = {
      comments: `Approved via Telegram by ${email}`,
      // Một số ERP yêu cầu thêm status trong body
      status: 'APPROVED',
    };

    return (
      await this.request(
        'post',
        `/accounting/vouchers/${erpId}/approve`,
        payload,
      )
    ).data;
  }

  async rejectOnErp(erpId: string, email: string, reason: string) {
    const payload = {
      reason: reason || 'Rejected via Telegram',
      comments: `Rejected by ${email}`,
      status: 'REJECTED',
    };
    return (
      await this.request(
        'post',
        `/accounting/vouchers/${erpId}/reject`,
        payload,
      )
    ).data;
  }

  async cancelOnErp(erpId: string, email: string, reason: string) {
    const payload = {
      reason: reason,
      note: `Cancelled via Telegram by ${email}`,
    };
    return (
      await this.request(
        'post',
        `/accounting/vouchers/${erpId}/cancel`,
        payload,
      )
    ).data;
  }
}
