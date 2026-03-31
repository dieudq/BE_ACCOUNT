import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Cashflow Template Service
 * 
 * LOGIC (CORRECTED):
 * 1. Load template (reference structure only)
 * 2. Extract TOP-LEVEL category rows ONLY (Thu dự án, Lương dự án, etc.)
 * 3. Create NEW workbook with:
 *    - Headers from template
 *    - Only top-level category rows
 *    - Empty data cells (ready for GL fill)
 * 4. Fill GL data into category rows
 * 5. Export new file
 * 
 * DO NOT copy sub-rows, formulas, or extra detail rows!
 */
@Injectable()
export class CashflowTemplateService {
  private templateDir = path.join(process.cwd(), 'templates');

  /**
   * Load template for GL data injection
   * Template has formulas + structure - we'll clear data and fill GL values
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
   * Clear data columns from template (F-Z) to prepare for GL data
   * Keep structure + formulas + formatting
   */
  async clearTemplateData(workbook: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
    const worksheet = workbook.getWorksheet('Cashflow_Misa');
    if (!worksheet) {
      throw new Error('Worksheet not found');
    }

    console.log('🧹 Clearing template data columns (F-Z)...');

    let cleared = 0;
    // Clear data from row 3 onwards, columns F-Z (indices 6-26)
    for (let r = 3; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);

      for (let c = 6; c <= 26; c++) {
        const cell = row.getCell(c);

        // Keep formulas, clear numeric data
        if (cell.value) {
          if (typeof cell.value === 'object' && 'formula' in cell.value) {
            // Keep formula
            continue;
          }

          // Clear numeric/text data
          if (typeof cell.value === 'number' || typeof cell.value === 'string') {
            cell.value = null;
            cleared++;
          }
        }
      }
    }

    console.log(`✅ Cleared ${cleared} data cells`);
    return workbook;
  }

  /**
   * Create NEW minimal workbook with ONLY top-level category rows
   * DO NOT copy headers from template (they have shared formulas)
   * Create fresh headers instead
   */
  async createMinimalCashflowWorkbook(
    templateRef: ExcelJS.Workbook,
  ): Promise<ExcelJS.Workbook> {
    const templateWs = templateRef.getWorksheet('Cashflow_Misa');
    if (!templateWs) {
      throw new Error('Template worksheet not found');
    }

    // Create NEW workbook
    const newWb = new ExcelJS.Workbook();
    const newWs = newWb.addWorksheet('Cashflow_Misa');

    console.log('🔧 Creating minimal Cashflow workbook with top-level categories...');

    // Copy header FORMATTING from template (row 1-2) - colors, fonts, borders
    // BUT skip formulas to avoid errors
    for (let r = 1; r <= 2; r++) {
      const srcRow = templateWs.getRow(r);
      const dstRow = newWs.getRow(r);

      for (let c = 1; c <= 30; c++) {
        const srcCell = srcRow.getCell(c);
        const dstCell = dstRow.getCell(c);

        // Copy FORMATTING (colors, fonts, borders, alignment)
        if (srcCell.font) dstCell.font = { ...srcCell.font };
        if (srcCell.fill) dstCell.fill = { ...srcCell.fill };
        if (srcCell.alignment) dstCell.alignment = { ...srcCell.alignment };
        if (srcCell.border) dstCell.border = { ...srcCell.border };

        // Copy VALUE only if it's NOT a formula
        const srcValue = srcCell.value;
        if (srcValue && typeof srcValue === 'object' && 'formula' in srcValue) {
          // Skip formulas
          dstCell.value = srcCell.text || '';
        } else {
          dstCell.value = srcValue;
        }
      }
    }

    console.log('   ✓ Headers copied with formatting (rows 1-2)');

    // TOP-LEVEL category rows (confirmed mapping)
    const topLevelRows = [
      { src: 6, name: 'Thu dự án' },
      { src: 10, name: 'Thu đầu tư tài chính, tiết kiệm' },
      { src: 11, name: 'Thu đầu tư R&D' },
      { src: 12, name: 'Thu khác' },
      { src: 17, name: 'Lương dự án' },
      { src: 23, name: 'Quản lý văn phòng' },
      { src: 28, name: 'Chi phí đảm bảo chất lượng' },
      { src: 31, name: 'Hành chính/ Nhân Sự' },
      { src: 34, name: 'Kế toán/Tài Chính' },
      { src: 37, name: 'Sales' },
      { src: 44, name: 'Marketing' },
      { src: 49, name: 'Hạ tầng IT' },
    ];

    let destRow = 3;
    for (const item of topLevelRows) {
      const srcRow = templateWs.getRow(item.src);
      const dstRow = newWs.getRow(destRow);

      // Copy ONLY text values (column A, B, C)
      // Skip all formulas
      for (let c = 1; c <= 3; c++) {
        const srcCell = srcRow.getCell(c);
        const dstCell = dstRow.getCell(c);

        // Get raw value - if it's a formula, get the text display value instead
        let value = srcCell.value;
        
        if (value && typeof value === 'object' && 'formula' in value) {
          // It's a formula - skip it, use text or category name
          if (c === 2) {
            // Column B = category name
            dstCell.value = item.name;
          } else {
            dstCell.value = srcCell.text || '';
          }
        } else {
          // Regular value
          if (c === 2) {
            dstCell.value = item.name;
          } else {
            dstCell.value = value;
          }
        }

        // Copy basic formatting
        if (srcCell.font) dstCell.font = { ...srcCell.font };
        if (srcCell.fill) dstCell.fill = { ...srcCell.fill };
        if (srcCell.alignment) dstCell.alignment = { ...srcCell.alignment };
      }

      console.log(`   ✓ Row ${item.src} → Row ${destRow}: ${item.name}`);
      destRow++;
    }

    console.log(`✅ Minimal workbook created (${destRow - 1} rows total)`);
    return newWb;
  }

  /**
   * Fill GL data into template SUB-ROWS (not category rows)
   * Template structure: Category rows have formulas that SUM sub-rows
   * So fill sub-rows → formulas calculate automatically
   * 
   * Fill by month:
   * - For each GL transaction
   * - Find account → map to sub-row
   * - Find month → map to column (F=Jan, H=Feb, etc.)
   * - Fill cell[row][col] = amount
   */
  async fillGLDataWithCategoryMapping(
    workbook: ExcelJS.Workbook,
    glByMonth: Map<number, any[]>,
    chartOfAccountsService: any,
    categoryRowMapping: Map<string, number>,
  ): Promise<ExcelJS.Workbook> {
    const worksheet = workbook.getWorksheet('Cashflow_Misa');
    if (!worksheet) {
      throw new Error('Worksheet not found');
    }

    console.log('\n📍 Filling GL data into sub-rows (by month)...');

    // GL account → Sub-row mapping
    const glToSubRow = {
      '515.3': 10, '515.5': 11, '515.2': 12, '711.2': 12, '711.1': 13, '515.1': 14, '635': 14,
      '334.1': 18, '334.2': 19,
      '6422.2': 24, '6422.3': 25, '6422.4': 26,
      '154.1': 29, '154.2': 30,
      '6421.2': 32,
      '6422.6': 35,
      '6421.3': 38, '6421.4': 39, '6421.5': 40, '6421.6': 41, '6421.7': 42,
      '6421.8': 45, '6421.9': 46,
      '821': 54,
      '334-10': 58, '334-11': 59, '334-12': 60, '6421-13': 61, '6421-14': 62,
    };

    let totalFilled = 0;

    // For each month in GL data
    glByMonth.forEach((records, month) => {
      console.log(`\n   📅 Month ${month}:`);

      // Month column (Actual only): F=6, H=8, J=10, L=12, N=14, P=16, R=18, T=20, V=22, X=24, Z=26, \=28
      const monthColIndex = 4 + month * 2;
      const colLetter = String.fromCharCode(64 + monthColIndex);

      // For each transaction in this month (detailed row-by-row)
      records.forEach((record: any, idx: number) => {
        const accountCode = (record.counterAccount as string).trim();
        const debit = (record.debitAmount as number) || 0;
        const credit = (record.creditAmount as number) || 0;
        const amount = debit - credit; // Net
        const desc = record.description || '';

        // Find sub-row for this account
        const subRow = glToSubRow[accountCode];
        if (!subRow) {
          console.log(
            `     ⚠️  Row ${idx + 1}: ${accountCode} "${desc}" - No sub-row mapping`,
          );
          return;
        }

        // Get cell in template
        const cell = worksheet.getRow(subRow).getCell(monthColIndex);
        const currentVal = cell.value || 0;

        // ACCUMULATE: Add to existing value (in case multiple transactions for same account/month)
        const newVal = (typeof currentVal === 'number' ? currentVal : 0) + amount;
        cell.value = newVal;
        cell.numFmt = '#,##0';

        console.log(
          `     ✓ Row ${idx + 1}: ${accountCode} → R${subRow}${colLetter} | "${desc}" | +${amount.toLocaleString(
            'vi-VN',
          )} = ${newVal.toLocaleString('vi-VN')}`,
        );

        totalFilled++;
      });
    });

    console.log(`\n✅ Processed ${totalFilled} transactions`);
    return workbook;
  }

  /**
   * Export to Excel
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
