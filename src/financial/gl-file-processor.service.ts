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
   * Process uploaded GL file → Parse → Map to Template → Export Excel
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
      console.log('📋 Loading Cashflow template...');
      const workbook = await this.cashflowTemplate.loadTemplate();

      // Map GL data to template
      console.log('🧮 Mapping GL data to template...');
      const mappedWorkbook = await this.cashflowTemplate.mapGLDataToTemplate(
        workbook,
        glData.accounts,
        year,
        month,
      );

      // Recalculate formulas
      await this.cashflowTemplate.recalculateFormulas(mappedWorkbook);

      // Export to Excel
      console.log('💾 Exporting to Excel...');
      const exportsDir = path.join(process.cwd(), 'exports');
      const outputPath = await this.cashflowTemplate.exportToExcel(
        mappedWorkbook,
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
