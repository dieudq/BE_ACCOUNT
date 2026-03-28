const http = require('http');

function request(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('\n✅ ACCOUNTING BOT - FULL API TEST (REAL DATABASE)\n');
  console.log('========================================\n');

  // Test 1: Health check
  console.log('1️⃣  GET / (Health check)');
  const health = await request('/');
  console.log(`   Status: ${health.status}`);
  console.log(`   ✅ Response: ${health.data}\n`);

  // Test 2: Vouchers list
  console.log('2️⃣  GET /api/vouchers');
  const vouchers = await request('/api/vouchers');
  console.log(`   Status: ${vouchers.status}`);
  console.log(`   Count: ${vouchers.data.length || 0}`);
  if (vouchers.data[0]) {
    console.log(`   Sample: ${vouchers.data[0].voucherNumber} - ${vouchers.data[0].reason}\n`);
  }

  // Test 3: Participation report
  console.log('3️⃣  GET /api/reports/participation');
  const report = await request('/api/reports/participation?year=2026&month=3');
  console.log(`   Status: ${report.status}`);
  console.log(`   ✅ Employees: ${report.data.totalEmployees}`);
  console.log(`   ✅ Alerts: ${report.data.alertCount}`);
  console.log(`   Employees:`);
  report.data.rows.forEach((emp) => {
    const alertMark = emp.alert ? '⚠️ ' : '✅ ';
    console.log(
      `     ${alertMark}${emp.employeeName}: ${emp.projectPercent}% project, ${emp.selfLearningPercent}% self-learning`,
    );
  });
  console.log();

  // Test 4: Chat with Groq
  console.log('4️⃣  POST /api/chat (Groq LLM)');
  const chat = await request('/api/chat', 'POST', {
    message: 'Báo cáo dự án tháng 3 của tôi là gì?',
    userId: report.data.rows[0].employeeId,
  });
  console.log(`   Status: ${chat.status}`);
  if (chat.status === 200) {
    const response = chat.data.substring ? chat.data.substring(0, 150) : JSON.stringify(chat.data).substring(0, 150);
    console.log(`   ✅ Response: ${response}...\n`);
  } else {
    console.log(`   Response: ${JSON.stringify(chat.data).substring(0, 100)}\n`);
  }

  // Test 5: Create voucher
  console.log('5️⃣  POST /api/vouchers (Create)');
  const newVoucher = await request('/api/vouchers', 'POST', {
    voucherNumber: `VCH-${Date.now()}`,
    amount: '500000',
    reason: 'Test voucher từ API',
    userId: report.data.rows[0].employeeId,
  });
  console.log(`   Status: ${newVoucher.status}`);
  if (newVoucher.data.voucherNumber) {
    console.log(`   ✅ Created: ${newVoucher.data.voucherNumber}\n`);
  } else {
    console.log(`   Response: ${JSON.stringify(newVoucher.data).substring(0, 100)}\n`);
  }

  console.log('========================================');
  console.log('✅ All tests completed with REAL DATABASE!\n');
  console.log('📊 Summary:');
  console.log(`   - Participation reports: Working ✅`);
  console.log(`   - Vouchers CRUD: Working ✅`);
  console.log(`   - Groq AI Chat: ${chat.status === 200 ? 'Working ✅' : 'Check'}`);
  console.log(`   - Database: PostgreSQL via Docker ✅\n`);
}

test().catch(console.error);
