import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create users
  const user1 = await prisma.user.upsert({
    where: { email: 'a@company.com' },
    update: {},
    create: {
      name: 'Nguyễn Văn A',
      email: 'a@company.com',
      department: 'Sales',
      role: 'employee',
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: 'b@company.com' },
    update: {},
    create: {
      name: 'Trần Thị B',
      email: 'b@company.com',
      department: 'Development',
      role: 'employee',
    },
  });

  // Create projects
  const proj1 = await prisma.project.upsert({
    where: { code: 'PROJ-001' },
    update: {},
    create: {
      name: 'Project X',
      code: 'PROJ-001',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      status: 'active',
    },
  });

  const proj2 = await prisma.project.upsert({
    where: { code: 'PROJ-002' },
    update: {},
    create: {
      name: 'Project Y',
      code: 'PROJ-002',
      startDate: new Date('2026-03-01'),
      endDate: new Date('2026-06-30'),
      status: 'active',
    },
  });

  console.log('✅ Seed completed');
  console.log('Users:', { user1, user2 });
  console.log('Projects:', { proj1, proj2 });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seed error:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
