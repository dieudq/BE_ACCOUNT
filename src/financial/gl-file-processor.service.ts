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
   * Process uploaded GL file → Parse → Create New Cashflow File → Export Excel
   * 
   * LOGIC:
   * 1. Parse GL file (extract account data)
   * 2. Load template as reference (structure/format only)
   * 3. Create NEW Excel file (not copy of template)
   * 4. Fill NEW file with GL calculations + template formatting
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

      // Create NEW Cashflow file with GL data
      console.log('📝 Creating NEW Cashflow file...');
      const newWorkbook = await this.cashflowTemplate.createNewCashflowFile(
        templateRef,
        glData.accounts,
        year,
        month,
      );

      // Export new file
      console.log('💾 Exporting to Excel...');
      const exportsDir = path.join(process.cwd(), 'exports');
      const outputPath = await this.cashflowTemplate.exportToExcel(
        newWorkbook,
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
