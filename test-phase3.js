#!/usr/bin/env node

const http = require('http');

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                 PHASE 3: VOUCHER AUTOMATION                    ║
║                 2-Step Telegram Confirmation                   ║
╚═══════════════════════════════════════════════════════════════╝

📋 FLOW:
1. User sends voucher request via Telegram
2. Bot parses intent with Groq LLM
3. Bot asks for confirmation
4. User confirms: "YES <confirmationId>"
5. Bot creates voucher draft
6. Accountant approves

🧪 TEST: Send to @AccountingTWD_Bot:
  "Tôi muốn tạo voucher 1000000 VND cho chi phí dự án alpha"

Expected: Bot returns confirmation request
Send back: "YES <id>" to confirm

═══════════════════════════════════════════════════════════════

`);

// Simple test to check server is ready
const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/health',
  method: 'GET',
};

const req = http.request(options, (res) => {
  if (res.statusCode === 200) {
    console.log('✅ Server running - Ready for Phase 3 testing!');
    console.log('🔗 Webhook: https://b8ee-42-114-249-177.ngrok-free.app/webhooks/telegram');
    console.log('🤖 Bot: @AccountingTWD_Bot');
  } else {
    console.log('❌ Server check failed');
  }
});

req.on('error', (e) => {
  console.error('❌ Cannot reach server:', e.message);
});

req.end();
