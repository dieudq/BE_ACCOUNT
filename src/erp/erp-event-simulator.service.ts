import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ERPEventListenerService, ERPEvent } from './erp-event-listener.service';

@Injectable()
export class ERPEventSimulatorService implements OnModuleInit, OnModuleDestroy {
  private schedulerInterval: NodeJS.Timer | null = null;
  private isRunning = false;

  constructor(private erpEventListener: ERPEventListenerService) {}

  onModuleInit() {
    console.log('🤖 ERP Event Simulator initialized');
  }

  onModuleDestroy() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval as any);
      this.isRunning = false;
      console.log('⏹️ ERP Event Simulator stopped');
    }
  }

  /**
   * Start simulator: Send fake ERP event every 30 minutes
   */
  startSimulator(intervalMinutes: number = 30) {
    if (this.isRunning) {
      console.warn('⚠️ Simulator already running');
      return;
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    this.isRunning = true;

    console.log(`🚀 ERP Event Simulator started (every ${intervalMinutes} minutes)`);

    // Run immediately on start
    this.sendFakeEvent();

    // Then run on interval
    this.schedulerInterval = setInterval(() => {
      this.sendFakeEvent();
    }, intervalMs) as any;
  }

  /**
   * Stop simulator
   */
  stopSimulator() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval as any);
      this.isRunning = false;
      console.log('⏹️ ERP Event Simulator stopped');
    }
  }

  /**
   * Generate and send fake payment_approved event
   */
  private async sendFakeEvent() {
    const timestamp = new Date();
    const amounts = [500000, 1000000, 2000000, 5000000];
    const reasons = [
      'Project Alpha development',
      'Marketing campaign expenses',
      'Infrastructure maintenance',
      'Employee training costs',
      'Software licenses renewal',
    ];
    const names = ['John Doe', 'Jane Smith', 'Michael Brown', 'Sarah Johnson'];

    const randomAmount = amounts[Math.floor(Math.random() * amounts.length)];
    const randomReason = reasons[Math.floor(Math.random() * reasons.length)];
    const randomName = names[Math.floor(Math.random() * names.length)];

    const fakeEvent: ERPEvent = {
      eventId: `sim_${Date.now()}`,
      eventType: 'payment_approved',
      timestamp,
      processId: `proc_sim_${Date.now()}`,
      data: {
        voucherId: `vch_sim_${Date.now()}`,
        amount: randomAmount,
        reason: randomReason,
        recipientName: randomName,
        recipientAccount: `${Math.random().toString().slice(2, 12)}`,
        paymentDate: timestamp.toISOString().split('T')[0],
        approverName: 'ERP Admin',
      },
    };

    console.log(`\n🎬 FAKE ERP EVENT TRIGGERED: ${timestamp.toLocaleString()}`);
    console.log(`   Amount: ${randomAmount.toLocaleString()} VND`);
    console.log(`   Reason: ${randomReason}`);
    console.log(`   Recipient: ${randomName}`);

    try {
      const result = await this.erpEventListener.processEvent(fakeEvent);
      console.log(`   ✅ Result: ${result.status} - ${result.message}`);
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
    }
  }

  /**
   * Get simulator status
   */
  getStatus() {
    return {
      running: this.isRunning,
      timestamp: new Date(),
    };
  }
}
