import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Clear existing data
  await prisma.botLog.deleteMany();
  await prisma.chatLog.deleteMany();
  await prisma.phieuChi.deleteMany();
  await prisma.voucher.deleteMany();
  await prisma.employeeHours.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  // Create projects
  const projectAlpha = await prisma.project.create({
    data: {
      code: 'ALPHA',
      name: 'Dự án Alpha',
      status: 'active',
    },
  });

  const projectBeta = await prisma.project.create({
    data: {
      code: 'BETA',
      name: 'Dự án Beta',
      status: 'active',
    },
  });

  // Create employees
  const emp1 = await prisma.user.create({
    data: {
      name: 'Nguyễn Văn A',
      email: 'nguyen.van.a@company.com',
      telegramId: '5377791753',
      department: 'Engineering',
      role: 'employee',
    },
  });

  const emp2 = await prisma.user.create({
    data: {
      name: 'Trần Thị B',
      email: 'tran.thi.b@company.com',
      telegramId: '987654321',
      department: 'Marketing',
      role: 'employee',
    },
  });

  const emp3 = await prisma.user.create({
    data: {
      name: 'Lê Văn C',
      email: 'le.van.c@company.com',
      telegramId: '111111111',
      department: 'Finance',
      role: 'employee',
    },
  });

  // Create accountant
  const accountant = await prisma.user.create({
    data: {
      name: 'Phạm Quản Lý',
      email: 'pham.quan.ly@company.com',
      telegramId: '222222222',
      department: 'Accounting',
      role: 'admin',
    },
  });

  // Create employee hours (participation data)
  await prisma.employeeHours.create({
    data: {
      userId: emp1.id,
      projectId: projectAlpha.id,
      year: 2026,
      month: 3,
      loggedHours: '120',
      stdHours: '160',
      selfLearningHours: '40',
      syncedAt: new Date(),
    },
  });

  await prisma.employeeHours.create({
    data: {
      userId: emp2.id,
      projectId: projectBeta.id,
      year: 2026,
      month: 3,
      loggedHours: '140',
      stdHours: '160',
      selfLearningHours: '20',
      syncedAt: new Date(),
    },
  });

  await prisma.employeeHours.create({
    data: {
      userId: emp3.id,
      projectId: projectAlpha.id,
      year: 2026,
      month: 3,
      loggedHours: '100',
      stdHours: '160',
      selfLearningHours: '60',
      syncedAt: new Date(),
    },
  });

  // Create sample vouchers
  const voucher1 = await prisma.voucher.create({
    data: {
      voucherNumber: 'VCH-001-2026-03',
      userId: emp1.id,
      projectId: projectAlpha.id,
      amount: '1000000',
      reason: 'Chi phí dự án Alpha - tháng 3',
      status: 'draft',
      approvalLevel: 0,
      createdAt: new Date('2026-03-29T08:00:00Z'),
    },
  });

  const voucher2 = await prisma.voucher.create({
    data: {
      voucherNumber: 'VCH-002-2026-03',
      userId: emp2.id,
      projectId: projectBeta.id,
      amount: '500000',
      reason: 'Chi phí marketing - tháng 3',
      status: 'approved',
      approvalLevel: 1,
      approvedAt: new Date('2026-03-29T10:00:00Z'),
      createdAt: new Date('2026-03-29T09:00:00Z'),
    },
  });

  // Create PhieuChi for approved voucher
  await prisma.phieuChi.create({
    data: {
      voucherId: voucher2.id,
      phieuChiNumber: 'PC-001-2026-03',
      content: 'Phiếu chi - Chi phí marketing - tháng 3',
      generatedAt: new Date('2026-03-29T10:15:00Z'),
    },
  });

  // Create chat logs
  await prisma.chatLog.create({
    data: {
      userId: emp1.id,
      message: 'Tôi muốn tạo voucher 1 triệu cho dự án alpha',
      response: 'Bot: Xác nhận tạo voucher 1,000,000 VND?',
      source: 'telegram',
      metadata: {
        chatId: 12345,
        telegramUserId: '5377791753',
      },
    },
  });

  // Create bot logs
  await prisma.botLog.create({
    data: {
      action: 'voucher_created',
      status: 'success',
      voucherId: voucher1.id,
      details: {
        amount: '1000000',
        reason: 'Chi phí dự án Alpha - tháng 3',
        employeeName: 'Nguyễn Văn A',
      },
    },
  });

  await prisma.botLog.create({
    data: {
      action: 'voucher_approved',
      status: 'success',
      voucherId: voucher2.id,
      details: {
        amount: '500000',
        reason: 'Chi phí marketing - tháng 3',
        approverName: 'Phạm Quản Lý',
        phieuChiNumber: 'PC-001-2026-03',
      },
    },
  });

  console.log('✅ Seeding complete!');
  console.log('\n📊 Sample Data:');
  console.log(`- Employees: 3 (emp1, emp2, emp3) + 1 accountant`);
  console.log(`- Projects: 2 (ALPHA, BETA)`);
  console.log(`- Vouchers: 2 (1 draft, 1 approved)`);
  console.log(`- PhieuChi: 1 (from approved voucher)`);
  console.log(`- Employee Hours: 3 (participation data)`);
  console.log(`- Telegram ID: 5377791753 (can test as emp1)`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
