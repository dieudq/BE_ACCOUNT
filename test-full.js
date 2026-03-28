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
  console.log('\n✅ ACCOUNTING BOT - API TEST SUITE\n');
  console.log('========================================\n');

  // Test 1: Health check
  console.log('1️⃣  GET / (Health check)');
  const health = await request('/');
  console.log(`   Status: ${health.status}`);
  console.log(`   Response: ${health.data}\n`);

  // Test 2: Vouchers list
  console.log('2️⃣  GET /api/vouchers');
  const vouchers = await request('/api/vouchers');
  console.log(`   Status: ${vouchers.status}`);
  console.log(`   Count: ${Array.isArray(vouchers.data) ? vouchers.data.length : 'N/A'}\n`);

  // Test 3: Chat
  console.log('3️⃣  POST /api/chat');
  const chat = await request('/api/chat', 'POST', {
    message: 'Xin chào, báo cáo dự án tháng 3 như thế nào?',
    userId: 'emp001',
  });
  console.log(`   Status: ${chat.status}`);
  console.log(`   Response: ${JSON.stringify(chat.data).substring(0, 100)}...\n`);

  // Test 4: Participation report
  console.log('4️⃣  GET /api/reports/participation');
  const report = await request('/api/reports/participation?year=2026&month=3');
  console.log(`   Status: ${report.status}`);
  console.log(`   Employees: ${report.data.totalEmployees}`);
  console.log(`   Alerts: ${report.data.alertCount}`);
  console.log(`   Sample employee:`);
  if (report.data.rows && report.data.rows[0]) {
    const emp = report.data.rows[0];
    console.log(`     - ${emp.employeeName}: ${emp.projectPercent}% project, ${emp.selfLearningPercent}% self-learning`);
  }
  console.log();

  // Test 5: Errors handling
  console.log('5️⃣  Error handling - Invalid year');
  const invalid = await request('/api/reports/participation?year=invalid&month=3');
  console.log(`   Status: ${invalid.status}`);
  console.log(`   Error: ${invalid.data.error}\n`);

  console.log('========================================');
  console.log('✅ All tests completed!\n');
}

test().catch(console.error);
