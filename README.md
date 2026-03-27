# Accounting Bot Backend - NestJS + Prisma

Tự động hóa phiếu chi, báo cáo tài chính, và % tham gia dự án using **NestJS** + **Prisma** + **PostgreSQL**.

## 🚀 Tech Stack

- **NestJS** - Progressive Node.js framework
- **Prisma** - Next-generation ORM
- **PostgreSQL** - Relational database
- **Telegram Bot API** - Notifications
- **ExcelJS** - Report generation
- **TypeScript** - Type safety

## 📋 Quick Start

### Prerequisites

```bash
- Node.js 18+
- PostgreSQL 14+
- npm
```

### Installation

```bash
# Navigate to project
cd accounting-bot-be

# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Setup database
npm run db:push

# Seed demo data (optional)
npm run prisma:seed
```

### Running

```bash
# Development (with auto-reload)
npm run start:dev

# Production
npm run start

# Debug mode
npm run start:debug
```

Server runs on `http://localhost:3000`

## 🔧 Database Setup

### Create PostgreSQL Database

```bash
createdb accounting_bot
```

### Update .env

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/accounting_bot?schema=public"
```

### Initialize Schema

```bash
# Create tables from Prisma schema
npm run db:push

# Or using migrations (recommended for production)
npm run prisma:migrate

# View database in Prisma Studio
npm run prisma:studio
```

## 📊 API Endpoints

### Health Check
```bash
GET /health              # Server health
GET /                    # App info
```

### Vouchers (Phiếu Chi)
```bash
GET    /api/vouchers           # List all vouchers
GET    /api/vouchers/:id       # Get specific voucher
POST   /api/vouchers           # Create new voucher
PATCH  /api/vouchers/:id       # Update voucher
DELETE /api/vouchers/:id       # Delete voucher
```

### Webhooks
```bash
POST /webhooks/erp             # ERP webhook receiver
```

## 📁 Project Structure

```
accounting-bot-be/
├── src/
│   ├── main.ts                 # Entry point
│   ├── app.module.ts          # Root module
│   ├── app.controller.ts      # Health endpoints
│   ├── prisma/
│   │   ├── prisma.service.ts  # Prisma client service
│   │   └── prisma.module.ts   # Prisma module
│   ├── modules/
│   │   └── vouchers/          # Vouchers CRUD
│   │       ├── vouchers.module.ts
│   │       ├── vouchers.service.ts
│   │       ├── vouchers.controller.ts
│   │       └── dto/
│   └── webhooks/              # ERP webhooks
│       ├── webhooks.module.ts
│       └── webhooks.controller.ts
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── seed.ts                # Database seeding
├── .env                       # Environment config
├── package.json
└── README.md
```

## 🗄️ Database Schema

### Models

- **User** - Employees
- **Project** - Projects
- **Voucher** - Phiếu chi/Tạm ứng
- **PhieuChi** - Generated vouchers
- **EmployeeHours** - Work hours tracking
- **ProjectParticipation** - % participation
- **BotLog** - Audit logs
- **Alert** - System alerts

### View Schema

```bash
# Open Prisma Studio (visual database browser)
npm run prisma:studio
```

## 🧪 Testing APIs

### Using curl

```bash
# Health check
curl http://localhost:3000/health

# Get all vouchers
curl http://localhost:3000/api/vouchers

# Create voucher
curl -X POST http://localhost:3000/api/vouchers \
  -H "Content-Type: application/json" \
  -d '{
    "voucherNumber": "TAU-001",
    "amount": 10000000,
    "reason": "Tạm ứng công tác"
  }'

# ERP webhook test
curl -X POST http://localhost:3000/webhooks/erp \
  -H "Content-Type: application/json" \
  -d '{
    "voucherNumber": "TAU-002",
    "amount": 5000000,
    "status": "approved"
  }'

# Get specific voucher
curl http://localhost:3000/api/vouchers/<id>

# Update voucher
curl -X PATCH http://localhost:3000/api/vouchers/<id> \
  -H "Content-Type: application/json" \
  -d '{"status": "approved", "approvalLevel": 1}'

# Delete voucher
curl -X DELETE http://localhost:3000/api/vouchers/<id>
```

### Using Postman

1. Import Postman collection (or create manually)
2. Base URL: `http://localhost:3000`
3. Add endpoints listed above

## 📝 Environment Variables

```env
# Server
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/accounting_bot?schema=public"

# ERP Integration
ERP_API_URL=http://localhost:8080/api
ERP_API_KEY=demo-key-123
ERP_WEBHOOK_URL=http://localhost:3000/webhooks/erp

# Jira Integration
JIRA_URL=https://jira.company.com
JIRA_USERNAME=bot_user
JIRA_API_TOKEN=demo-token-123

# Logworks Integration
LOGWORKS_API_URL=https://logworks.app/api
LOGWORKS_API_KEY=demo-key-123

# Telegram Bot
TELEGRAM_BOT_TOKEN=xxxxx
TELEGRAM_GROUP_ID=-xxxxx

# Report config
SELF_LEARNING_ALERT_THRESHOLD=30
```

## 🎓 NestJS + Prisma Commands

### Generate Resources

```bash
# Generate complete module (controller + service + DTOs)
nest g resource modules/users

# Generate module only
nest g module modules/users

# Generate service
nest g service modules/users

# Generate controller
nest g controller modules/users

# Generate DTO
nest g class modules/users/dto/create-user.dto
```

### Prisma Commands

```bash
# Generate Prisma client
npm run prisma:generate

# Create migration
npm run prisma:migrate

# Deploy migrations (production)
npm run prisma:migrate:prod

# Push schema to database (development only)
npm run db:push

# Reset database (⚠️ deletes all data)
npm run db:reset

# Open Prisma Studio (visual DB editor)
npm run prisma:studio

# Seed database
npm run prisma:seed
```

## 📈 Development Workflow

### Day 1: Foundation ✅
```bash
✅ NestJS + Prisma setup
✅ Database schema created
✅ Prisma client configured
✅ Vouchers CRUD endpoints
✅ ERP webhook receiver
```

### Day 2-3: Module A (Phiếu Chi)
```
[ ] Create Users module
[ ] Create Projects module
[ ] Auto-generate phiếu chi
[ ] Email notifications
[ ] Telegram notifications
```

### Day 4-5: Module C (% Tham gia)
```
[ ] Jira API integration
[ ] Logworks API integration
[ ] Hours sync service
[ ] Participation calculation
[ ] Report generation
```

### Day 6-7: Testing & Deployment
```
[ ] Unit tests
[ ] E2E tests
[ ] Docker setup
[ ] Production deployment
```

## 🐛 Troubleshooting

### Database Connection Error

```bash
# Check PostgreSQL is running
psql -U postgres

# Verify .env DATABASE_URL
# Update password if needed

# Create database if missing
createdb accounting_bot

# Push schema again
npm run db:push
```

### Port Already in Use

```bash
# Change PORT in .env
# Or kill process using port 3000 (Linux/Mac):
lsof -ti:3000 | xargs kill -9

# Windows PowerShell:
Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process
```

### Prisma Client Not Found

```bash
# Regenerate Prisma client
npm run prisma:generate

# Clear node_modules and reinstall
rm -rf node_modules && npm install
npm run prisma:generate
```

### Migration Issues

```bash
# Reset database (careful - deletes all data)
npm run db:reset

# Or manually reset:
npm run prisma:migrate reset
```

## 📚 Resources

- [NestJS Docs](https://docs.nestjs.com)
- [Prisma Docs](https://www.prisma.io/docs)
- [Prisma + NestJS Guide](https://www.prisma.io/docs/guides/database/using-prisma-with-nestjs)
- [PostgreSQL Docs](https://www.postgresql.org/docs)

## 🎯 Next Steps

1. ✅ **Setup Database**
   ```bash
   createdb accounting_bot
   npm run db:push
   ```

2. ✅ **Start Development Server**
   ```bash
   npm run start:dev
   ```

3. ⏭️ **Test API Endpoints**
   ```bash
   curl http://localhost:3000/health
   ```

4. ⏭️ **Create additional modules**
   ```bash
   nest g resource modules/users
   ```

5. ⏭️ **Implement business logic**
   - Module A: Phiếu Chi generation
   - Module C: % Tham gia calculation

## 📞 Support

For issues or questions, check:
- Logs in console
- Prisma Studio: `npm run prisma:studio`
- NestJS debugging: `npm run start:debug`

---

**Status:** 🚀 Ready for development
**Architecture:** NestJS + Prisma + PostgreSQL
**Next:** Run `npm run start:dev` to begin!
