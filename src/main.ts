import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Swagger setup
  const config = new DocumentBuilder()
    .setTitle('Accounting & Workload AI Bot API')
    .setDescription(
      'AI Agent tích hợp ERP — phân tích workload nhân sự, cảnh báo self-learning, báo cáo Excel.\n\n' +
      '**Workload API:** `/workload/*`\n' +
      '**Reports API:** `/api/reports/*`\n' +
      '**Sync API:** `/api/sync/*`',
    )
    .setVersion('2.0')
    .addBearerAuth()
    .addTag('workload', 'Workload AI — phân tích & cảnh báo nhân sự')
    .addTag('reports', 'Báo cáo tham gia dự án')
    .addTag('sync', 'Đồng bộ dữ liệu từ ERP')
    .addTag('vouchers', 'Phiếu chi')
    .addTag('approvals', 'Phê duyệt')
    .addTag('health', 'Health check')
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📚 Swagger docs: http://localhost:${port}/api`);
}
bootstrap();
