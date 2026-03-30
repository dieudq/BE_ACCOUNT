import { Controller, Post, Body, HttpCode, Get } from '@nestjs/common';
import { ERPEventListenerService, ERPEvent } from './erp-event-listener.service';

@Controller('webhooks/erp')
export class ERPWebhookController {
  constructor(private erpEventListener: ERPEventListenerService) {}

  /**
   * Main webhook endpoint for ERP events
   * POST /webhooks/erp/events
   *
   * Expected payload:
   * {
   *   "eventId": "evt_123456",
   *   "eventType": "payment_approved",
   *   "timestamp": "2026-03-30T09:15:00Z",
   *   "processId": "proc_123",
   *   "data": {
   *     "voucherId": "vch_123",
   *     "amount": 1000000,
   *     "reason": "Chi phí dự án",
   *     "recipientName": "Nguyễn Văn A",
   *     "recipientAccount": "0123456789",
   *     "paymentDate": "2026-03-30",
   *     "approverName": "Phạm Quản Lý"
   *   }
   * }
   */
  @Post('events')
  @HttpCode(200)
  async receiveEvent(@Body() payload: any) {
    console.log(`📨 ERP Webhook received:`, JSON.stringify(payload, null, 2));

    // Validate payload
    if (!payload.eventId || !payload.eventType) {
      return {
        status: 'error',
        message: 'Missing eventId or eventType',
      };
    }

    // Convert to ERPEvent
    const event: ERPEvent = {
      eventId: payload.eventId,
      eventType: payload.eventType,
      timestamp: new Date(payload.timestamp || new Date()),
      processId: payload.processId,
      data: payload.data,
    };

    // Process event
    try {
      const result = await this.erpEventListener.processEvent(event);
      return result;
    } catch (error) {
      console.error('Error processing ERP event:', error);
      return {
        status: 'error',
        message: error.message,
      };
    }
  }

  /**
   * Health check endpoint
   * GET /webhooks/erp/health
   */
  @Get('health')
  async health() {
    const status = await this.erpEventListener.getStatus();
    return {
      service: 'erp-event-listener',
      ...status,
    };
  }

  /**
   * Test endpoint (for development)
   * POST /webhooks/erp/test
   */
  @Post('test')
  @HttpCode(200)
  async testEvent() {
    const testEvent: ERPEvent = {
      eventId: `test_${Date.now()}`,
      eventType: 'payment_approved',
      timestamp: new Date(),
      processId: `proc_test_${Date.now()}`,
      data: {
        voucherId: 'vch_test_123',
        amount: 1000000,
        reason: 'Test payment from ERP webhook',
        recipientName: 'Nguyễn Văn A',
        recipientAccount: '0123456789',
        paymentDate: new Date().toISOString().split('T')[0],
        approverName: 'Phạm Quản Lý',
      },
    };

    console.log('🧪 Test event:', testEvent);
    return await this.erpEventListener.processEvent(testEvent);
  }
}
