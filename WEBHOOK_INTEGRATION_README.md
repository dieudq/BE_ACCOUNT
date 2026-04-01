# Webhook Integration: ERP → Bot Backend → Telegram

## 🎯 Flow

```
ERP (twendee-erp) - PORT 3100
    ↓ Create voucher
VoucherService.create()
    ↓ POST http://localhost:3000/webhook/voucher-created
Bot Backend (accounting-bot) - PORT 3000
    ├─ Receive webhook
    ├─ Record in DB (Voucher table)
    └─ Send Telegram to assignedUsers
        ↓
    Users receive Telegram notification
```

---

## 📁 Files Created

### Bot Backend (accounting-bot)
```
src/webhook/
├── voucher-webhook.controller.ts  - Handle POST /webhook/voucher-created
├── voucher-webhook.service.ts     - Record + Send Telegram
└── voucher-webhook.module.ts      - Module definition
```

### ERP (twendee-erp)
```
docs/
└── WEBHOOK_CALL_EXAMPLE.md        - How to call webhook from VoucherService
```

---

## 🚀 Implementation Steps

### Step 1: Bot Backend Setup

**1a. Add VoucherWebhookModule to app.module.ts**
```typescript
import { VoucherWebhookModule } from './webhook/voucher-webhook.module';

@Module({
  imports: [
    // ...
    VoucherWebhookModule,
  ],
})
export class AppModule {}
```

**1b. Add Voucher table to Prisma schema** (VOUCHER_SCHEMA.md)
```bash
npx prisma migrate dev --name add_voucher_table
```

**1c. Implement getTelegramIdByEmail()** in VoucherWebhookService
- Query User table to find telegram ID by email
- Call telegramService.sendMessage(telegramId, message)

### Step 2: ERP Setup

**2a. Update VoucherService**
- Add axios POST call after voucher.create()
- Send webhook to bot backend
- See: WEBHOOK_CALL_EXAMPLE.md

**2b. Add env variable**
```
BOT_BACKEND_URL=http://localhost:3100
```

---

## 📊 Webhook Payload

**POST** `http://localhost:3000/webhook/voucher-created`

```json
{
  "voucherId": "uuid-from-erp",
  "voucherCode": "PV-2026-001",
  "voucherType": "PAYMENT",
  "totalAmount": 5000000,
  "currency": "VND",
  "content": "Chi tiền quản lý tháng 3",
  "createdBy": {
    "id": "user-id",
    "email": "tranninh@company.com",
    "firstName": "Ninh",
    "lastName": "Trần"
  },
  "assignedUsers": [
    {
      "id": "approver-id",
      "email": "approver@company.com",
      "firstName": "A",
      "lastName": "Nguyễn",
      "username": "nguyena"
    }
  ],
  "timestamp": "2026-03-31T13:50:00Z"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Phiếu chi PV-2026-001 đã được ghi nhận",
  "voucherId": "bot-db-id"
}
```

---

## 🔐 Security (Future)

- [ ] Add webhook signature verification (HMAC)
- [ ] Add API key authentication
- [ ] Add rate limiting
- [ ] Add request logging

---

## 📝 Database Schema

```prisma
model Voucher {
  id            String    @id @default(cuid())
  externalId    String    @unique        // ID từ ERP
  code          String    @unique        // PV-2026-001
  type          String                  // PAYMENT | RECEIPT
  amount        Float                   // 5000000
  currency      String                  // VND
  content       String                  // Chi tiền quản lý
  createdBy     String                  // Email
  creatorName   String?
  assignedUsers String                  // JSON
  status        String    @default("CREATED") // CREATED, APPROVED, REJECTED
  receivedAt    DateTime  @default(now())
  approvedAt    DateTime?
  rejectedAt    DateTime?
}
```

---

## ✅ Checklist

- [ ] Add VoucherWebhookModule to AppModule (bot backend)
- [ ] Add Voucher schema to Prisma (bot backend)
- [ ] Implement getTelegramIdByEmail() (bot backend)
- [ ] Add POST call in VoucherService.create() (ERP)
- [ ] Add BOT_BACKEND_URL=http://localhost:3000 to .env (ERP)
- [ ] Test webhook with POST /webhook/test (bot backend)
- [ ] Test full flow: Create voucher → Receive webhook → Send Telegram

---

## 🎲 Sếp!

Ready? Files created:
- ✅ Bot webhook endpoint
- ✅ Service (record + telegram)
- ✅ Module
- ✅ Prisma schema
- ✅ Integration example

Just follow steps above! 🚀
