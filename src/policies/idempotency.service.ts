import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class IdempotencyService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate idempotency key for action
   * Format: {userId}:{actionType}:{resourceId}:{timestamp_minute}
   */
  generateKey(userId: string, actionType: string, resourceId?: string): string {
    const timestamp = Math.floor(Date.now() / 60000); // minute precision
    const resource = resourceId || 'global';
    return `${userId}:${actionType}:${resource}:${timestamp}`;
  }

  /**
   * Check if action already executed
   */
  async isDuplicate(key: string): Promise<boolean> {
    const existing = await this.prisma.botLog.findFirst({
      where: {
        details: {
          path: ['idempotencyKey'],
          equals: key,
        },
      },
    });
    return !!existing;
  }

  /**
   * Record action execution
   */
  async recordAction(
    key: string,
    action: string,
    userId: string,
    result: any,
  ): Promise<void> {
    await this.prisma.botLog.create({
      data: {
        action,
        status: 'success',
        details: {
          idempotencyKey: key,
          userId,
          executedAt: new Date().toISOString(),
          result,
        },
      },
    });
  }
}
