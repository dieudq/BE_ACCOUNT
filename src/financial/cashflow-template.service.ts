import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Cashflow Template Service
 * LOGIC:
 * 1. Load template as BASE (preserve all structure/formulas)
 * 2. Parse GL data, calculate totals by category
 * 3. Map GL values to CORRECT ROWS and COLUMNS in template
 * 4. Export with GL data filled in
 * 
 * Template Structure (2026_TWD_s_Cashflows_Report.xlsx):
 * - Sheet 1: "Cashflow_Misa"
 * - Row 2: Headers with months
 * - March = Columns I & J (9 & 10)
 * - Row 6: "Thu dự án" (Revenue)
 * - Row 16+: "CHI" section (Expenses)
 * - Column A: GL codes, Column B: Category names
 */
@Injectable()
export class CashflowTemplateService {
  private templateDir = path.join(process.cwd(), 'templates');

  // Category mapping: GL account prefixes → Row number in template
  private categoryMap = {
    'Thu dự án': 6, // Row 6: Revenue
    'Chi dự án': 20, // Row 20: Expenses (approx, verify from template)
    'Tài chính thu nhập': 14, // Financial income (approx)
    'Tài chính chi': 16, // Financial expense (approx)
  };

  /**
   * Load template and preserve all structure
   */
  async loadTemplate(): Promise<ExcelJS.Workbook> {
    if (!fs.existsSync(this.templateDir)) {
      throw new Error('Templates directory not found');
    }

    const templates = fs
      .readdirSync(this.templateDir)
      .filter((f) => f.includes('Cashflows_Report'));

    if (templates.length === 0) {
      throw new Error('No Cashflow template found');
    }

    const templateFile = path.join(this.templateDir, templates[0]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templateFile);

    console.log(`✅ Template loaded: ${templates[0]}`);
    return workbook;
  }

  /**
   * Calculate GL totals by category (515.x, 635.x, etc.)
   */
  calculateCategoryTotals(
    glData: Map<string, { debit: number; credit: number }>,
  ): Map<string, number> {
    const totals = new Map<string, number>();

    console.log('🧮 Calculating GL totals by category...');

    let thu = 0; // 515.x
    let chi = 0; // 635.x
    let taiChinhThuNhap = 0; // 81x
    let taiChinhChi = 0; // 82x
    let tienMat = 0; // 1111

    for (const [account, amounts] of glData.entries()) {
      console.log(`   Account ${account}: Debit=${amounts.debit}, Credit=${amounts.credit}`);

      if (account.startsWith('515')) {
        thu += amounts.debit;
        console.log(`     → "Thu dự án" += ${amounts.debit} (total: ${thu})`);
      } else if (account.startsWith('635')) {
        chi += amounts.credit;
        console.log(`     → "Chi dự án" += ${amounts.credit} (total: ${chi})`);
      } else if (account.startsWith('81')) {
        taiChinhThuNhap += amounts.debit;
        console.log(`     → "Tài chính thu nhập" += ${amounts.debit}`);
      } else if (account.startsWith('82')) {
        taiChinhChi += amounts.credit;
        console.log(`     → "Tài chính chi" += ${amounts.credit}`);
      } else if (account === '1111') {
        tienMat += amounts.debit - amounts.credit;
        console.log(`     → "Tiền mặt" += ${amounts.debit - amounts.credit}`);
      }
    }

    totals.set('Thu dự án', thu);
    totals.set('Chi dự án', chi);
    totals.set('Tài chính thu nhập', taiChinhThuNhap);
    totals.set('Tài chính chi', taiChinhChi);
    totals.set('Tiền mặt', tienMat);

    console.log('\n✅ Category Totals:');
    totals.forEach((value, category) => {
      console.log(`   ${category}: ${value.toLocaleString('vi-VN')}`);
    });

    return totals;
  }

  /**
   * Fill GL data into template
   * Month = 3 (March) → Columns I & J (9 & 10)
   */
  async fillTemplateWithGLData(
    template: ExcelJS.Workbook,
    categoryTotals: Map<string, number>,
    month: number,
  ): Promise<ExcelJS.Workbook> {
    const worksheet = template.getWorksheet('Cashflow_Misa');
    if (!worksheet) {
      throw new Error('Worksheet "Cashflow_Misa" not found');
    }

    console.log(`\n📍 Filling template for month ${month}...`);

    // Month column mapping (pairs for Actual/Plan)
    // Jan = E&F (5&6), Feb = G&H (7&8), Mar = I&J (9&10), Apr = K&L (11&12), May = M&N (13&14)
    const monthColIndex = 3 + month * 2; // E=5 for month 1, G=7 for month 2, I=9 for month 3, etc.
    console.log(`   Target column: ${String.fromCharCode(64 + monthColIndex)} (index ${monthColIndex})`);

    let updatedCount = 0;

    // Map each category to its template row
    categoryTotals.forEach((value, category) => {
      // Find row with this category name in Column B
      let found = false;
      worksheet.eachRow((row, rowNumber) => {
        const cellB = row.getCell(2).value; // Column B
        if (cellB && String(cellB).includes(category)) {
          // Fill column with GL value
          const cell = row.getCell(monthColIndex);
          cell.value = value;
          cell.numFmt = '#,##0';
          updatedCount++;
          console.log(
            `   ✓ R${rowNumber}C${monthColIndex}: "${category}" = ${value.toLocaleString('vi-VN')}`,
          );
          found = true;
        }
      });

      if (!found) {
        console.log(`   ⚠️  Category "${category}" not found in template`);
      }
    });

    console.log(`✅ Updated ${updatedCount} cells`);
    return template;
  }

  /**
   * Export template with GL data to Excel
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
