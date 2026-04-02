import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { GLFileProcessorService } from './gl-file-processor.service';
import { LLMGatewayService } from '../llm-gateway/llm-gateway.service';

type CashflowCategory = 'income' | 'expense' | 'total' | 'other';

interface CashflowRow {
  row: number;
  label: string;
  category?: CashflowCategory;
  primaryValue?: number;
  values: number[];
}

interface CashflowQaDataset {
  period: string;
  sourceFilePath: string;
  reportFilePath: string;
  generatedAt: string;
  rows: CashflowRow[];
}

interface CashflowRegistryItem {
  period: string;
  sourceFilePath: string;
  reportFilePath: string;
  qaDatasetPath: string;
  generatedAt: string;
}

interface CashflowRegistry {
  latest?: CashflowRegistryItem;
  items: CashflowRegistryItem[];
}

@Injectable()
export class CashflowAgentService {
  private readonly logger = new Logger(CashflowAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly glFileProcessor: GLFileProcessorService,
    private readonly llm: LLMGatewayService,
  ) {}

  async generateAutoReport(preferredSourceFilePath?: string): Promise<{
    sourceFilePath: string;
    outputFilePath: string;
    qaDatasetPath: string;
    period: string;
  }> {
    const sourceFilePath = this.resolveSourceFilePath(preferredSourceFilePath);
    if (!sourceFilePath) {
      throw new Error(
        'Không tìm thấy file nguồn So_chi_tiet_cac_tai_khoan.xlsx trong thư mục gốc hoặc uploads/.',
      );
    }

    const coaPath = path.join(process.cwd(), 'templates', 'Danh_sach_he_thong_tai_khoan.xlsx');
    if (!fs.existsSync(coaPath)) {
      throw new Error(`Thiếu file COA: ${coaPath}`);
    }

    const outputFilePath = await this.glFileProcessor.processGLFileAndGenerateCashflow(
      sourceFilePath,
      coaPath,
    );

    const period = this.extractPeriodFromCashflowFile(outputFilePath);
    const dataset = await this.buildQaDataset(sourceFilePath, outputFilePath, period);
    const qaDatasetPath = this.saveQaDataset(dataset);
    await this.saveDatasetToDB(dataset);

    this.saveRegistry({
      period,
      sourceFilePath,
      reportFilePath: outputFilePath,
      qaDatasetPath,
      generatedAt: new Date().toISOString(),
    });

    await this.prisma.botLog.create({
      data: {
        action: 'CASHFLOW_AUTO_GENERATED',
        status: 'success',
        details: {
          period,
          sourceFilePath,
          outputFilePath,
          qaDatasetPath,
        },
      },
    });

    return { sourceFilePath, outputFilePath, qaDatasetPath, period };
  }

  async answerQuestion(question: string, year?: number, month?: number): Promise<string> {
    const period = this.resolvePeriod(year, month);

    // Ưu tiên load từ DB (nhanh, không cần đọc file)
    let dataset = await this.loadDatasetFromDB(period);

    // Nếu DB chưa có → thử JSON file
    if (!dataset) {
      dataset = this.loadQaDatasetByPeriod(period);
    }

    // Nếu vẫn không có → thử build từ Excel export file
    if (!dataset) {
      const reportFilePath = this.findCashflowExportFile(period);
      if (!reportFilePath) {
        return (
          `Chưa có dữ liệu cashflow cho kỳ ${period}.\n` +
          'Nhắn: "Tạo báo cáo cashflow tự động" để hệ thống xử lý file nguồn trước.'
        );
      }

      const sourceFallback = this.resolveSourceFilePath() || 'unknown';
      dataset = await this.buildQaDataset(sourceFallback, reportFilePath, period);
      const qaDatasetPath = this.saveQaDataset(dataset);
      await this.saveDatasetToDB(dataset);
      this.saveRegistry({
        period,
        sourceFilePath: sourceFallback,
        reportFilePath,
        qaDatasetPath,
        generatedAt: new Date().toISOString(),
      });
    }

    const rowsForPrompt = dataset.rows
      .filter((r) => r.values.length > 0)
      .slice(0, 180)
      .map((r) => `${r.label} [${r.category ?? 'other'}]: ${r.values.join(', ')}`)
      .join('\n');

    const systemPrompt = `Bạn là trợ lý kế toán chuyên Q&A báo cáo cashflow.
- Chỉ dựa vào dữ liệu cung cấp.
- Nếu không đủ dữ liệu để kết luận, nói rõ "không đủ dữ liệu".
- Trả lời tiếng Việt, ngắn gọn, emoji phù hợp, tối đa 12 dòng.
- Ưu tiên nêu số liệu chính xác kèm bình luận ngắn.`;

    const prompt = `Kỳ báo cáo: ${dataset.period}

Dữ liệu cashflow (label [category]: values):
${rowsForPrompt}

Câu hỏi: ${question}`;

    // Các câu hỏi có thể trả lời trực tiếp từ dataset thì ưu tiên deterministic,
    // không phụ thuộc LLM để tránh fail khi toàn bộ key đang bị limit.
    const normalizedQuestion = this.normalizeVi(question);
    if (this.shouldUseDeterministicAnswer(normalizedQuestion)) {
      return this.buildRuleBasedCashflowAnswer(dataset, question, false);
    }

    try {
      const answer = await this.llm.generateResponse(prompt, systemPrompt);
      if (this.isUnavailableLikeText(answer) || !answer?.trim()) {
        return this.buildRuleBasedCashflowAnswer(dataset, question, true);
      }
      return `Q&A Cashflow ${dataset.period}\n${answer}`;
    } catch {
      return this.buildRuleBasedCashflowAnswer(dataset, question, true);
    }
  }

  private resolveSourceFilePath(preferredPath?: string): string | null {
    const candidates: string[] = [];

    if (preferredPath) {
      candidates.push(
        path.isAbsolute(preferredPath) ? preferredPath : path.join(process.cwd(), preferredPath),
      );
    }

    candidates.push(path.join(process.cwd(), 'So_chi_tiet_cac_tai_khoan.xlsx'));
    candidates.push(path.join(process.cwd(), 'So_chi_tiet_cac_tai_khoan (1).xlsx'));

    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (fs.existsSync(uploadsDir)) {
      const uploadCandidates = fs
        .readdirSync(uploadsDir)
        .filter((name) => /So_chi_tiet_cac_tai_khoan.*\.xlsx$/i.test(name))
        .map((name) => path.join(uploadsDir, name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

      candidates.push(...uploadCandidates);
    }

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }

    return null;
  }

  private extractPeriodFromCashflowFile(filePath: string): string {
    const file = path.basename(filePath);
    const m = file.match(/cashflow_(\d{4})-(\d{2})\.xlsx/i);
    if (m) return `${m[1]}-${m[2]}`;

    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private async buildQaDataset(
    sourceFilePath: string,
    reportFilePath: string,
    period: string,
  ): Promise<CashflowQaDataset> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(reportFilePath);
    const sheet = workbook.getWorksheet('Cashflow_Misa') || workbook.worksheets[0];

    if (!sheet) {
      throw new Error('Không tìm thấy worksheet trong file cashflow.');
    }

    const rows: CashflowRow[] = [];
    const maxRow = Math.min(sheet.rowCount, 300);

    for (let rowNum = 1; rowNum <= maxRow; rowNum++) {
      const row = sheet.getRow(rowNum);
      const labelRaw = row.getCell(2).value ?? row.getCell(1).value;
      const label = this.normalizeCell(labelRaw);
      if (!label) continue;

      const values: number[] = [];
      for (let col = 3; col <= 30; col++) {
        const normalized = this.toNumber(row.getCell(col).value);
        if (normalized !== null) values.push(normalized);
      }

      if (values.length > 0) {
        const primaryValue = values.find((v) => Math.abs(v) > 0.0001) ?? values[0] ?? 0;
        rows.push({
          row: rowNum,
          label,
          category: this.categorizeRow(label),
          primaryValue,
          values,
        });
      }
    }

    return {
      period,
      sourceFilePath,
      reportFilePath,
      generatedAt: new Date().toISOString(),
      rows,
    };
  }

  /** Phân loại dòng cashflow dựa vào label */
  private categorizeRow(label: string): CashflowCategory {
    const norm = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const incomeKeys = [
      'thu du an', 'thu dau tu', 'thu khac', 'doanh thu', 'thu phi', 'thu tu', 'thu ngan hang',
    ];
    const expenseKeys = [
      'luong', 'chi phi', 'quan ly', 'van phong', 'hanh chinh', 'sales', 'marketing',
      'ha tang', 'ke toan', 'tai chinh', 'dao tao', 'dam bao chat luong', 'bao hiem',
    ];
    const totalKeys = ['tong thu', 'tong chi', 'dong tien rong', 'net', 'tong cong'];

    if (totalKeys.some((k) => norm.includes(k))) return 'total';
    if (incomeKeys.some((k) => norm.includes(k))) return 'income';
    if (expenseKeys.some((k) => norm.includes(k))) return 'expense';
    return 'other';
  }

  private normalizeCell(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    if (typeof value === 'object' && value !== null) {
      if ('result' in value && value.result !== null && value.result !== undefined) {
        return String(value.result).trim();
      }
      if ('richText' in value && Array.isArray(value.richText)) {
        return value.richText.map((r: any) => r.text || '').join('').trim();
      }
      if ('text' in value) return String(value.text || '').trim();
    }
    return '';
  }

  private toNumber(value: any): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value !== null && 'result' in value) {
      return this.toNumber(value.result);
    }
    if (typeof value === 'string') {
      const cleaned = value.replace(/[,\s]/g, '');
      if (!cleaned) return null;
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  private qaDatasetDir(): string {
    return path.join(process.cwd(), 'tmp_reports');
  }

  private qaDatasetFile(period: string): string {
    return path.join(this.qaDatasetDir(), `cashflow-qa-${period}.json`);
  }

  private registryFile(): string {
    return path.join(this.qaDatasetDir(), 'cashflow-qa-registry.json');
  }

  private saveQaDataset(dataset: CashflowQaDataset): string {
    const dir = this.qaDatasetDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = this.qaDatasetFile(dataset.period);
    fs.writeFileSync(filePath, JSON.stringify(dataset, null, 2), 'utf8');
    return filePath;
  }

  private loadQaDatasetByPeriod(period: string): CashflowQaDataset | null {
    const filePath = this.qaDatasetFile(period);
    if (!fs.existsSync(filePath)) return null;

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as CashflowQaDataset;
    } catch (error: any) {
      this.logger.warn(`Không đọc được QA dataset ${filePath}: ${error.message}`);
      return null;
    }
  }

  /** Lưu toàn bộ dataset vào DB để fallback query nhanh */
  private async saveDatasetToDB(dataset: CashflowQaDataset): Promise<void> {
    try {
      for (const row of dataset.rows) {
        await (this.prisma as any).cashflowEntry.upsert({
          where: { period_rowNum: { period: dataset.period, rowNum: row.row } },
          update: {
            label: row.label,
            category: row.category ?? 'other',
            primaryValue: row.primaryValue ?? 0,
            allValues: row.values,
          },
          create: {
            period: dataset.period,
            rowNum: row.row,
            label: row.label,
            category: row.category ?? 'other',
            primaryValue: row.primaryValue ?? 0,
            allValues: row.values,
          },
        });
      }
      this.logger.log(`[Cashflow] Saved ${dataset.rows.length} entries to DB for ${dataset.period}`);
    } catch (err: any) {
      // DB có thể chưa có bảng (chưa migrate) — bỏ qua lỗi, không ảnh hưởng flow chính
      this.logger.warn(`[Cashflow] saveDatasetToDB skipped: ${err.message}`);
    }
  }

  /** Load dataset từ DB theo kỳ, trả null nếu chưa có */
  private async loadDatasetFromDB(period: string): Promise<CashflowQaDataset | null> {
    try {
      const entries = await (this.prisma as any).cashflowEntry.findMany({
        where: { period },
        orderBy: { rowNum: 'asc' },
      });
      if (!entries || entries.length === 0) return null;

      const rows: CashflowRow[] = entries.map((e: any) => ({
        row: e.rowNum,
        label: e.label,
        category: e.category as CashflowCategory,
        primaryValue: e.primaryValue,
        values: Array.isArray(e.allValues) ? e.allValues : [],
      }));

      return {
        period,
        sourceFilePath: '',
        reportFilePath: '',
        generatedAt: entries[0].createdAt?.toISOString() ?? new Date().toISOString(),
        rows,
      };
    } catch (err: any) {
      this.logger.warn(`[Cashflow] loadDatasetFromDB skipped: ${err.message}`);
      return null;
    }
  }

  private resolvePeriod(year?: number, month?: number): string {
    if (year && month) {
      return `${year}-${String(month).padStart(2, '0')}`;
    }

    const registry = this.loadRegistry();
    if (registry.latest?.period) return registry.latest.period;

    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private findCashflowExportFile(period: string): string | null {
    const exact = path.join(process.cwd(), 'exports', `cashflow_${period}.xlsx`);
    if (fs.existsSync(exact)) return exact;

    const exportsDir = path.join(process.cwd(), 'exports');
    if (!fs.existsSync(exportsDir)) return null;

    const matched = fs
      .readdirSync(exportsDir)
      .filter((name) => new RegExp(`^cashflow_${period}.*\\.xlsx$`, 'i').test(name))
      .map((name) => path.join(exportsDir, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    return matched[0] || null;
  }

  private loadRegistry(): CashflowRegistry {
    const filePath = this.registryFile();
    if (!fs.existsSync(filePath)) return { items: [] };

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as CashflowRegistry;
    } catch {
      return { items: [] };
    }
  }

  private saveRegistry(item: CashflowRegistryItem) {
    const dir = this.qaDatasetDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const registry = this.loadRegistry();
    const deduped = registry.items.filter((x) => x.period !== item.period);
    const next: CashflowRegistry = {
      latest: item,
      items: [item, ...deduped].slice(0, 24),
    };

    fs.writeFileSync(this.registryFile(), JSON.stringify(next, null, 2), 'utf8');
  }

  private normalizeVi(s: string): string {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private shouldUseDeterministicAnswer(normalizedQuestion: string): boolean {
    // Các intent phổ biến có thể trả lời chính xác bằng rule-based từ dữ liệu đã có.
    return /tong thu|tong chi|dong tien|dong tien rong|chi tiet|breakdown|co cau|lai lo|tham hut|chenh lech/.test(
      normalizedQuestion,
    );
  }

  private isUnavailableLikeText(text: string): boolean {
    const normalized = this.normalizeVi(text);
    if (!normalized) return true;

    return (
      normalized.includes('tam thoi khong kha dung') ||
      normalized.includes('all llm providers failed') ||
      normalized.includes('all llm providers unavailable') ||
      normalized.includes('rate limit') ||
      normalized.includes('quota') ||
      normalized.includes('provider unavailable')
    );
  }

  private buildRuleBasedCashflowAnswer(
    dataset: CashflowQaDataset,
    question: string,
    includeNotice = false,
  ): string {
    const formatVnd = (v: number) => `${Math.round(v).toLocaleString('vi-VN')} VND`;
    const norm = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    const header = includeNotice
      ? `Q&A Cashflow ${dataset.period}\n(Hệ thống tạm dùng fallback vì LLM đang gián đoạn)\n`
      : `Q&A Cashflow ${dataset.period}\n`;

    // Phân loại rows — dùng category đã lưu hoặc fallback sang keyword matching
    const categorize = (row: CashflowRow): CashflowCategory => {
      if (row.category && row.category !== 'other') return row.category;
      return this.categorizeRow(row.label);
    };

    const incomeRows = dataset.rows.filter((r) => categorize(r) === 'income');
    const expenseRows = dataset.rows.filter((r) => categorize(r) === 'expense');
    const getPrimary = (r: CashflowRow) =>
      r.primaryValue ?? r.values.find((v) => Math.abs(v) > 0.0001) ?? r.values[0] ?? 0;

    const totalIncome = incomeRows.reduce((s, r) => s + getPrimary(r), 0);
    const totalExpense = expenseRows.reduce((s, r) => s + getPrimary(r), 0);
    const net = totalIncome - totalExpense;

    const q = norm(question);
    const wantsDetail = /chi tiet|tung nhom|tung hang muc|phan loai|breakdown|co cau|chia theo/.test(q);
    const askOnlyIncome = q.includes('tong thu') && !q.includes('chi');
    const askOnlyExpense = q.includes('tong chi') && !q.includes('thu');

    // Chỉ hỏi tổng thu
    if (askOnlyIncome && !wantsDetail) {
      return `${header}📥 Tổng thu kỳ ${dataset.period}: **${formatVnd(totalIncome)}**`;
    }

    // Chỉ hỏi tổng chi
    if (askOnlyExpense && !wantsDetail) {
      return `${header}📤 Tổng chi kỳ ${dataset.period}: **${formatVnd(totalExpense)}**`;
    }

    // Hỏi chi tiết từng nhóm
    if (wantsDetail || (incomeRows.length > 0 && expenseRows.length > 0)) {
      let msg = header;

      if (incomeRows.length > 0) {
        msg += `\n📥 THU (${formatVnd(totalIncome)}):\n`;
        incomeRows.forEach((r) => {
          const v = getPrimary(r);
          if (Math.abs(v) > 0.0001) {
            msg += `  • ${r.label}: ${formatVnd(v)}\n`;
          }
        });
      }

      if (expenseRows.length > 0) {
        msg += `\n📤 CHI (${formatVnd(totalExpense)}):\n`;
        expenseRows.forEach((r) => {
          const v = getPrimary(r);
          if (Math.abs(v) > 0.0001) {
            msg += `  • ${r.label}: ${formatVnd(v)}\n`;
          }
        });
      }

      const netIcon = net >= 0 ? '🟢' : '🔴';
      msg += `\n${netIcon} Dòng tiền ròng: ${formatVnd(net)}`;
      if (net < 0) msg += ' — âm, cần kiểm tra!';
      return msg;
    }

    // Summary mặc định
    const netIcon = net >= 0 ? '🟢' : '🔴';
    return (
      `${header}` +
      `• 📥 Tổng thu: ${formatVnd(totalIncome)}\n` +
      `• 📤 Tổng chi: ${formatVnd(totalExpense)}\n` +
      `• ${netIcon} Dòng tiền ròng: ${formatVnd(net)}\n` +
      `Gợi ý: Hỏi "chi tiết từng nhóm thu/chi kỳ ${dataset.period}" để xem breakdown đầy đủ.`
    );
  }
}
