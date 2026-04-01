# 🧪 Full Workflow Test Guide

## Setup

### 1️⃣ Setup Test Users (Link Telegram IDs)
```bash
POST http://localhost:3000/test/setup-users
```

**Response:**
```json
{
  "status": "ok",
  "users": [
    { "email": "quynh@company.com", "telegramId": "123456789" },
    { "email": "linh@company.com", "telegramId": "987654321" },
    { "email": "long@company.com", "telegramId": "111222333" }
  ]
}
```

---

## Test Flow

### 2️⃣ Create Voucher (Chị Quỳnh tạo)
```bash
POST http://localhost:3000/test/voucher/create
```

**Notification:** Chị Linh nhận (first approver)

```
📋 Phiếu Chi - PC-2026-001
👤 Người lập: Trần Quỳnh
📝 Nội dung: Thanh toán hóa đơn quản lý tháng 3
💰 Số tiền: 5000000 VND
👉 Chị Linh - vui lòng duyệt
```

---

### 3️⃣ Chị Linh Approve
```bash
POST http://localhost:3000/test/voucher/approve/voucher-test-001
Content-Type: application/json

{
  "approverId": "user-linh-001"
}
```

**Notification:** Anh Long nhận (second approver)

```
✅ Chị Linh đã duyệt

📋 Phiếu Chi - PC-2026-001
👤 Người lập: Trần Quỳnh
📝 Nội dung: Thanh toán hóa đơn quản lý tháng 3
💰 Số tiền: 5000000 VND
👉 Anh Long - vui lòng duyệt
```

---

### 4️⃣ Anh Long Approve
```bash
POST http://localhost:3000/test/voucher/approve/voucher-test-001
Content-Type: application/json

{
  "approverId": "user-long-001"
}
```

**Notification:** Chị Quỳnh nhận (final notification)

```
✅ Anh Long đã duyệt

📋 Phiếu Chi - PC-2026-001
✅ PHIẾU CHI ĐÃ ĐƯỢC PHÊ DUYỆT

Tóm tắt:
  ✅ Chị Linh duyệt
  ✅ Anh Long duyệt
  
Thành công! Có thể thực hiện giao dịch.
```

---

## Rejection Flow (Alternative)

### ❌ Anh Long từ chối (REJECT instead of APPROVE)
```bash
POST http://localhost:3000/test/voucher/reject/voucher-test-001
Content-Type: application/json

{
  "approverId": "user-long-001",
  "comments": "Số tiền không khớp với hóa đơn. Vui lòng kiểm tra lại."
}
```

**Notification:** Chị Linh nhận (quay lại duyệt)

```
⚠️ Anh Long từ chối phiếu chi

📋 Phiếu Chi - PC-2026-001
👤 Người lập: Trần Quỳnh
📝 Nội dung: Thanh toán hóa đơn quản lý tháng 3
💰 Số tiền: 5000000 VND

❌ Lý do từ chối:
Số tiền không khớp với hóa đơn. Vui lòng kiểm tra lại.

👉 Chị Linh - vui lòng kiểm tra và sửa
```

---

### Then Chị Linh rejects too (back to Chị Quỳnh)
```bash
POST http://localhost:3000/test/voucher/reject/voucher-test-001
Content-Type: application/json

{
  "approverId": "user-linh-001",
  "comments": "Cần xác nhận lại với bộ phận kế toán"
}
```

**Notification:** Chị Quỳnh nhận (quay lại sửa)

```
⚠️ Chị Linh từ chối phiếu chi

❌ Lý do từ chối:
Cần xác nhận lại với bộ phòng kế toán

👉 Chị Quỳnh - vui lòng sửa và gửi lại
```

---

## Check Status

```bash
GET http://localhost:3000/test/voucher/status/voucher-test-001
```

**Response:**
```json
{
  "voucher": {
    "id": "voucher-test-001",
    "code": "PC-2026-001",
    "status": "APPROVED",
    "approvals": [
      {
        "approverUserId": "user-long-001",
        "status": "APPROVED",
        "createdAt": "2026-03-31T15:05:00Z"
      },
      {
        "approverUserId": "user-linh-001",
        "status": "APPROVED",
        "createdAt": "2026-03-31T15:04:00Z"
      }
    ]
  },
  "status": "FINAL_APPROVED"
}
```

---

## Summary

✅ **Full Flow Tested:**
- Chị Quỳnh tạo phiếu → Telegram notification
- Chị Linh duyệt → Next approver notification
- Anh Long duyệt → Final notification về Chị Quỳnh
- Rejection flow → Back to previous approver
- Status tracking → Real-time updates

🎯 **Key Points:**
- Each step sends notification to NEXT approver
- Final step sends to CREATOR (Chị Quỳnh)
- Rejection sends back to PREVIOUS approver
- All notifications via Telegram
