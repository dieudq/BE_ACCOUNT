/**
 * WEBHOOK IMPLEMENTATION PLAN
 * 
 * Sự kiện: Phiếu chi (Voucher) được tạo thành công
 * Action: Gửi thông báo Telegram tới người được chỉ định (assigned users)
 */

// ============================================
// CURRENT FLOW (Existing Code):
// ============================================

// 1. VoucherService.create()
//    ├─ Create voucher record with status = DRAFT
//    ├─ Create approvals (người phê duyệt)
//    └─ Call notifyVoucherToResponsibleUsers('CREATED', users, actor)
//       └─ notifyVoucherToResponsibleUsers():
//          ├─ Loops through users (first approver)
//          ├─ Build notification using notificationBuilder.buildVoucherNotification()
//          └─ Call notificationService.sendUnifiedNotification()
//             └─ This sends Telegram via TelegramNotiService

// ============================================
// NEW WEBHOOK INTEGRATION:
// ============================================

// Option 1: EXTEND existing flow
// - Add webhook POST to external system when CREATED
// - Payload: { voucherId, code, totalAmount, assignedUsers, ... }

// Option 2: CREATE new webhook endpoint
// - POST /api/webhook/accounting/voucher-created
// - Receives: { event: 'voucher.created', voucher: {...}, actor: {...} }
// - Triggers: Internal notification + External system call

// ============================================
// IMPLEMENTATION STEPS:
// ============================================

// 1. Add webhook config to .env:
//    WEBHOOK_ACCOUNTING_URL=https://external-system.com/api/notifications
//    WEBHOOK_RETRY_ATTEMPTS=3
//    WEBHOOK_TIMEOUT=10000

// 2. Create WebhookService in common/webhook/:
//    ├─ sendWebhook(event, payload)
//    ├─ retryLogic()
//    └─ errorHandling()

// 3. Modify VoucherService.create():
//    └─ After notifyVoucherToResponsibleUsers():
//       └─ Call webhookService.sendWebhook('voucher.created', {
//          voucherId: voucher.id,
//          code: voucher.code,
//          totalAmount: voucher.totalAmount,
//          currency: voucher.currency,
//          assignedUsers: users, // người chỉ định (approvers)
//          content: voucher.content,
//          createdBy: actor,
//          timestamp: new Date().toISOString()
//       })

// 4. External system receives webhook → Extract assigned user → Check if linked to Telegram bot
//    → Use TelegramNotiService.sendMessage() to send to their Telegram

// ============================================
// CURRENT ASSIGNED USERS (from create flow):
// ============================================

// From buildVoucherResponsibleUsersReceiveNoti() with action='CREATED':
// - Người chỉ định = First approver (index 0) in voucher.approvals
// - Plus creator (người tạo)

// buildVoucherResponsibleUsersReceiveNoti() returns:
// [
//   { id, email, firstName, username, isNextStepUser: true, nextStepIndex: 0, nextStepName: '' },
//   { id, email, firstName, username, isNextStepUser: false }  // creator
// ]

// ============================================
// WHAT SẾP NEEDS:
// ============================================

// Input: Phiếu chi được tạo
// Process:
//   1. Lấy thông tin người chỉ định (approvers + creator)
//   2. Kiểm tra người nào linked với bot Telegram
//   3. Gửi Telegram tới từng người
//   4. Gửi webhook notification tới external system

// ============================================
// KEY FILES TO MODIFY:
// ============================================

// 1. twendee-erp/hr-system/src/features/accounting/voucher/voucher.service.ts
//    └─ In create() method, add webhook call after notifyVoucherToResponsibleUsers()

// 2. Create: twendee-erp/hr-system/src/common/webhook/webhook.service.ts
//    └─ Handle webhook sends + retries

// 3. Create: twendee-erp/hr-system/src/common/webhook/webhook.module.ts
//    └─ Import & provide WebhookService

// ============================================
