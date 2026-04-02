import { Injectable } from '@nestjs/common';
import Groq from 'groq-sdk';
import * as path from 'path';
import * as fs from 'fs';
import * as ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GroqService {
  private groq: Groq;
  private cachedCashflowData: any = null;

  constructor(private prisma: PrismaService) {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }

  /**
   * Escape markdown special characters for Telegram
   */
  private escapeMarkdown(text: string): string {
    return text
      .replace(/[_*\[\]()~`>#+=|{}.!-]/g, match => {
        // Escape these special characters for Markdown
        return `\\${match}`;
      });
  }

  /**
   * Escape HTML special characters for Telegram HTML mode
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Convert markdown-like text to plain text (safer for Telegram)
   */
  private toPlainText(text: string): string {
    return text
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold **text** -> text
      .replace(/\*([^*]+)\*/g, '$1') // Italic *text* -> text
      .replace(/`([^`]+)`/g, '$1') // Code `text` -> text
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Links [text](url) -> text
      .replace(/_+/g, '-'); // Underscores to dashes
  }

  /**
   * Remove VND/currency formatting from text
   */
  private removeCurrencyFormatting(text: string): string {
    return text
      .replace(/\s+VNĐ/g, '') // Remove " VNĐ"
      .replace(/\s+VND/g, '') // Remove " VND"
      .replace(/\s+đ(?=\s|$)/g, ''); // Remove standalone "đ"
  }

  /**
   * Fuzzy search - tìm dòng gần giống tên
   */
  private fuzzySearch(searchTerm: string, rowLabels: string[]): string | null {
    const search = searchTerm.toLowerCase();

    // 1. Exact match
    const exact = rowLabels.find(label => label.toLowerCase() === search);
    if (exact) return exact;

    // 2. Contains match
    const contains = rowLabels.find(label => label.toLowerCase().includes(search));
    if (contains) return contains;

    // 3. Similarity search - từng từ
    const searchWords = search.split(' ').filter(w => w.length > 2);
    const matches = rowLabels.map(label => {
      const labelWords = label.toLowerCase().split(' ');
      const matchCount = searchWords.filter(sw =>
        labelWords.some(lw => lw.includes(sw) || sw.includes(lw))
      ).length;
      return { label, matchCount };
    }).filter(m => m.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount);

    return matches.length > 0 ? matches[0].label : null;
  }

  /**
   * Lấy giá trị cột từ cached data
   */
  private getCashflowValue(rowLabel: string, columnName: string): any {
    if (!this.cachedCashflowData) return null;

    const { rowData, columnHeaders } = this.cachedCashflowData;

    // Tìm dòng gần đúng
    const searchedRow = this.fuzzySearch(rowLabel, Object.keys(rowData));
    if (!searchedRow) return null;

    const row = rowData[searchedRow];

    // Tìm cột gần đúng
    const colSearch = columnName.toLowerCase();
    const foundCol = Object.entries(columnHeaders).find(([_, name]) => {
      const colName = String(name).toLowerCase();
      return colName.includes(colSearch) || colSearch.includes(colName);
    });

    if (!foundCol) return null;
    const colIdx = parseInt(foundCol[0]);
    return { value: row[colIdx], rowLabel: searchedRow, colName: foundCol[1] };
  }

  async chat(message: string, userId?: string): Promise<string> {
    try {
      // 1. Phân tích Ý định (Intent Recognition) để lấy đúng ngữ cảnh
      const intent = await this.detectIntent(message);
      const employeeName = await this.extractEmployeeName(message);
      let context = await this.getDynamicContext(intent, userId, employeeName);

      // Escape context để tránh lỗi Markdown
      context = this.toPlainText(context);

      // Loại bỏ tất cả định dạng tiền tệ
      context = this.removeCurrencyFormatting(context);

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
            1. CHI TIẾT & CỤ THỂ: Nếu dữ liệu có sẵn, hãy trả lời chi tiết đến từng con số, tên người, mục chi tiết. Không tóm tắt quá mức.
            2. PHÂN TÍCH NHÂN VIÊN: Nếu hỏi về 1 người cụ thể, hãy liệt kê TOÀN BỘ thông tin: giờ làm, dự án, phép còn lại, mức độ rủi ro, lịch sử gần đây.
            3. TRÍCH DẪN NGUỒN: Nói rõ dữ liệu lấy từ DB hay file Excel.
            4. SO SÁNH & XU HƯỚNG: Nếu có nhiều tháng/người, hãy so sánh sự chênh lệch, tính % tăng/giảm, nhận xét xu hướng.
            5. TRÌNH BÀY: Dùng tiếng Việt, dùng dấu gạch ngang (-) để liệt kê. Số tiền VNĐ (ví dụ: 1.000.000 VND).
            6. TỰ TIN & ĐỘC LẬP: Trả lời trực tiếp dựa trên dữ liệu. Nếu không thấy dữ liệu, thông báo rõ.
            7. MỌI CHI TIẾT: Nếu người dùng hỏi "kể hết", hãy kể từng dòng, từng số liệu, không bỏ sót.`,
          },
          {
            role: 'user',
            content: message,
          },
        ],
        model: 'llama-3.3-70b-versatile',
      });

      let response = completion.choices[0]?.message?.content || 'Xin loi, toi khong the xu ly yeu cau nay.';

      // Convert to plain text để tránh lỗi Markdown
      response = this.toPlainText(response);

      // Loại bỏ tất cả định dạng tiền tệ (VND, VNĐ)
      response = this.removeCurrencyFormatting(response);

      return response;
    } catch (error) {
      console.error('Groq Error:', error);
      return `Loi he thong phan tich: ${error.message}`;
    }
  }

  private async extractEmployeeName(message: string): Promise<string | null> {
    // Tìm tên nhân viên trong message (hỏi về "nhân viên X", "ai", "tên", etc.)
    const patterns = [
      /(?:nhân viên|anh|chị|ông|bà|Mr|Ms|Mrs)\s+([A-Za-zÀ-ỿ\s]+?)(?:\s+(?:có|tháng|năm|như|nào|gì|là|được)|\?|$)/i,
      /(?:của|thuộc)\s+([A-Za-zÀ-ỿ\s]+?)(?:\s+(?:có|tháng|năm)|\?|$)/i,
      /([A-Za-zÀ-ỿ]+)\s+(?:bao nhiêu|như thế nào|cơ chế|làm gì|là ai|khác gì)/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return null;
  }

  private async detectIntent(message: string): Promise<'cashflow' | 'vouchers' | 'projects' | 'workload' | 'employees' | 'leaves' | 'hours' | 'financial' | 'chat_history' | 'system_overview' | 'ranking' | 'comparison' | 'general'> {
    const msg = message.toLowerCase();
    
    // 0. Intent: Ranking/Comparison (ai cao nhất, ai thấp nhất, top 3, v.v.)
    if (msg.includes('cao nhất') || msg.includes('thấp nhất') || msg.includes('lớn nhất') || msg.includes('nhỏ nhất') ||
        msg.includes('nhiều nhất') || msg.includes('ít nhất') || msg.includes('ai vượt') || msg.includes('top') ||
        msg.includes('xếp hạng') || msg.includes('ranking') || msg.includes('so sánh') && (msg.includes('nhân viên') || msg.includes('người'))) {
      return 'ranking';
    }

    // 1. Intent: Workload (Báo cáo self-learning)
    if (msg.includes('workload') || msg.includes('self-learning') || 
        msg.includes('ngưỡng 30h') || msg.includes('cảnh báo') || msg.includes('thời gian học')) {
      return 'workload';
    }

    // 2. Intent: Employees (Thông tin nhân sự) - ưu tiên trước leaves
    if ((msg.includes('nhân sự') || msg.includes('employee') || msg.includes('staff') ||
        msg.includes('nhân viên') || msg.includes('danh sách')) && !msg.includes('phép')) {
      return 'employees';
    }

    // 3. Intent: Hours (Giờ làm việc, tham gia dự án)
    if (msg.includes('giờ') || msg.includes('hour') || msg.includes('tham gia') || 
        msg.includes('participation') || msg.includes('logged')) {
      return 'hours';
    }

    // 4. Intent: Leaves (Nghỉ phép, phép năm) - cần rõ ràng
    if (msg.includes('nghỉ') || msg.includes('phép') || msg.includes('leave') ||
        msg.includes('quota') || msg.includes('absence') || msg.includes('phép còn')) {
      return 'leaves';
    }

    // 5. Intent: CASHFLOW (ưu tiên - từ khóa rõ ràng)
    // "cashflow", "dòng tiền", "thu chi", "chi tiêu", "lợi nhuận", "doanh thu"
    if (msg.includes('cashflow') || msg.includes('dòng tiền') || msg.includes('thu chi') ||
        msg.includes('chi tiêu') || msg.includes('lợi nhuận') || msg.includes('doanh thu') ||
        msg.includes('revenue') || (msg.includes('expense') && !msg.includes('voucher'))) {
      return 'cashflow';
    }

    // 6. Intent: Financial Reports (Báo cáo tài chính, sổ cái)
    if (msg.includes('báo cáo tài chính') || msg.includes('financial') || msg.includes('journal') || 
        msg.includes('ledger') || msg.includes('trial balance') || msg.includes('sổ cái') ||
        msg.includes('phiếu ghi sổ')) {
      return 'financial';
    }

    // 7. Intent: VOUCHERS (phiếu chi) - phải rõ ràng
    // "phiếu", "duyệt", "voucher", "phê duyệt", "phiếu chi"
    if (msg.includes('phiếu') || msg.includes('duyệt') || msg.includes('voucher') ||
        msg.includes('phê duyệt') || msg.includes('phiếu chi')) {
      return 'vouchers';
    }

    // 8. Intent: Projects
    if (msg.includes('dự án') || msg.includes('project')) {
      return 'projects';
    }

    // 9. Intent: Chat History
    if (msg.includes('lịch sử') || msg.includes('history') || msg.includes('chat')) {
      return 'chat_history';
    }

    // 10. Intent: System Overview
    if (msg.includes('tổng quan') || msg.includes('overview') || msg.includes('tổng') || msg.includes('thống kê')) {
      return 'system_overview';
    }

    return 'general';
  }

  private async getDynamicContext(intent: string, userId?: string, employeeName?: string | null): Promise<string> {
    // Nếu hỏi về nhân viên cụ thể, ưu tiên lấy context cá nhân
    if (employeeName && intent !== 'ranking') {
      return await this.getPersonalDetailContext(employeeName);
    }

    // ...existing code...
    if (intent === 'ranking') {
      return await this.getRankingContext();
    }

    if (intent === 'cashflow') {
      // Force load cashflow data
      await this.getLatestCashflowSummary();
      return this.cachedCashflowData?.summary || 'Không có dữ liệu Cashflow';
    }
    
    if (intent === 'vouchers') {
      return await this.getVouchersContext();
    }

    if (intent === 'projects') {
      return await this.getProjectsContext();
    }

    if (intent === 'workload') {
      return await this.getWorkloadContext();
    }

    if (intent === 'employees') {
      return await this.getEmployeesContext();
    }

    if (intent === 'hours') {
      return await this.getEmployeeHoursContext();
    }

    if (intent === 'leaves') {
      return await this.getLeavesContext();
    }

    if (intent === 'financial') {
      return await this.getFinancialContext();
    }

    if (intent === 'chat_history') {
      return await this.getChatHistoryContext();
    }

    if (intent === 'system_overview') {
      return await this.getSystemOverviewContext();
    }

    // General context
    return await this.getSystemOverviewContext();
  }

  private async getRankingContext(): Promise<string> {
    try {
      const [topWorkload, topHours, topLeaves, bottomWorkload, atRiskLeaves] = await Promise.all([
        this.prisma.workloadReport.findMany({
          orderBy: { hours: 'desc' },
          take: 10,
        }),
        this.prisma.employeeHours.findMany({
          where: {
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
          },
          orderBy: { loggedHours: 'desc' },
          take: 10,
          include: { user: true },
        }),
        this.prisma.leaveQuota.findMany({
          where: { year: new Date().getFullYear() },
          orderBy: { usedDays: 'desc' },
          take: 10,
          include: { user: true },
        }),
        this.prisma.workloadReport.findMany({
          orderBy: { hours: 'asc' },
          take: 5,
        }),
        this.prisma.leaveQuota.findMany({
          where: { year: new Date().getFullYear() },
          orderBy: { 
            usedDays: 'desc' 
          },
          take: 5,
          include: { user: true },
        }),
      ]);

      let context = `\n${'='.repeat(70)}\n`;
      context += `BẢNG XẾP HẠNG & SO SÁNH NHÂN VIÊN\n`;
      context += `${'='.repeat(70)}\n\n`;

      // Top workload
      context += `🔴 TOP 10 WORKLOAD CAO NHẤT (Self-Learning Hours):\n`;
      topWorkload.forEach((w, i) => {
        context += `  ${i + 1}. ${w.employeeName}: ${w.hours.toFixed(1)}h ${w.isAlert ? '⚠️ VƯỢT NGƯỠNG' : ''}\n`;
      });
      context += '\n';

      // Top hours logged
      if (topHours.length > 0) {
        context += `⏰ TOP 10 GIỜ ĐÃ ĐẠT CAO NHẤT (Tháng này):\n`;
        topHours.forEach((h, i) => {
          context += `  ${i + 1}. ${h.user.name}: ${h.loggedHours}h đăng ký\n`;
        });
        context += '\n';
      }

      // Top leaves used
      if (topLeaves.length > 0) {
        context += `🏖️ TOP 10 PHÉP ĐÃ DÙNG NHIỀU NHẤT (Năm ${new Date().getFullYear()}):\n`;
        topLeaves.forEach((l, i) => {
          const remaining = Number(l.totalDays) - Number(l.usedDays);
          context += `  ${i + 1}. ${l.user.name}: ${l.usedDays}d/${l.totalDays}d (${remaining}d còn)\n`;
        });
        context += '\n';
      }

      // Bottom workload
      if (bottomWorkload.length > 0) {
        context += `✅ 5 NHÂN VIÊN CÓ WORKLOAD THẤP NHẤT:\n`;
        bottomWorkload.forEach((w, i) => {
          context += `  ${i + 1}. ${w.employeeName}: ${w.hours.toFixed(1)}h\n`;
        });
        context += '\n';
      }

      context += `${'='.repeat(70)}\n`;
      return context;
    } catch (error) {
      console.error('Error fetching ranking context:', error);
      return `Lỗi khi lấy dữ liệu xếp hạng: ${error.message}`;
    }
  }

  private async getPersonalDetailContext(employeeName: string): Promise<string> {
    try {
      // Tìm nhân viên theo tên (case-insensitive)
      const employee = await this.prisma.user.findFirst({
        where: {
          name: {
            contains: employeeName,
            mode: 'insensitive',
          },
        },
        include: {
          employeeHours: {
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            take: 12,
          },
          projectParticipations: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: { project: true },
          },
          vouchers: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: { project: true },
          },
          leaves: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
          leaveQuotas: {
            where: { year: new Date().getFullYear() },
          },
        },
      });

      if (!employee) {
        return `KHÔNG TÌM THẤY: Không có nhân viên nào tên chứa "${employeeName}" trong hệ thống.`;
      }

      let context = `\n${'='.repeat(60)}\n`;
      context += `THÔNG TIN CHI TIẾT NHÂN VIÊN: ${employee.name}\n`;
      context += `${'='.repeat(60)}\n\n`;

      // Thông tin cơ bản
      context += `📋 THÔNG TIN CƠ BẢN:\n`;
      context += `- Họ tên: ${employee.name}\n`;
      context += `- Email: ${employee.email || 'N/A'}\n`;
      context += `- Phòng ban: ${employee.department || 'N/A'}\n`;
      context += `- Chức vụ: ${employee.role}\n`;
      context += `- Ngày vào: ${employee.joinDate?.toLocaleDateString('vi-VN') || 'N/A'}\n\n`;

      // Giờ làm việc chi tiết
      if (employee.employeeHours.length > 0) {
        context += `⏰ GIỜ LÀM VIỆC (12 tháng gần nhất):\n`;
        employee.employeeHours.forEach((h) => {
          context += `  - T${h.month}/${h.year}: ${h.loggedHours}h đăng ký | ${h.stdHours}h chuẩn | ${h.selfLearningHours}h tự học\n`;
        });
        context += '\n';
      }

      // Dự án tham gia
      if (employee.projectParticipations.length > 0) {
        context += `🎯 DỰ ÁN THAM GIA:\n`;
        employee.projectParticipations.forEach((p) => {
          context += `  - ${p.project.name} (${p.project.code}): ${p.participationPercent}% | ${p.loggedHours}h | T${p.month}/${p.year}\n`;
        });
        context += '\n';
      }

      // Phiếu chi liên quan
      if (employee.vouchers.length > 0) {
        context += `💰 PHIẾU CHI LIÊN QUAN:\n`;
        employee.vouchers.forEach((v) => {
          context += `  - [${v.status}] ${v.voucherNumber}: ${v.amount?.toNumber().toLocaleString()} VNĐ | ${v.reason} | ${v.project?.name || 'N/A'}\n`;
        });
        context += '\n';
      }

      // Nghỉ phép
      if (employee.leaveQuotas.length > 0 || employee.leaves.length > 0) {
        context += `🏖️ THÔNG TIN NGHỈ PHÉP:\n`;
        employee.leaveQuotas.forEach((q) => {
          const remaining = Number(q.totalDays) - Number(q.usedDays);
          context += `  - ${q.leaveType}: ${q.totalDays}d total | ${q.usedDays}d dùng | ${remaining}d còn\n`;
        });
        if (employee.leaves.length > 0) {
          context += `\n  📅 Lịch sử đơn xin (10 gần nhất):\n`;
          employee.leaves.forEach((l) => {
            context += `    • ${l.leaveType} [${l.status}]: ${l.startDate.toLocaleDateString('vi-VN')} - ${l.endDate.toLocaleDateString('vi-VN')} (${l.numDays}d)\n`;
          });
        }
        context += '\n';
      }

      // Workload (nếu có)
      const workload = await this.prisma.workloadReport.findFirst({
        where: {
          employeeName: employee.name,
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });

      if (workload) {
        context += `📊 WORKLOAD (Tháng ${workload.month}/${workload.year}):\n`;
        context += `  - Self-learning hours: ${workload.hours}h\n`;
        context += `  - Mức độ cảnh báo: ${workload.isAlert ? '🔴 VƯỢT NGƯỠNG (>30h)' : '✅ Bình thường'}\n\n`;
      }

      context += `${'='.repeat(60)}\n`;
      return context;
    } catch (error) {
      console.error('Error fetching personal context:', error);
      return `Lỗi khi lấy thông tin chi tiết nhân viên: ${error.message}`;
    }
  }

  private async getVouchersContext(): Promise<string> {
    const [pending, recent, byStatus] = await Promise.all([
      this.prisma.voucher.count({ where: { status: 'pending' } }),
      this.prisma.voucher.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { project: true, user: true },
      }),
      this.prisma.voucher.groupBy({
        by: ['status'],
        _count: true,
      }),
    ]);

    const list = recent.map(v =>
      `- [${v.status}] Phiếu ${v.voucherNumber}: ${v.amount?.toNumber()} | ${v.reason} | ${v.project?.name || 'N/A'}`
    ).join('\n');

    const statusSummary = byStatus.map(s => `${s.status}: ${s._count}`).join(' | ');

    return `DỮ LIỆU PHIẾU CHI (DATABASE):\n- Tổng phiếu chờ duyệt: ${pending}\n- Phân loại: ${statusSummary}\n- 10 phiếu gần nhất:\n${list}`;
  }

  private async getProjectsContext(): Promise<string> {
    const projects = await this.prisma.project.findMany({
      where: { status: 'active' },
      include: {
        _count: { select: { vouchers: true, employeeHours: true } }
      }
    });

    const list = projects.map(p =>
      `- ${p.name} (${p.code}): ${p._count.vouchers} phiếu | ${p._count.employeeHours} bản ghi giờ`
    ).join('\n');

    return `DANH SÁCH DỰ ÁN HOẠT ĐỘNG (${projects.length} dự án):\n${list}`;
  }

  private async getWorkloadContext(): Promise<string> {
    try {
      const latestReport = await this.prisma.workloadReport.findFirst({
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });

      if (!latestReport) {
        return 'THÔNG TIN WORKLOAD: Chưa có dữ liệu báo cáo Workload được đồng bộ.';
      }

      const { year, month } = latestReport;
      const reports = await this.prisma.workloadReport.findMany({
        where: { year, month },
      });

      const totalEmployees = reports.length;
      const alerts = reports.filter((r) => r.isAlert);

      let ctx = `DỮ LIỆU WORKLOAD THÁNG ${month}/${year}:\n`;
      ctx += `- Tổng nhân sự: ${totalEmployees}\n`;
      ctx += `- Vượt ngưỡng (>30h): ${alerts.length}\n`;
      ctx += `- Trung bình giờ: ${(reports.reduce((a, r) => a + r.hours, 0) / totalEmployees).toFixed(1)}h\n\n`;

      if (alerts.length > 0) {
        ctx += `🔴 VƯỢT NGƯỠNG:\n`;
        alerts.forEach((a) => {
          ctx += `   + ${a.employeeName}: ${a.hours.toFixed(1)}h\n`;
        });
      }

      return ctx;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021') {
        return 'THÔNG TIN WORKLOAD: Bảng chưa được khởi tạo. Chạy `npx prisma db push` để tạo.';
      }
      throw error;
    }
  }

  private async getEmployeesContext(): Promise<string> {
    const employees = await this.prisma.user.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, department: true, role: true, joinDate: true },
    });

    const list = employees.map(e =>
      `- ${e.name} (${e.role}) | ${e.department || 'N/A'} | ${e.email || 'N/A'}`
    ).join('\n');

    const totalCount = await this.prisma.user.count();
    return `DANH SÁCH NHÂN SỰ (Tổng: ${totalCount}):\n${list}`;
  }

  private async getEmployeeHoursContext(): Promise<string> {
    const latestMonth = await this.prisma.employeeHours.findFirst({
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    if (!latestMonth) {
      return 'THÔNG TIN GIỜ LÀM VIỆC: Chưa có dữ liệu.';
    }

    const { year, month } = latestMonth;
    const hours = await this.prisma.employeeHours.findMany({
      where: { year, month },
      include: { user: true, project: true },
      take: 30,
    });

    const list = hours.map(h =>
      `- ${h.user.name} (${h.project?.name || 'N/A'}): ${h.loggedHours}h logged | ${h.stdHours}h std | ${h.selfLearningHours}h self-learn`
    ).join('\n');

    return `GIỜ LÀM VIỆC THÁNG ${month}/${year}:\n${list}`;
  }

  private async getLeavesContext(): Promise<string> {
    const [totalLeaves, pending, currentYear] = await Promise.all([
      this.prisma.leave.count(),
      this.prisma.leave.count({ where: { status: 'pending' } }),
      this.prisma.leaveQuota.findMany({
        where: { year: new Date().getFullYear() },
        include: { user: true },
        take: 20,
      }),
    ]);

    const quotaList = currentYear.map(q =>
      `- ${q.user.name}: ${q.totalDays}d total | ${q.usedDays}d used | ${q.leaveType}`
    ).join('\n');

    return `DỮ LIỆU NGHỈ PHÉP:\n- Tổng đơn: ${totalLeaves}\n- Chờ duyệt: ${pending}\n- Hạn mức năm ${new Date().getFullYear()}:\n${quotaList}`;
  }

  private async getFinancialContext(): Promise<string> {
    const [periods, latestEntry, glAccounts] = await Promise.all([
      this.prisma.financialPeriod.findMany({
        where: { status: 'open' },
        take: 10,
        orderBy: { startDate: 'desc' },
      }),
      this.prisma.journalEntry.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { debitAccount: true, creditAccount: true },
      }),
      this.prisma.gLAccount.count(),
    ]);

    const periodList = periods.map(p =>
      `- ${p.code}: ${p.status} (${p.startDate?.toLocaleDateString('vi-VN')} - ${p.endDate?.toLocaleDateString('vi-VN')})`
    ).join('\n');

    const entryList = latestEntry.map(je =>
      `- JE: Nợ ${je.debitAccount.accountCode} | Có ${je.creditAccount.accountCode} | ${je.debitAmount}`
    ).join('\n');

    return `THÔNG TIN TÀI CHÍNH:\n- Kỳ mở: ${periods.length}\n- Tổng TK GL: ${glAccounts}\n- Kỳ gần nhất:\n${periodList}\n- 10 phiếu ghi sổ gần nhất:\n${entryList}`;
  }

  private async getChatHistoryContext(): Promise<string> {
    const chats = await this.prisma.chatLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });

    const list = chats.map(c =>
      `- ${c.user.name}: "${c.message.substring(0, 50)}..." | ${c.createdAt.toLocaleString('vi-VN')}`
    ).join('\n');

    const totalChats = await this.prisma.chatLog.count();
    return `LỊCH SỬ CHAT (Tổng: ${totalChats}):\n${list}`;
  }

  private async getSystemOverviewContext(): Promise<string> {
    const [voucherCount, projectCount, userCount, leaveCount, chatCount, alerts] = await Promise.all([
      this.prisma.voucher.count(),
      this.prisma.project.count(),
      this.prisma.user.count(),
      this.prisma.leave.count(),
      this.prisma.chatLog.count(),
      this.prisma.alert.findMany({ take: 10 }),
    ]);

    const alertList = alerts.map(a =>
      `- ${a.alertType}: ${a.message}`
    ).join('\n');

    return `TỔNG QUAN HỆ THỐNG:\n` +
      `📊 Thống kê:\n` +
      `- Tổng phiếu chi: ${voucherCount}\n` +
      `- Tổng dự án: ${projectCount}\n` +
      `- Tổng nhân sự: ${userCount}\n` +
      `- Tổng đơn nghỉ: ${leaveCount}\n` +
      `- Tổng tin nhắn: ${chatCount}\n` +
      `- Cảnh báo gần đây: ${alerts.length}\n${alertList}`;
  }

  private async getLatestCashflowSummary(): Promise<string> {
    try {
      // Nếu dữ liệu đã cache, trả về cached
      if (this.cachedCashflowData) {
        return this.cachedCashflowData.summary;
      }

      const exportsDir = path.join(process.cwd(), 'exports');
      if (!fs.existsSync(exportsDir)) return 'Không tìm thấy thư mục báo cáo tài chính.';

      const files = fs.readdirSync(exportsDir)
        .filter(f => f.startsWith('cashflow_') && f.endsWith('.xlsx'))
        .sort((a, b) => b.localeCompare(a));

      if (files.length === 0) return 'Không có báo cáo Cashflow nào trong hệ thống.';

      const latestFile = path.join(exportsDir, files[0]);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(latestFile);

      let worksheet = workbook.getWorksheet('Cashflow_Misa') ||
                      workbook.getWorksheet('Cashflow') ||
                      workbook.getWorksheet('cashflow') ||
                      workbook.getWorksheet(1);

      if (!worksheet) return `Lỗi: Không tìm thấy sheet Cashflow trong file ${files[0]}`;

      // === PARSE TOÀN BỘ DỮ LIỆU ===
      const columnHeaders: Record<number, string> = {}; // col_index -> "Jan", "Feb", etc.
      const rowData: Record<string, Record<number, any>> = {}; // row_label -> {col_index -> value}
      const allRows: Array<{label: string, values: Record<number, any>}> = [];

      // Parse header row (row 2)
      const headerRow = worksheet.getRow(2);
      for (let col = 1; col <= 30; col++) {
        const cell = headerRow.getCell(col);
        const value = cell.value;
        if (value) {
          columnHeaders[col] = String(value).trim();
        }
      }

      // Parse dữ liệu rows
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber <= 2) return; // Skip header rows

        const rowLabel = String(row.getCell(1).value || `Row ${rowNumber}`).trim();
        const rowValues: Record<number, any> = {};

        for (let col = 1; col <= 30; col++) {
          let value = row.getCell(col).value;

          // Handle formula results
          if (value && typeof value === 'object' && 'result' in value) {
            value = value.result;
          }

          if (value !== null && value !== undefined) {
            rowValues[col] = value;
          }
        }

        if (Object.keys(rowValues).length > 0) {
          rowData[rowLabel] = rowValues;
          allRows.push({ label: rowLabel, values: rowValues });
        }
      });

      // === TẠO CONTEXT CHI TIẾT ===
      let summary = `📊 BÁOO CÁO CASHFLOW: ${files[0]}\n`;
      summary += `\n=== CẤU TRÚC CỘT ===\n`;
      summary += `Các cột có sẵn:\n`;
      Object.entries(columnHeaders).forEach(([colIdx, colName]) => {
        summary += `- Cột ${colIdx}: ${colName}\n`;
      });

      summary += `\n=== TOÀN BỘ DỮ LIỆU (${allRows.length} hàng) ===\n\n`;

      allRows.slice(0, 100).forEach((row) => {
        summary += `\n${row.label}:\n`;
        for (let col = 1; col <= 30; col++) {
          if (row.values[col]) {
            const colName = columnHeaders[col] || `Col${col}`;
            summary += `  - ${colName}: ${row.values[col]}\n`;
          }
        }
      });

      summary += `\n=== HƯỚNG DẪN TRỰ VẤN ===\n`;
      summary += `Bạn có thể hỏi về:\n`;
      summary += `- Lương nhân viên nội bộ tháng 1 / tháng 2 / ...\n`;
      summary += `- Chi phí quản lý van phong\n`;
      summary += `- Lương sales, marketing, IT\n`;
      summary += `- Bất kỳ dòng nào trong dữ liệu\n`;
      summary += `- Từng tháng cụ thể (Jan, Feb, March, ...)\n`;

      // Cache dữ liệu - TOÀN BỘ
      this.cachedCashflowData = {
        file: files[0],
        summary,
        columnHeaders,
        rowData,
        allRows,
        worksheet: { // Lưu reference để truy vấn sau
          get: (rowLabel: string, colName: string) => {
            const row = rowData[rowLabel];
            if (!row) return null;
            // Tìm col index từ colName
            const colIdx = Object.entries(columnHeaders).find(([_, name]) =>
              name.toLowerCase() === colName.toLowerCase()
            )?.[0];
            return colIdx ? row[parseInt(colIdx)] : null;
          }
        }
      };

      return summary;
    } catch (error) {
      console.error('Error reading Cashflow:', error);
      return `❌ Lỗi khi đọc dữ liệu Cashflow: ${error.message}`;
    }
  }
}
