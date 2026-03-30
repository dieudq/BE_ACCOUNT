import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from './telegram.service';

@Injectable()
export class TelegramGroupService {
  constructor(private prisma: PrismaService, private telegram: TelegramService) {}

  /**
   * Register a new group (called when bot receives message in new group)
   */
  async registerGroup(chatId: string, groupName?: string, description?: string) {
    const existing = await this.prisma.telegramGroup.findUnique({
      where: { chatId },
    });

    if (existing) {
      console.log(`✅ Group ${chatId} already registered`);
      return existing;
    }

    const group = await this.prisma.telegramGroup.create({
      data: {
        chatId,
        groupName,
        description,
        isActive: true,
      },
    });

    console.log(`✅ Group registered: ${chatId} (${groupName})`);
    return group;
  }

  /**
   * Get all active groups
   */
  async getActiveGroups() {
    return await this.prisma.telegramGroup.findMany({
      where: { isActive: true },
    });
  }

  /**
   * Deactivate a group
   */
  async deactivateGroup(chatId: string) {
    return await this.prisma.telegramGroup.update({
      where: { chatId },
      data: { isActive: false },
    });
  }

  /**
   * Send message to all active groups
   */
  async sendToAllGroups(text: string) {
    const groups = await this.getActiveGroups();
    console.log(`📢 Broadcasting to ${groups.length} groups...`);

    const bot = this.telegram.getBot();
    for (const group of groups) {
      try {
        await bot.sendMessage(group.chatId, text);
        console.log(`  ✅ Sent to: ${group.chatId} (${group.groupName})`);
      } catch (err) {
        console.error(`  ❌ Failed to send to ${group.chatId}:`, err.message);
      }
    }
  }

  /**
   * Get groups for webhook response
   */
  async getGroupsForDisplay() {
    const groups = await this.getActiveGroups();
    return groups.map((g) => ({
      chatId: g.chatId,
      name: g.groupName || 'Unknown',
      status: g.isActive ? 'active' : 'inactive',
    }));
  }
}
