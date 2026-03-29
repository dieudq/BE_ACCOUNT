import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApprovalWorkflowService } from './approval-workflow.service';

@Controller('api/approvals')
export class ApprovalController {
  constructor(private approvalService: ApprovalWorkflowService) {}

  @Get('pending')
  async getPending(@Body() body: { accountantId: string }) {
    return this.approvalService.getPendingVouchers(body.accountantId);
  }

  @Get('summary')
  async getSummary() {
    return this.approvalService.getVoucherSummary();
  }

  @Post('review/:voucherId')
  async requestReview(@Param('voucherId') voucherId: string, @Body() body: { accountantId: string }) {
    return this.approvalService.requestVoucherForReview(body.accountantId, voucherId);
  }

  @Post('approve')
  async approve(@Body() body: { telegramId: string; requestId: string }) {
    return this.approvalService.approveVoucher(body.telegramId, body.requestId);
  }

  @Post('reject')
  async reject(
    @Body() body: { telegramId: string; requestId: string; reason: string },
  ) {
    return this.approvalService.rejectVoucher(body.telegramId, body.requestId, body.reason);
  }
}
