import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

export interface GLCategoryData {
  [key: string]: number;
}

/**
 * Cashflow Template Service
 * Maps parsed GL data into user-provided template
 * - Template = Design/Format only
 * - GL data = Actual calculation from uploaded file
 */
@Injectable()
export class CashflowTemplateService {
  private templateDir = path.join(process.cwd(), 'templates');

  /**
   * Load template from templates/ directory
   */
  async loadTemplate(): Promise<ExcelJS.Workbook> {
    if (!fs.existsSync(this.templateDir)) {
      throw new Error('Templates directory not found');
    }

    const templates = fs
      .readdirSync(this.templateDir)
      .filter((f) => f.includes('Cashflows_Report') || f.includes('cashflow'));

    if (templates.length === 0) {
      throw new Error(
        'No Cashflow template found. Please ensure template file exists in templates/ directory.',
      );
    }

    const templateFile = path.join(this.templateDir, templates[0]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templateFile);

    console.log(`✅ Template loaded: ${templates[0]}`);
    return workbook;
  }

  /**
   * Calculate GL data totals by category
   * Input: Map of GL accounts with debit/credit amounts
   * Output: Totals per category (Thu, Chi, Tài chính, etc.)
   */
  calculateCategoryTotals(
    glData: Map<string, { debit: number; credit: number }>,
  ): GLCategoryData {
    const totals: GLCategoryData = {
      'Thu dự án': 0, // 515.x - Revenue (Debit)
      'Chi dự án': 0, // 635.x - Expense (Credit)
      'Tài chính thu nhập': 0, // 81x - Financial income (Debit)
      'Tài chính chi': 0, // 82x - Financial expense (Credit)
      'Tiền mặt': 0, // 1111 - Cash (Debit - Credit)
    };

    console.log('🧮 Calculating GL totals by category...');

    for (const [account, amounts] of glData.entries()) {
      console.log(
        `   Account ${account}: Debit=${amounts.debit}, Credit=${amounts.credit}`,
      );

      if (account.startsWith('515')) {
        // Revenue accounts - use Debit
        totals['Thu dự án'] += amounts.debit;
        console.log(`     → Added to "Thu dự án": +${amounts.debit}`);
      } else if (account.startsWith('635')) {
        // Expense accounts - use Credit
        totals['Chi dự án'] += amounts.credit;
        console.log(`     → Added to "Chi dự án": +${amounts.credit}`);
      } else if (account.startsWith('81')) {
        // Financial income - use Debit
        totals['Tài chính thu nhập'] += amounts.debit;
        console.log(`     → Added to "Tài chính thu nhập": +${amounts.debit}`);
      } else if (account.startsWith('82')) {
        // Financial expense - use Credit
        totals['Tài chính chi'] += amounts.credit;
        console.log(`     → Added to "Tài chính chi": +${amounts.credit}`);
      } else if (account === '1111') {
        // Cash - Net (Debit - Credit)
        totals['Tiền mặt'] += amounts.debit - amounts.credit;
        console.log(
          `     → Added to "Tiền mặt": +${amounts.debit - amounts.credit}`,
        );
      }
    }

    console.log('\n✅ Category Totals:');
    Object.entries(totals).forEach(([category, value]) => {
      console.log(
        `   ${category}: ${value.toLocaleString('vi-VN')} VND`,
      );
    });

    return totals;
  }

  /**
   * Map GL calculated data into template
   * Finds category rows and fills with GL totals
   */
  async mapGLDataToTemplate(
    template: ExcelJS.Workbook,
    glData: Map<string, { debit: number; credit: number }>,
    year: number,
    month: number,
  ): Promise<ExcelJS.Workbook> {
    const worksheet = template.getWorksheet(1);
    if (!worksheet) {
      throw new Error('No worksheet in template');
    }

    // Calculate totals
    const categoryTotals = this.calculateCategoryTotals(glData);

    console.log('\n📍 Mapping GL data to template...');

    // Column mapping: Assume column B is Jan (month 1), C is Feb (month 2), etc.
    // For month=3 (March), column should be D (column index 4)
    const dataColumnIndex = month + 1; // Column A=1, B=2, C=3, D=4, etc.

    console.log(
      `   Target column: Column ${String.fromCharCode(64 + dataColumnIndex)} (Month ${month})`,
    );

    let updateCount = 0;

    // Search for category rows and fill with GL data
    worksheet.eachRow((row, rowNumber) => {
      const firstCell = row.getCell(1).value;
      if (!firstCell) return;

      const cellText = String(firstCell).trim();

      // Match category names
      for (const [category, value] of Object.entries(categoryTotals)) {
        if (cellText.includes(category)) {
          const targetCell = row.getCell(dataColumnIndex);
          if (targetCell) {
            targetCell.value = value;
            targetCell.numFmt = '#,##0'; // Vietnamese number format
            updateCount++;
            console.log(
              `   ✓ R${rowNumber}C${dataColumnIndex}: "${cellText}" = ${value.toLocaleString('vi-VN')}`,
            );
          }
          break;
        }
      }
    });

    console.log(`\n✅ Updated ${updateCount} cells in template`);
    return template;
  }

  /**
   * Formulas preserved automatically by ExcelJS
   * When Excel opens file, formulas will recalculate
   */
  async recalculateFormulas(workbook: ExcelJS.Workbook): Promise<void> {
    console.log(
      '✅ Formulas preserved (will auto-recalculate when opened in Excel)',
    );
  }

  /**
   * Export template with GL data to Excel file
   */
  async exportToExcel(
    workbook: ExcelJS.Workbook,
    outputDir: string,
    filename?: string,
  ): Promise<string> {
    const outPath = path.join(
      outputDir,
      filename || `cashflow_${Date.now()}.xlsx`,
    );

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    await workbook.xlsx.writeFile(outPath);
    console.log(`✅ Exported: ${outPath}`);
    return outPath;
  }
}
