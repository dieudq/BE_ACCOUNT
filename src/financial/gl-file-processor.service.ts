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
   * Process uploaded GL file:
   * 1. Parse GL → Extract account data
   * 2. Load template as reference (structure only)
   * 3. Calculate GL totals
   * 4. CREATE NEW file with GL data
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

      // Load template as reference
      console.log('📋 Loading template as reference...');
      const templateRef = await this.cashflowTemplate.loadTemplateAsReference();

      // Calculate GL totals
      console.log('🧮 Calculating GL totals...');
      const totals = this.cashflowTemplate.calculateCategoryTotals(
        glData.accounts,
      );

      // Create NEW file with GL data
      console.log('📝 Creating NEW file with GL data...');
      const newFile = await this.cashflowTemplate.createNewFileWithGLData(
        templateRef,
        totals,
        month,
      );

      // Export
      console.log('💾 Exporting new file...');
      const exportsDir = path.join(process.cwd(), 'exports');
      const outputPath = await this.cashflowTemplate.exportToExcel(
        newFile,
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
