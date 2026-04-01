import { Injectable } from '@nestjs/common';
import Groq from 'groq-sdk';
import * as path from 'path';
import * as fs from 'fs';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GroqService {
  private groq: Groq;

  constructor(private prisma: PrismaService) {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }

  async chat(message: string, userId: string): Promise<string> {
    try {
      // 1. Phân tích Ý định (Intent Recognition) để lấy đúng ngữ cảnh
      const intent = await this.detectIntent(message);
      const context = await this.getDynamicContext(intent);

      // 2. Gọi Groq API với ngữ cảnh đã được lọc
      const completion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: `Bạn là Trợ lý Đa năng thông minh của công ty Twendee. 
            Nhiệm vụ của bạn là hiểu ý định người dùng và trả lời dựa trên dữ liệu hệ thống được cung cấp.

            NGỮ CẢNH DỮ LIỆU ĐƯỢC CUNG CẤP (${intent.toUpperCase()}):
            ${context}
            
            QUY TẮC TRẢ LỜI:
            1. TRÍCH DẪN NGUỒN: Khi trả lời, hãy nói rõ dữ liệu lấy từ đâu (Ví dụ: "Dựa trên Báo cáo Cash Flow Excel...", "Hệ thống ghi nhận trong Database...").
            2. TẬP TRUNG Ý ĐỊNH: Trả lời đúng trọng tâm câu hỏi. Nếu người dùng yêu cầu so sánh (ví dụ: tháng này so với tháng trước), hãy tính toán sự chênh lệch (tăng/giảm bao nhiêu %) và nhận xét xu hướng.
            3. TRÌNH BÀY: Dùng tiếng Việt, Markdown (Bảng, In đậm). Số tiền định dạng VNĐ (ví dụ: 1.000.000 VNĐ).
            4. TỰ TIN & ĐỘC LẬP: Trả lời trực tiếp vào vấn đề dựa trên số liệu. Bạn là một trợ lý chuyên nghiệp, không cần hỏi lại nhân viên nếu dữ liệu đã có sẵn. Nếu không thấy dữ liệu, hãy thông báo rõ.
            5. PHÂN TÍCH: Khi có dữ liệu nhiều tháng, hãy chủ động tóm tắt xu hướng (ví dụ: "Doanh thu đang có xu hướng tăng dần từ T1 đến T3").
            6. KIỂM TRA DỮ LIỆU: Lưu ý các tháng trong bảng (T1, T2...). T1 là Tháng 1, T2 là Tháng 2...`,
          },
          {
            role: 'user',
            content: message,
          },
        ],
        model: 'llama-3.3-70b-versatile',
      });

      return completion.choices[0]?.message?.content || 'Xin lỗi, tôi không thể xử lý yêu cầu này.';
    } catch (error) {
      console.error('Groq Error:', error);
      return `❌ Lỗi hệ thống phân tích: ${error.message}`;
    }
  }

  private async detectIntent(message: string): Promise<'cashflow' | 'vouchers' | 'projects' | 'general'> {
    const msg = message.toLowerCase();
    if (msg.includes('cashflow') || msg.includes('dòng tiền') || msg.includes('thu chi') || 
        msg.includes('lợi nhuận') || msg.includes('lương') || msg.includes('chi phí') || 
        msg.includes('doanh thu') || msg.includes('tiền') || msg.includes('so sánh')) {
      return 'cashflow';
    }
    if (msg.includes('phiếu') || msg.includes('duyệt') || msg.includes('voucher')) {
      return 'vouchers';
    }
    if (msg.includes('dự án') || msg.includes('project')) {
      return 'projects';
    }
    return 'general';
  }

  private async getDynamicContext(intent: string): Promise<string> {
    if (intent === 'cashflow') {
      return await this.getLatestCashflowSummary();
    }
    
    if (intent === 'vouchers') {
      const [pending, recent] = await Promise.all([
        this.prisma.voucher.count({ where: { status: 'pending' } }),
        this.prisma.voucher.findMany({
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: { project: true, user: true },
        })
      ]);
      
      const list = recent.map(v => 
        `- [${v.status}] Phiếu ${v.voucherNumber}: ${v.amount?.toNumber().toLocaleString()} VNĐ | Nội dung: ${v.reason} | Dự án: ${v.project?.name || 'N/A'}`
      ).join('\n');
      
      return `DỮ LIỆU PHIẾU CHI (DATABASE):\n- Số phiếu chờ duyệt: ${pending}\n- 10 phiếu chi gần nhất:\n${list}`;
    }

    if (intent === 'projects') {
      const projects = await this.prisma.project.findMany({
        where: { status: 'active' },
        include: { _count: { select: { vouchers: true } } }
      });
      
      const list = projects.map(p => 
        `- Dự án ${p.name} (${p.code}): Có ${p._count.vouchers} phiếu chi liên quan.`
      ).join('\n');
      
      return `DANH SÁCH DỰ ÁN HOẠT ĐỘNG:\n${list}`;
    }

    // General context
    const counts = await Promise.all([
      this.prisma.voucher.count(),
      this.prisma.project.count(),
      this.prisma.user.count()
    ]);
    return `TỔNG QUAN HỆ THỐNG:\n- Tổng phiếu chi: ${counts[0]}\n- Tổng dự án: ${counts[1]}\n- Tổng nhân sự: ${counts[2]}`;
  }

  private async getLatestCashflowSummary(): Promise<string> {
    try {
      const exportsDir = path.join(process.cwd(), 'exports');
      if (!fs.existsSync(exportsDir)) return 'Financial reports directory not found.';

      const files = fs.readdirSync(exportsDir)
        .filter(f => f.startsWith('cashflow_') && f.endsWith('.xlsx'))
        .sort((a, b) => b.localeCompare(a));

      if (files.length === 0) return 'No Cashflow reports found in the system.';

      const latestFile = path.join(exportsDir, files[0]);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(latestFile);
      const worksheet = workbook.getWorksheet('Cashflow_Misa');

      if (!worksheet) return 'Error: Cashflow_Misa sheet not found in report.';

      const getVal = (row: number, col: number) => {
        const cell = worksheet.getRow(row).getCell(col);
        if (cell.value && typeof cell.value === 'object' && 'result' in cell.value) {
          return typeof cell.value.result === 'number' ? cell.value.result : 0;
        }
        return typeof cell.value === 'number' ? cell.value : 0;
      };

      // Ánh xạ linh hoạt: Tìm hàng dựa trên nội dung cột B (index 2)
      const rowMapping: Record<string, number> = {};
      worksheet.eachRow((row, rowNumber) => {
        const cellValue = row.getCell(2).value;
        if (cellValue && typeof cellValue === 'string') {
          const key = cellValue.trim().toLowerCase();
          rowMapping[key] = rowNumber;
        }
      });

      const getRowByNames = (names: string[]): number | null => {
        for (const name of names) {
          if (rowMapping[name.toLowerCase()]) return rowMapping[name.toLowerCase()];
        }
        return null;
      };

      const rows = {
        revenue: getRowByNames(['Thu dự án', 'TOTAL REVENUE']),
        expense: getRowByNames(['CHI', 'TOTAL EXPENSE']),
        projectSalary: getRowByNames(['Lương dự án']),
        officeMgmt: getRowByNames(['Quản lý văn phòng']),
        qualityAssurance: getRowByNames(['Chi phí đảm bảo chất lượng']),
        adminSalary: getRowByNames(['Hành chính/ Nhân Sự', 'Lương Hành chính/Nhân sự']),
        accSalary: getRowByNames(['Kế toán/Tài Chính', 'Lương Kế toán/Tài Chính']),
        salesSalary: getRowByNames(['Sales', 'Lương Sales']),
        marketingSalary: getRowByNames(['Marketing', 'Lương Marketing']),
        itSalary: getRowByNames(['Hạ tầng IT', 'Lương Hạ tầng IT']),
        taxInsurance: getRowByNames(['Thuế & Bảo hiểm']),
        bonus: getRowByNames(['Thưởng (Bonus)']),
        netCashflow: getRowByNames(['LÃI/LỖ', 'Net Cashflow']),
        openingBalance: getRowByNames(['ĐẦU KỲ', 'Opening Balance']),
        closingBalance: getRowByNames(['CUỒI KỲ', 'Current Balance', 'Closing Balance']),
      };

      let summary = `REPORT FILE: ${files[0]}\n\n`;
      summary += `Dữ liệu được trích xuất từ các hạng mục chính trong báo cáo Cashflow.\n\n`;

      summary += `| Tháng | Thu dự án | Tổng chi | Lương dự án | Sales | QL VP | Hành chính | Marketing | IT | Lãi/Lỗ | Số dư cuối |\n`;
      summary += `|-------|-----------|----------|--------------|-------|-------|------------|-----------|----|---------|------------|\n`;

      const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      let hasAnyData = false;

      months.forEach(m => {
        const col = 5 + m * 2; // Cột G=7, I=9, ... (G là tháng 1, index 7 = 5 + 1*2)

        const totalRevenue = rows.revenue ? getVal(rows.revenue, col) : 0;
        const totalExpense = rows.expense ? getVal(rows.expense, col) : 0;
        const projectSalary = rows.projectSalary ? getVal(rows.projectSalary, col) : 0;
        const salesSalary = rows.salesSalary ? getVal(rows.salesSalary, col) : 0;
        const officeMgmt = rows.officeMgmt ? getVal(rows.officeMgmt, col) : 0;
        const adminSalary = rows.adminSalary ? getVal(rows.adminSalary, col) : 0;
        const marketingSalary = rows.marketingSalary ? getVal(rows.marketingSalary, col) : 0;
        const itSalary = rows.itSalary ? getVal(rows.itSalary, col) : 0;
        const netCashflow = rows.netCashflow ? getVal(rows.netCashflow, col) : 0;
        const closingBalance = rows.closingBalance ? getVal(rows.closingBalance, col) : 0;

        if (Math.abs(totalRevenue) > 0 || Math.abs(totalExpense) > 0 || Math.abs(netCashflow) > 0) {
          hasAnyData = true;
          summary += `| T${m} | ${totalRevenue.toLocaleString()} | ${totalExpense.toLocaleString()} | ${projectSalary.toLocaleString()} | ${salesSalary.toLocaleString()} | ${officeMgmt.toLocaleString()} | ${adminSalary.toLocaleString()} | ${marketingSalary.toLocaleString()} | ${itSalary.toLocaleString()} | ${netCashflow.toLocaleString()} | ${closingBalance.toLocaleString()} |\n`;
        }
      });

      return hasAnyData ? summary : 'Báo cáo tồn tại nhưng chưa có dữ liệu số cho bất kỳ tháng nào.';
    } catch (error) {
      return `Lỗi khi đọc dữ liệu tài chính: ${error.message}`;
    }
  }
}
