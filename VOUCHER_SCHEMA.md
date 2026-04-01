// Add to prisma/schema.prisma

model Voucher {
  id            String    @id @default(cuid())
  externalId    String    @unique // ID từ twendee-erp
  code          String    @unique // VD: PV-001
  type          String    // PAYMENT | RECEIPT
  amount        Float
  currency      String    // VND, USD, etc.
  content       String    // Nội dung phiếu chi
  createdBy     String    // Email người tạo
  creatorName   String?   // Tên đầy đủ người tạo
  assignedUsers String    // JSON stringify of assigned users
  status        String    @default("CREATED") // CREATED, APPROVED, REJECTED
  receivedAt    DateTime  @default(now()) // Khi nhận webhook
  approvedAt    DateTime?
  rejectedAt    DateTime?
  notes         String?

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([externalId])
  @@index([code])
  @@index([status])
}

// Migration command:
// npx prisma migrate dev --name add_voucher_table
