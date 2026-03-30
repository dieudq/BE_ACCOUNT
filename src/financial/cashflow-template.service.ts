import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Cashflow Template Service
 * LOGIC:
 * 1. Load template
 * 2. COPY ENTIRE template (all 963 rows × 30 cols, all formatting)
 * 3. Calculate GL totals
 * 4. Find matching rows + columns
 * 5. Fill GL data into specific cells ONLY
 * 6. Export completely new file
 */
@Injectable()
export class CashflowTemplateService {
  private templateDir = path.join(process.cwd(), 'templates');

  /**
   * Load template
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
   * Calculate GL totals by category
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
      } else if (account.startsWith('635')) {
        chi += amounts.credit;
      } else if (account.startsWith('81')) {
        taiChinhThuNhap += amounts.debit;
      } else if (account.startsWith('82')) {
        taiChinhChi += amounts.credit;
      } else if (account === '1111') {
        tienMat += amounts.debit - amounts.credit;
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
   * Copy entire template to new workbook
   * Preserves: text, formatting, structure
   * Clears: all numeric values (will be replaced by GL)
   */
  async copyTemplateStructure(
    sourceTemplate: ExcelJS.Workbook,
  ): Promise<ExcelJS.Workbook> {
    console.log('\n📋 Copying template structure...');

    const newWorkbook = new ExcelJS.Workbook();
    const sourceSheet = sourceTemplate.getWorksheet('Cashflow_Misa');

    if (!sourceSheet) {
      throw new Error('Template sheet "Cashflow_Misa" not found');
    }

    // Create new sheet in new workbook
    const newSheet = newWorkbook.addWorksheet(sourceSheet.name);

    console.log(`   Copying ${sourceSheet.rowCount} rows × ${sourceSheet.columnCount} columns...`);
    console.log('   Keeping: text + formatting');
    console.log('   Clearing: old numeric values');

    // Set column widths
    for (let colIdx = 1; colIdx <= sourceSheet.columnCount; colIdx++) {
      const sourceCol = sourceSheet.getColumn(colIdx);
      const newCol = newSheet.getColumn(colIdx);
      if (sourceCol.width) {
        newCol.width = sourceCol.width;
      }
    }

    // Copy all rows
    sourceSheet.eachRow((sourceRow, rowNumber) => {
      const newRow = newSheet.getRow(rowNumber);

      // Copy row height
      if (sourceRow.height) {
        newRow.height = sourceRow.height;
      }

      // Copy all cells in row
      for (let colIdx = 1; colIdx <= sourceSheet.columnCount; colIdx++) {
        const sourceCell = sourceRow.getCell(colIdx);
        const newCell = newRow.getCell(colIdx);

        // Keep TEXT, clear NUMBERS
        if (typeof sourceCell.value === 'number') {
          // Numeric value → clear (will be filled with GL)
          newCell.value = null;
        } else if (typeof sourceCell.value === 'string') {
          // Text → keep
          newCell.value = sourceCell.value;
        } else if (sourceCell.value === null || sourceCell.value === undefined) {
          // Empty → keep empty
          newCell.value = null;
        } else {
          // Other types (formula, date, etc.) → keep
          newCell.value = sourceCell.value;
        }

        // Copy formatting (ALWAYS)
        if (sourceCell.font) {
          newCell.font = { ...sourceCell.font };
        }
        if (sourceCell.fill) {
          newCell.fill = { ...sourceCell.fill };
        }
        if (sourceCell.alignment) {
          newCell.alignment = { ...sourceCell.alignment };
        }
        if (sourceCell.border) {
          newCell.border = { ...sourceCell.border };
        }
        if (sourceCell.numFmt) {
          newCell.numFmt = sourceCell.numFmt;
        }
      }
    });

    console.log('✅ Template copied (text + formatting kept, numbers cleared)');
    return newWorkbook;
  }

  /**
   * Fill GL data into copied template
   * Month = 3 (March) → Columns I & J (9 & 10)
   */
  async fillGLDataIntoTemplate(
    workbook: ExcelJS.Workbook,
    categoryTotals: Map<string, number>,
    month: number,
  ): Promise<ExcelJS.Workbook> {
    const worksheet = workbook.getWorksheet('Cashflow_Misa');
    if (!worksheet) {
      throw new Error('Worksheet "Cashflow_Misa" not found');
    }

    console.log(`\n📍 Filling GL data for month ${month}...`);

    // Month column mapping (pairs for Actual/Plan)
    // E=5 for month 1, G=7 for month 2, I=9 for month 3, etc.
    const monthColIndex = 3 + month * 2;
    console.log(
      `   Target column: ${String.fromCharCode(64 + monthColIndex)} (index ${monthColIndex})`,
    );

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
            `   ✓ R${rowNumber}C${monthColIndex}: "${category}" = ${value.toLocaleString(
              'vi-VN',
            )}`,
          );
          found = true;
        }
      });

      if (!found) {
        console.log(`   ⚠️  Category "${category}" not found in template`);
      }
    });

    console.log(`✅ Updated ${updatedCount} cells with GL data`);
    return workbook;
  }

  /**
   * Export file to Excel
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
