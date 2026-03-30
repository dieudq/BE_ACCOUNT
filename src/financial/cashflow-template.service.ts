import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Cashflow Template Service
 * Maps GL data into user-provided template Excel file
 * Preserves template structure, formulas, and formatting
 */
@Injectable()
export class CashflowTemplateService {
  private templateDir = path.join(process.cwd(), 'templates');

  /**
   * Load template from user uploads
   * User should have uploaded: "2026_TWD_s_Cashflows_Report.xlsx"
   */
  async loadTemplate(): Promise<ExcelJS.Workbook> {
    // Find template files in templates/ directory
    if (!fs.existsSync(this.templateDir)) {
      throw new Error('Templates directory not found');
    }

    const templates = fs
      .readdirSync(this.templateDir)
      .filter((f) => f.includes('Cashflows_Report') || f.includes('cashflow'));

    if (templates.length === 0) {
      throw new Error(
        'No Cashflow template found. Please upload template file first.',
      );
    }

    const templateFile = path.join(this.templateDir, templates[0]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templateFile);

    console.log(`✅ Template loaded: ${templates[0]}`);
    return workbook;
  }

  /**
   * Map GL account data to template
   * Template structure expected:
   * - Column A: Category names (Thu, Chi, Lãi/Lỗ, etc.)
   * - Columns B-onwards: Monthly data
   * - Last row: Totals with formulas
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

    console.log('🧮 Mapping GL data to template...');

    // Map GL accounts to template categories
    const glMapping = {
      'Thu dự án': ['515'], // Revenue: 515.x
      'Chi dự án': ['635'], // Expense: 635.x
      'Tài chính thu nhập': ['81'], // Financial income: 81x
      'Tài chính chi': ['82'], // Financial expense: 82x
      'Tiền mặt': ['1111'], // Cash: 1111
    };

    // Calculate totals for each category
    const categoryTotals: Map<string, number> = new Map();

    for (const [category, prefixes] of Object.entries(glMapping)) {
      let total = 0;

      for (const prefix of prefixes) {
        for (const [account, amounts] of glData.entries()) {
          if (account.startsWith(prefix)) {
            // Revenue/Income: Debit; Expense: Credit
            const value =
              category.includes('Chi') || category.includes('chi')
                ? amounts.credit
                : amounts.debit;
            total += value;
          }
        }
      }

      categoryTotals.set(category, total);
      console.log(`  ${category}: ${total.toLocaleString('vi-VN')}`);
    }

    // Find and fill category rows in template
    let updateCount = 0;
    worksheet.eachRow((row, rowNumber) => {
      const firstCell = row.getCell(1).value;
      if (!firstCell) return;

      const categoryName = String(firstCell).trim();

      if (categoryTotals.has(categoryName)) {
        // Find the "current month" column (typically column based on month)
        // For now, assume column B is Jan, C is Feb, etc.
        const monthColumn = month + 1; // Column A=0, B=1 (Jan), C=2 (Feb), etc.
        const cell = row.getCell(monthColumn);

        if (cell) {
          const value = categoryTotals.get(categoryName) || 0;
          cell.value = value;
          cell.numFmt = '#,##0';
          updateCount++;
          console.log(
            `  Updated ${categoryName} @ R${rowNumber}C${monthColumn} = ${value.toLocaleString('vi-VN')}`,
          );
        }
      }
    });

    console.log(`✅ Mapped ${updateCount} cells`);
    return template;
  }

  /**
   * Recalculate all formulas in template
   */
  async recalculateFormulas(workbook: ExcelJS.Workbook): Promise<void> {
    // ExcelJS doesn't auto-calc formulas, but exports them
    // Formulas will be recalculated when file is opened in Excel
    console.log('✅ Formulas preserved (will recalc in Excel)');
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

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    await workbook.xlsx.writeFile(outPath);
    console.log(`✅ Exported: ${outPath}`);
    return outPath;
  }
}
