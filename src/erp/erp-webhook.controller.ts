import { Controller, Post, Body, HttpCode, Get, Param } from '@nestjs/common';
import { ERPEventListenerService, ERPEvent } from './erp-event-listener.service';
import { ERPEventSimulatorService } from './erp-event-simulator.service';

@Controller('webhooks/erp')
export class ERPWebhookController {
  constructor(
    private erpEventListener: ERPEventListenerService,
    private erpSimulator: ERPEventSimulatorService,
  ) {}

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
   *     "reason": "Project Alpha expenses",
   *     "recipientName": "John Doe",
   *     "recipientAccount": "0123456789",
   *     "paymentDate": "2026-03-30",
   *     "approverName": "Admin Manager"
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
        recipientName: 'John Doe',
        recipientAccount: '0123456789',
        paymentDate: new Date().toISOString().split('T')[0],
        approverName: 'Admin Manager',
      },
    };

    console.log('🧪 Test event:', testEvent);
    return await this.erpEventListener.processEvent(testEvent);
  }

  /**
   * Simulator: Start sending fake events every N minutes
   * POST /webhooks/erp/simulator/start?interval=30
   */
  @Post('simulator/start')
  @HttpCode(200)
  async startSimulator() {
    this.erpSimulator.startSimulator(30); // 30 minutes
    return {
      status: 'ok',
      message: 'ERP Event Simulator started (30 minute interval)',
      timestamp: new Date(),
    };
  }

  /**
   * Simulator: Stop sending fake events
   * POST /webhooks/erp/simulator/stop
   */
  @Post('simulator/stop')
  @HttpCode(200)
  async stopSimulator() {
    this.erpSimulator.stopSimulator();
    return {
      status: 'ok',
      message: 'ERP Event Simulator stopped',
      timestamp: new Date(),
    };
  }

  /**
   * Simulator: Get status
   * GET /webhooks/erp/simulator/status
   */
  @Get('simulator/status')
  async simulatorStatus() {
    return this.erpSimulator.getStatus();
  }
}
