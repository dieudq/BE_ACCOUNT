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
   * Process GL file:
   * 1. Parse GL
   * 2. Load template
   * 3. COPY entire template (all 963 rows × 30 cols)
   * 4. Calculate GL totals
   * 5. Fill GL data into template copy
   * 6. Export
   */
  async processGLFileAndGenerateCashflow(filePath: string): Promise<string> {
    try {
      console.log('📖 Parsing GL file...');
      const glData = await this.glParser.parseGLFile(filePath);

      console.log(`✅ Parsed ${glData.accounts.size} accounts`);
      console.log(`   Period: ${glData.period}`);

      // Extract year/month from period
      const [year, month] = glData.period.split('-').map(Number);

      // Load template
      console.log('📋 Loading template...');
      const template = await this.cashflowTemplate.loadTemplate();

      // Copy entire template structure (all 963 rows × 30 cols)
      console.log('🔄 Copying full template...');
      const copiedTemplate = await this.cashflowTemplate.copyTemplateStructure(
        template,
      );

      // Calculate GL totals
      console.log('🧮 Calculating GL totals...');
      const totals = this.cashflowTemplate.calculateCategoryTotals(
        glData.accounts,
      );

      // Fill GL data into template copy
      console.log('📝 Filling GL data...');
      const filledTemplate = await this.cashflowTemplate.fillGLDataIntoTemplate(
        copiedTemplate,
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
