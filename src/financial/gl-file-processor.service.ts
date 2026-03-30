import { Injectable } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { GLFileParserService, ParsedGLData } from './gl-file-parser.service';
import { CashflowTemplateService } from './cashflow-template.service';

@Injectable()
export class GLFileProcessorService {
  constructor(
    private glParser: GLFileParserService,
    private cashflowTemplate: CashflowTemplateService,
  ) {}

  /**
   * Process GL file for ALL months:
   * 1. Parse GL
   * 2. Load template
   * 3. COPY entire template
   * 4. For each month in GL data:
   *    - Calculate GL totals for that month
   *    - Fill into corresponding month column
   * 5. Export
   */
  async processGLFileAndGenerateCashflow(filePath: string): Promise<string> {
    try {
      console.log('📖 Parsing GL file...');
      const glData = await this.glParser.parseGLFile(filePath);

      console.log(`✅ Parsed ${glData.accounts.size} accounts`);
      console.log(`   Period: ${glData.period}`);

      // Extract year from file period
      const [year] = glData.period.split('-').map(Number);

      // Load template
      console.log('📋 Loading template...');
      const template = await this.cashflowTemplate.loadTemplate();

      // Copy entire template structure
      console.log('🔄 Copying full template...');
      const copiedTemplate = await this.cashflowTemplate.copyTemplateStructure(
        template,
      );

      // Group GL records by month
      console.log('📅 Grouping GL by month...');
      const glByMonth = this.groupGLByMonth(glData.records);

      console.log(`   Found data for ${glByMonth.size} months:`);
      glByMonth.forEach((records, month) => {
        console.log(`     Month ${month}: ${records.length} transactions`);
      });

      // For each month, calculate totals and fill template
      const filledTemplate = await this.cashflowTemplate.fillGLDataForAllMonths(
        copiedTemplate,
        glByMonth,
      );

      // Export
      console.log('💾 Exporting to Excel...');
      const exportsDir = path.join(process.cwd(), 'exports');
      const outputPath = await this.cashflowTemplate.exportToExcel(
        filledTemplate,
        exportsDir,
        `cashflow_${year}_full_${Date.now()}.xlsx`,
      );

      console.log(`✅ Processing complete: ${outputPath}`);
      return outputPath;
    } catch (err) {
      console.error('❌ Error processing GL file:', err);
      throw err;
    }
  }

  /**
   * Group GL records by month from transaction date
   * Returns Map<month, records>
   */
  private groupGLByMonth(
    records: any[],
  ): Map<number, any[]> {
    const grouped = new Map<number, any[]>();

    records.forEach((record) => {
      // Extract month from transaction date
      const date = record.date instanceof Date ? record.date : new Date(record.date);
      const month = date.getMonth() + 1; // 0-11 → 1-12

      if (!grouped.has(month)) {
        grouped.set(month, []);
      }
      const monthRecords = grouped.get(month);
      if (monthRecords) {
        monthRecords.push(record);
      }
    });

    return grouped;
  }
}
