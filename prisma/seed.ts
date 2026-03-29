import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Clear existing data
  await prisma.botLog.deleteMany();
  await prisma.chatLog.deleteMany();
  await prisma.leaveBalance.deleteMany();
  await prisma.leave.deleteMany();
  await prisma.leaveQuota.deleteMany();
  await prisma.phieuChi.deleteMany();
  await prisma.voucher.deleteMany();
  await prisma.projectParticipation.deleteMany();
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

  // Create leave quotas (12 days paid leave/year for each employee)
  await prisma.leaveQuota.create({
    data: {
      userId: emp1.id,
      year: 2026,
      leaveType: 'paid',
      totalDays: '12',
      usedDays: '2',
    },
  });

  await prisma.leaveQuota.create({
    data: {
      userId: emp2.id,
      year: 2026,
      leaveType: 'paid',
      totalDays: '12',
      usedDays: '0',
    },
  });

  await prisma.leaveQuota.create({
    data: {
      userId: emp3.id,
      year: 2026,
      leaveType: 'paid',
      totalDays: '12',
      usedDays: '5',
    },
  });

  // Create sample leaves
  await prisma.leave.create({
    data: {
      userId: emp1.id,
      leaveType: 'paid',
      startDate: new Date('2026-03-09'),
      endDate: new Date('2026-03-10'),
      numDays: '2',
      reason: 'Personal leave',
      status: 'approved',
      approvedAt: new Date(),
    },
  });

  await prisma.leave.create({
    data: {
      userId: emp3.id,
      leaveType: 'sick',
      startDate: new Date('2026-03-15'),
      endDate: new Date('2026-03-17'),
      numDays: '2.5',
      reason: 'Illness',
      status: 'approved',
      approvedAt: new Date(),
    },
  });

  await prisma.leave.create({
    data: {
      userId: emp3.id,
      leaveType: 'unpaid',
      startDate: new Date('2026-03-20'),
      endDate: new Date('2026-03-22'),
      numDays: '2.5',
      reason: 'Urgent personal matter',
      status: 'approved',
      approvedAt: new Date(),
    },
  });

  // Create leave balances
  await prisma.leaveBalance.create({
    data: {
      userId: emp1.id,
      year: 2026,
      month: 3,
      leaveType: 'paid',
      daysUsed: '2',
      daysRemaining: '10',
    },
  });

  await prisma.leaveBalance.create({
    data: {
      userId: emp3.id,
      year: 2026,
      month: 3,
      leaveType: 'sick',
      daysUsed: '2.5',
      daysRemaining: '5.5',
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
  console.log(`- Leave Quotas: 3 (paid leave: 12 days/year)`);
  console.log(`- Leaves: 3 (2 paid, 2.5 sick, 2.5 unpaid)`);
  console.log(`- Leave Balances: 2 (tracking March 2026)`);
  console.log(`- Telegram ID: 5377791753 (can test as emp1)`);

  // ============ SEED GL ACCOUNTS ============
  console.log('\n🏦 Seeding GL Accounts...');

  // Assets
  const glCash = await prisma.gLAccount.create({
    data: {
      accountCode: '1001',
      accountName: 'Cash',
      accountType: 'asset',
      description: 'Current account and cash in hand',
      isActive: true,
    },
  });

  const glReceivables = await prisma.gLAccount.create({
    data: {
      accountCode: '1200',
      accountName: 'Accounts Receivable',
      accountType: 'asset',
      description: 'Customer receivables',
      isActive: true,
    },
  });

  // Liabilities
  const glPayables = await prisma.gLAccount.create({
    data: {
      accountCode: '2001',
      accountName: 'Accounts Payable',
      accountType: 'liability',
      description: 'Supplier payables',
      isActive: true,
    },
  });

  const glShortTermLoan = await prisma.gLAccount.create({
    data: {
      accountCode: '2100',
      accountName: 'Short-term Loan',
      accountType: 'liability',
      description: 'Short-term borrowing',
      isActive: true,
    },
  });

  // Equity
  const glCapital = await prisma.gLAccount.create({
    data: {
      accountCode: '3001',
      accountName: 'Charter Capital',
      accountType: 'equity',
      description: 'Company charter capital',
      isActive: true,
    },
  });

  const glRetainedEarnings = await prisma.gLAccount.create({
    data: {
      accountCode: '3100',
      accountName: 'Retained Earnings',
      accountType: 'equity',
      description: 'Accumulated retained earnings',
      isActive: true,
    },
  });

  // Income
  const glRevenue = await prisma.gLAccount.create({
    data: {
      accountCode: '4001',
      accountName: 'Service Revenue',
      accountType: 'income',
      description: 'Revenue from services',
      isActive: true,
    },
  });

  const glProjectIncome = await prisma.gLAccount.create({
    data: {
      accountCode: '4100',
      accountName: 'Project Income',
      accountType: 'income',
      description: 'Revenue from projects',
      isActive: true,
    },
  });

  // Expenses
  const glSalary = await prisma.gLAccount.create({
    data: {
      accountCode: '5001',
      accountName: 'Salaries and Wages',
      accountType: 'expense',
      description: 'Employee compensation',
      isActive: true,
    },
  });

  const glProjectExpense = await prisma.gLAccount.create({
    data: {
      accountCode: '5100',
      accountName: 'Project Expenses',
      accountType: 'expense',
      description: 'Costs related to projects',
      isActive: true,
    },
  });

  const glOperatingExpense = await prisma.gLAccount.create({
    data: {
      accountCode: '5200',
      accountName: 'Operating Expenses',
      accountType: 'expense',
      description: 'General operating costs',
      isActive: true,
    },
  });

  console.log('✅ GL Accounts created: 11 accounts');

  // ============ SEED FINANCIAL PERIOD ============
  console.log('\n📅 Seeding Financial Period...');

  const period = await prisma.financialPeriod.create({
    data: {
      code: '2026-03',
      description: 'March 2026',
      startDate: new Date('2026-03-01'),
      endDate: new Date('2026-03-31'),
      status: 'open',
      isClosed: false,
      fiscalYear: 2026,
      fiscalMonth: 3,
    },
  });

  console.log(`✅ Period created: ${period.code}`);

  // ============ SEED COST CENTER ============
  console.log('\n💼 Seeding Cost Centers...');

  const ccEngineering = await prisma.costCenter.create({
    data: {
      code: 'CC-ENG',
      name: 'Engineering',
      budget: new Decimal('100000000'), // 100M VND
      budgetYear: 2026,
      isActive: true,
    },
  });

  const ccMarketing = await prisma.costCenter.create({
    data: {
      code: 'CC-MKT',
      name: 'Marketing',
      budget: new Decimal('50000000'), // 50M VND
      budgetYear: 2026,
      isActive: true,
    },
  });

  console.log('✅ Cost Centers created: 2 centers');

  console.log('\n✅✅✅ COMPLETE SEEDING - Ready for Phase 2 (Financial Reporting)!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
