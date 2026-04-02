import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { GLFileProcessorService } from './gl-file-processor.service';
import { LLMGatewayService } from '../llm-gateway/llm-gateway.service';

interface CashflowRow {
  row: number;
  label: string;
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
    let dataset = this.loadQaDatasetByPeriod(period);

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
      .map((r) => `${r.label}: ${r.values.join(', ')}`)
      .join('\n');

    const systemPrompt = `Bạn là trợ lý kế toán chuyên Q&A báo cáo cashflow.
- Chỉ dựa vào dữ liệu cung cấp.
- Nếu không đủ dữ liệu để kết luận, nói rõ "không đủ dữ liệu".
- Trả lời ngắn gọn, tiếng Việt, tối đa 8 dòng.
- Ưu tiên nêu số liệu chính xác và gợi ý bước kiểm tra tiếp theo.`;

    const prompt = `Kỳ báo cáo: ${dataset.period}
File báo cáo: ${dataset.reportFilePath}

Dữ liệu cashflow đã trích xuất:
${rowsForPrompt}

Câu hỏi: ${question}`;

    try {
      const answer = await this.llm.generateResponse(prompt, systemPrompt);
      if (/service temporarily unavailable|try again later/i.test(answer)) {
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
        rows.push({ row: rowNum, label, values });
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

  private buildRuleBasedCashflowAnswer(
    dataset: CashflowQaDataset,
    question: string,
    includeNotice = false,
  ): string {
    const incomeKeywords = [
      'thu dự án',
      'thu dau tu tai chinh',
      'thu đầu tư tài chính',
      'thu dau tu r&d',
      'thu đầu tư r&d',
      'thu khác',
      'thu khac',
    ];
    const expenseKeywords = [
      'lương dự án',
      'luong du an',
      'quản lý văn phòng',
      'quan ly van phong',
      'chi phí đảm bảo chất lượng',
      'chi phi dam bao chat luong',
      'hành chính',
      'hanh chinh',
      'kế toán/tài chính',
      'ke toan/tai chinh',
      'sales',
      'marketing',
      'hạ tầng it',
      'ha tang it',
    ];

    const normalize = (v: string) =>
      v
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    const pickValue = (values: number[]) => {
      const nz = values.find((v) => Math.abs(v) > 0.0001);
      if (nz !== undefined) return nz;
      return values.length > 0 ? values[0] : 0;
    };

    let totalIncome = 0;
    let totalExpense = 0;

    for (const row of dataset.rows) {
      const label = normalize(row.label);
      const value = pickValue(row.values);

      if (incomeKeywords.some((k) => label.includes(normalize(k)))) {
        totalIncome += value;
        continue;
      }

      if (expenseKeywords.some((k) => label.includes(normalize(k)))) {
        totalExpense += value;
      }
    }

    const net = totalIncome - totalExpense;
    const q = normalize(question);
    const askOnlyIncome = q.includes('tong thu') && !q.includes('chi');
    const askOnlyExpense = q.includes('tong chi') && !q.includes('thu');

    const formatVnd = (v: number) =>
      `${Math.round(v).toLocaleString('vi-VN')} VND`;

    const header = includeNotice
      ? `Q&A Cashflow ${dataset.period}\n(Hệ thống tạm dùng fallback vì LLM đang gián đoạn)\n`
      : `Q&A Cashflow ${dataset.period}\n`;

    if (askOnlyIncome) {
      return `${header}Tổng thu kỳ ${dataset.period}: ${formatVnd(totalIncome)}.`;
    }

    if (askOnlyExpense) {
      return `${header}Tổng chi kỳ ${dataset.period}: ${formatVnd(totalExpense)}.`;
    }

    return (
      `${header}` +
      `• Tổng thu: ${formatVnd(totalIncome)}\n` +
      `• Tổng chi: ${formatVnd(totalExpense)}\n` +
      `• Dòng tiền ròng: ${formatVnd(net)}\n` +
      `Gợi ý: Nếu cần chi tiết theo hạng mục, hỏi thêm "chi tiết từng nhóm thu/chi kỳ ${dataset.period}".`
    );
  }
}
