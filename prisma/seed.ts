import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // Clear existing data
  await prisma.chatLog.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.botLog.deleteMany();
  await prisma.phieuChi.deleteMany();
  await prisma.projectParticipation.deleteMany();
  await prisma.employeeHours.deleteMany();
  await prisma.voucher.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  // Create users
  const users = await Promise.all([
    prisma.user.create({
      data: {
        name: 'Nguyễn Văn A',
        email: 'a@company.com',
        telegramId: '5377791753',
        department: 'Engineering',
        role: 'employee',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Trần Thị B',
        email: 'b@company.com',
        department: 'Design',
        role: 'employee',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Lê Văn C',
        email: 'c@company.com',
        department: 'Engineering',
        role: 'manager',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Phạm Thị D',
        email: 'd@company.com',
        department: 'Accounting',
        role: 'admin',
      },
    }),
  ]);

  console.log(`✅ Created ${users.length} users`);

  // Create projects
  const projects = await Promise.all([
    prisma.project.create({
      data: {
        name: 'Project Alpha',
        code: 'ALPHA',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: 'active',
      },
    }),
    prisma.project.create({
      data: {
        name: 'Project Beta',
        code: 'BETA',
        startDate: new Date('2026-02-01'),
        status: 'active',
      },
    }),
    prisma.project.create({
      data: {
        name: 'Project Gamma',
        code: 'GAMMA',
        startDate: new Date('2026-03-01'),
        status: 'active',
      },
    }),
  ]);

  console.log(`✅ Created ${projects.length} projects`);

  // Create employee hours (Jira worklogs)
  const employeeHours = await Promise.all([
    prisma.employeeHours.create({
      data: {
        userId: users[0].id,
        projectId: projects[0].id,
        year: 2026,
        month: 3,
        loggedHours: '120.00',
        stdHours: '160.00',
        selfLearningHours: '40.00',
      },
    }),
    prisma.employeeHours.create({
      data: {
        userId: users[1].id,
        projectId: projects[1].id,
        year: 2026,
        month: 3,
        loggedHours: '140.00',
        stdHours: '160.00',
        selfLearningHours: '20.00',
      },
    }),
    prisma.employeeHours.create({
      data: {
        userId: users[2].id,
        projectId: projects[0].id,
        year: 2026,
        month: 3,
        loggedHours: '100.00',
        stdHours: '160.00',
        selfLearningHours: '60.00',
      },
    }),
  ]);

  console.log(`✅ Created ${employeeHours.length} employee hours records`);

  // Create sample vouchers
  const vouchers = await Promise.all([
    prisma.voucher.create({
      data: {
        voucherNumber: 'VCH-2026-001',
        userId: users[0].id,
        projectId: projects[0].id,
        amount: '1000000',
        reason: 'Tạm ứng dự án Alpha',
        status: 'pending',
        approvalLevel: 0,
      },
    }),
    prisma.voucher.create({
      data: {
        voucherNumber: 'VCH-2026-002',
        userId: users[1].id,
        projectId: projects[1].id,
        amount: '500000',
        reason: 'Chi phí thiết kế',
        status: 'approved',
        approvalLevel: 2,
        approvedAt: new Date(),
      },
    }),
  ]);

  console.log(`✅ Created ${vouchers.length} vouchers`);

  console.log('\n🌱 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
