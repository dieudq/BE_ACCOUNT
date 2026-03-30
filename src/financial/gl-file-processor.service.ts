import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { GLFileParserService } from './gl-file-parser.service';
import { CashflowTemplateService } from './cashflow-template.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';

@Injectable()
export class GLFileProcessorService {
  constructor(
    private glParser: GLFileParserService,
    private cashflowTemplate: CashflowTemplateService,
    private chartOfAccounts: ChartOfAccountsService,
  ) {}

  /**
   * Process GL file for ALL months:
   * 1. Parse GL
   * 2. Load Danh sách (Chart of Accounts)
   * 3. Build category mapping
   * 4. Load template
   * 5. For each month in GL data:
   *    - Calculate GL totals for that month
   *    - Map GL accounts to Cashflow categories using Danh sách
   *    - Fill into corresponding category rows
   * 6. Export
   * 
   * Debit (Phát sinh Nợ) = + (revenue/incoming)
   * Credit (Phát sinh Có) = - (expense/outgoing)
   */
  async processGLFileAndGenerateCashflow(
    glFilePath: string,
    coaFilePath: string,
  ): Promise<string> {
    try {
      console.log('📖 Parsing GL file...');
      const glData = await this.glParser.parseGLFile(glFilePath);

      console.log(`✅ Parsed ${glData.accounts.size} accounts`);
      console.log(`   Period: ${glData.period}`);

      // Extract year from file period
      const [year] = glData.period.split('-').map(Number);

      // Load Chart of Accounts (Danh sách)
      console.log('📋 Loading Chart of Accounts (Danh sách)...');
      const coa = await this.chartOfAccounts.loadChartOfAccounts(coaFilePath);

      // Build category row mapping
      console.log('🗺️  Building category → row mapping...');
      const templatePath = path.join(process.cwd(), 'templates/2026_TWD_s_Cashflows_Report.xlsx');
      const categoryRowMapping = await this.chartOfAccounts.buildCategoryRowMapping(
        templatePath,
      );

      // Load template
      console.log('📋 Loading template...');
      const template = await this.cashflowTemplate.loadTemplate();

      // Clear template data (keep structure + formulas)
      console.log('🧹 Clearing template data...');
      const clearedTemplate = await this.cashflowTemplate.clearTemplateData(template);

      // Group GL records by month
      console.log('📅 Grouping GL by month...');
      const glByMonth = this.groupGLByMonth(glData.records);

      console.log(`   Found data for ${glByMonth.size} months:`);
      glByMonth.forEach((records, month) => {
        console.log(`     Month ${month}: ${records.length} transactions`);
      });

      // Fill template for all months with category mapping
      console.log('💾 Filling template with GL data...');
      const filledTemplate = await this.cashflowTemplate.fillGLDataWithCategoryMapping(
        clearedTemplate,
        glByMonth,
        this.chartOfAccounts,
        categoryRowMapping,
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
