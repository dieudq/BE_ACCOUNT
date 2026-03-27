# Accounting Bot Backend - NestJS

Tự động hóa phiếu chi, báo cáo tài chính, và % tham gia dự án using NestJS + TypeORM + PostgreSQL.

## 🚀 Tech Stack

- **NestJS** - Progressive Node.js framework
- **TypeORM** - ORM for TypeScript
- **PostgreSQL** - Database
- **Telegram Bot** - Notifications
- **ExcelJS** - Report generation

## 📋 Quick Start

### Prerequisites

```bash
- Node.js 18+
- PostgreSQL 14+
- npm
```

### Installation

```bash
# Install dependencies
npm install

# Create .env file (already created)
# Update database credentials in .env
```

### Database Setup

```bash
# Create PostgreSQL database
createdb accounting_bot
```

### Running

```bash
# Development
npm run start:dev

# Production
npm run start

# Debug
npm run start:debug
```

Server runs on `http://localhost:3000`

## 📊 API Endpoints

### Health Check
```bash
GET /health              # Server health
GET /                    # App info
```

### Vouchers (Phiếu Chi)
```bash
GET    /api/vouchers           # List all
GET    /api/vouchers/:id       # Get by ID
POST   /api/vouchers           # Create new
PATCH  /api/vouchers/:id       # Update
DELETE /api/vouchers/:id       # Delete
```

### Webhooks
```bash
POST /webhooks/erp             # ERP webhook receiver
```

## 📁 Project Structure

```
src/
├── main.ts                 # Entry point
├── app.module.ts          # Root module
├── app.controller.ts      # Health check
├── config/
│   └── database.config.ts # TypeORM config
├── entities/              # Database entities
│   ├── user.entity.ts
│   ├── project.entity.ts
│   ├── voucher.entity.ts
│   ├── employee-hours.entity.ts
│   └── bot-log.entity.ts
├── modules/
│   └── vouchers/          # Voucher CRUD
│       ├── vouchers.module.ts
│       ├── vouchers.service.ts
│       ├── vouchers.controller.ts
│       └── dto/
├── webhooks/              # ERP webhooks
│   ├── webhooks.module.ts
│   └── webhooks.controller.ts
└── database/
    └── migrations/        # SQL migrations (future)
```

## 🔧 Environment Variables

```env
# Server
NODE_ENV=development
PORT=3000

# Database
DB_TYPE=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=accounting_bot
DB_USER=postgres
DB_PASSWORD=postgres

# ERP
ERP_API_URL=http://localhost:8080/api
ERP_API_KEY=demo-key-123

# Jira
JIRA_URL=https://jira.company.com
JIRA_USERNAME=bot_user
JIRA_API_TOKEN=demo-token-123

# Telegram
TELEGRAM_BOT_TOKEN=xxxxx
TELEGRAM_GROUP_ID=-xxxxx
```

## 🧪 Testing

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

# ERP webhook
curl -X POST http://localhost:3000/webhooks/erp \
  -H "Content-Type: application/json" \
  -d '{
    "voucherNumber": "TAU-002",
    "amount": 5000000,
    "status": "approved"
  }'
```

### Using Postman

Import the endpoints:
1. `GET http://localhost:3000/health`
2. `GET http://localhost:3000/api/vouchers`
3. `POST http://localhost:3000/api/vouchers`
4. `POST http://localhost:3000/webhooks/erp`

## 📝 Database Entities

Automatically created by TypeORM:

- **Users** - Employees
- **Projects** - Projects
- **Vouchers** - Phiếu chi/Tạm ứng
- **EmployeeHours** - Work hours tracking
- **BotLogs** - Audit logs

## 🔄 NestJS CLI Commands

```bash
# Generate new module
nest g module modules/users

# Generate new service
nest g service modules/users

# Generate new controller
nest g controller modules/users

# Generate resource (full CRUD)
nest g resource modules/users
```

## 📈 Project Phases

### Phase 1: Foundation ✅
- [x] NestJS project setup
- [x] Database config (TypeORM)
- [x] Entities created
- [x] Vouchers CRUD module
- [x] ERP webhook receiver

### Phase 2: Module A (Phiếu Chi)
- [ ] Auto-generate from approval
- [ ] Email notifications
- [ ] Telegram notifications
- [ ] PDF export

### Phase 3: Module C (% Tham Gia)
- [ ] Jira integration
- [ ] Logworks integration
- [ ] Hours sync
- [ ] Self-learning calculation
- [ ] Report generation

### Phase 4: Testing & Deploy
- [ ] Unit tests
- [ ] E2E tests
- [ ] Docker setup
- [ ] Production deployment

## 🐛 Common Issues

**Database connection error:**
```bash
# Check PostgreSQL running
# Verify .env credentials
# Ensure database exists: createdb accounting_bot
```

**Port already in use:**
```bash
# Change PORT in .env
# Or kill process: lsof -ti:3000 | xargs kill -9
```

**TypeORM sync errors:**
```bash
# Drop schema and resync
# Set synchronize: false in production
# Use migrations instead
```

## 📚 Resources

- [NestJS Docs](https://docs.nestjs.com)
- [TypeORM Docs](https://typeorm.io)
- [NestJS + TypeORM Guide](https://docs.nestjs.com/techniques/database)

## 🎯 Next Steps

1. ✅ Setup PostgreSQL + start server
2. ⏭️ Create Users & Projects modules
3. ⏭️ Implement Module A (Phiếu Chi generation)
4. ⏭️ Add Telegram/Email notifications
5. ⏭️ Implement Module C (% tham gia)

---

**Status:** 🚀 Ready for development
**Architecture:** NestJS + TypeORM + PostgreSQL
**Deployment:** Docker ready
