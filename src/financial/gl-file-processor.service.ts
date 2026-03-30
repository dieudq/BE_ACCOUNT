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
   * Process uploaded GL file → Parse → Fill Template → Export Excel
   * 
   * LOGIC:
   * 1. Parse GL file (extract account data by code)
   * 2. Load template (preserve structure + formulas)
   * 3. Calculate GL totals by category (515.x, 635.x, etc.)
   * 4. Fill template with GL values in correct rows/columns
   * 5. Export
   */
  async processGLFileAndGenerateCashflow(filePath: string): Promise<string> {
    try {
      console.log('📖 Parsing GL file...');
      const glData = await this.glParser.parseGLFile(filePath);

      console.log(`✅ Parsed ${glData.accounts.size} accounts`);
      console.log(`   Period: ${glData.period}`);

      // Extract year/month from period
      const [year, month] = glData.period.split('-').map(Number);

      // Load template (preserve all structure)
      console.log('📋 Loading template...');
      const template = await this.cashflowTemplate.loadTemplate();

      // Calculate GL totals
      console.log('🧮 Calculating GL totals...');
      const totals = this.cashflowTemplate.calculateCategoryTotals(
        glData.accounts,
      );

      // Fill template with GL data
      console.log('📝 Filling template with GL data...');
      const filledTemplate = await this.cashflowTemplate.fillTemplateWithGLData(
        template,
        totals,
        month,
      );

      // Export
      console.log('💾 Exporting to Excel...');
      const exportsDir = path.join(process.cwd(), 'exports');
      const outputPath = await this.cashflowTemplate.exportToExcel(
        filledTemplate,
        exportsDir,
        `cashflow_${year}_${String(month).padStart(2, '0')}_${Date.now()}.xlsx`,
      );

      console.log(`✅ Processing complete: ${outputPath}`);
      return outputPath;
    } catch (err) {
      console.error('❌ Error processing GL file:', err);
      throw err;
    }
  }
}
