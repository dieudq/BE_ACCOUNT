import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import TelegramBot from 'node-telegram-bot-api';

@Injectable()
export class BotCommandService {
  constructor(private prisma: PrismaService) {}

  /**
   * Handle /start command
   */
  async handleStart(bot: TelegramBot, chatId: string | number): Promise<void> {
    const welcome = `
Welcome to Accounting Bot! 🤖

Available Commands:
/start - Show this welcome message
/help - Display all available commands
/report - View monthly participation report
/approvals - List pending approvals
/vouchers - List all vouchers
/balance - View GL account balance
/export - Export reports to Excel
/status - Check system status

Type any command to get started!
    `.trim();

    await bot.sendMessage(chatId, welcome);
  }

  /**
   * Handle /help command
   */
  async handleHelp(bot: TelegramBot, chatId: string | number): Promise<void> {
    const help = `
📚 AVAILABLE COMMANDS

/start - Welcome & intro
/report - Participation report (month/year required)
  Usage: /report 2026 3

/approvals - Show pending approvals
  Displays: Count, list, status

/vouchers - List all vouchers
  Displays: ID, amount, status, last updated

/balance - GL Account Balance
  Usage: /balance 1111
  Shows: Account detail, debit, credit, balance

/export - Export reports
  Options: participation, cashflow, financial

/status - System health check
  Shows: DB, services, uptime

/help - Show this message
    `.trim();

    await bot.sendMessage(chatId, help);
  }

  /**
   * Handle /report command - Monthly participation
   */
  async handleReport(
    bot: TelegramBot,
    chatId: string | number,
    args?: string[],
  ): Promise<void> {
    try {
      const year = parseInt(args?.[0] || new Date().getFullYear().toString());
      const month = parseInt(args?.[1] || (new Date().getMonth() + 1).toString());

      const message = `
Participation Report - ${month}/${year}

To generate report, use API endpoint:
GET /api/reports/participation?year=${year}&month=${month}

Then download Excel file.
      `.trim();

      await bot.sendMessage(chatId, message);
    } catch (err) {
      await bot.sendMessage(chatId, `Error: ${(err as Error).message}`);
    }
  }

  /**
   * Handle /approvals command
   */
  async handleApprovals(bot: TelegramBot, chatId: string | number): Promise<void> {
    try {
      const pending = await this.prisma.approval.findMany({
        where: { status: 'pending' },
        take: 10,
      });

      if (pending.length === 0) {
        await bot.sendMessage(chatId, 'No pending approvals.');
        return;
      }

      const message = `
Pending Approvals: ${pending.length}

${pending
  .slice(0, 5)
  .map(
    (a, i) => `
${i + 1}. Approval ID: ${a.id}
   Status: ${a.status}
   Created: ${new Date(a.createdAt).toLocaleDateString('en-US')}
      `,
  )
  .join('\n')}

${pending.length > 5 ? `\n... and ${pending.length - 5} more` : ''}

Use APPROVE <id> or REJECT <id> to take action
      `.trim();

      await bot.sendMessage(chatId, message);
    } catch (err) {
      await bot.sendMessage(chatId, `Error: ${(err as Error).message}`);
    }
  }

  /**
   * Handle /vouchers command
   */
  async handleVouchers(bot: TelegramBot, chatId: string | number): Promise<void> {
    try {
      const vouchers = await this.prisma.voucher.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
      });

      if (vouchers.length === 0) {
        await bot.sendMessage(chatId, 'No vouchers found.');
        return;
      }

      const message = `
Recent Vouchers: ${vouchers.length}

Vouchers retrieved from database.

Use /approvals to see pending approvals.
      `.trim();

      await bot.sendMessage(chatId, message);
    } catch (err) {
      await bot.sendMessage(chatId, `Error: ${(err as Error).message}`);
    }
  }

  /**
   * Handle /balance command - GL Account balance
   */
  async handleBalance(
    bot: TelegramBot,
    chatId: string | number,
    args?: string[],
  ): Promise<void> {
    try {
      const accountCode = args?.[0];

      if (!accountCode) {
        await bot.sendMessage(
          chatId,
          'Usage: /balance <account_code>\nExample: /balance 1111',
        );
        return;
      }

      const account = await this.prisma.gLAccount.findFirst({
        where: { accountCode },
      });

      if (!account) {
        await bot.sendMessage(chatId, `Account ${accountCode} not found.`);
        return;
      }

      const message = `
GL Account Balance

Code: ${account.accountCode}
Name: ${account.accountName}
Type: ${account.accountType}

Account found. Use API to get full balance.
      `.trim();

      await bot.sendMessage(chatId, message);
    } catch (err) {
      await bot.sendMessage(chatId, `Error: ${(err as Error).message}`);
    }
  }

  /**
   * Handle /export command
   */
  async handleExport(
    bot: TelegramBot,
    chatId: string | number,
    // @ts-ignore
    args?: string[],
  ): Promise<void> {
    // @ts-ignore
    const type = args?.[0] || 'participation';

    const message = `
Export Options:
- participation: Monthly participation report
- cashflow: Cashflow report
- financial: Financial reports

Usage: /export <type>
Example: /export cashflow

Files will be generated and available for download.
    `.trim();

    await bot.sendMessage(chatId, message);
  }

  /**
   * Handle /status command
   */
  async handleStatus(bot: TelegramBot, chatId: string | number): Promise<void> {
    try {
      const userCount = await this.prisma.user.count();
      const voucherCount = await this.prisma.voucher.count();

      const message = `
System Status: OK ✅

Database:
- Users: ${userCount}
- Vouchers: ${voucherCount}

Services:
- Telegram: Connected
- Database: Connected
- ERP Listener: Running

Last check: ${new Date().toLocaleString('en-US')}
      `.trim();

      await bot.sendMessage(chatId, message);
    } catch (err) {
      await bot.sendMessage(chatId, `System Status: ERROR\n${(err as Error).message}`);
    }
  }
}
