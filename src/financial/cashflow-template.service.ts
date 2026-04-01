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

    // GL account → Sub-row mapping (based on actual template structure)
    // Template has category rows and detail sub-rows. Fill sub-rows so formulas auto-calculate.
    // 
    // Structure:
    // R6: Thu dự án (category) → R7-R9: Detail sub-rows
    // R10: Thu đầu tư tài chính (category) → No sub-rows (single line)
    // R11: Thu đầu tư R&D (category) → No sub-rows (single line)
    // R12-R15: Thu khác + Lãi/lỗ (category + sub-rows)
    // R17: Lương dự án (category) → R18-R22: Detail sub-rows
    // R23: Quản lý văn phòng (category) → R24-R27: Detail sub-rows
    // R28: Chi phí đảm bảo chất lượng (category) → R29-R30: Detail sub-rows
    // R31: Hành chính/NHÂN SỰ (category) → R32-R33: Detail sub-rows
    // R34: Kế toán/Tài Chính (category) → R35-R36: Detail sub-rows
    // R37: Sales (category) → R38-R43: Detail sub-rows
    // R44: Marketing (category) → R45-R48: Detail sub-rows
    // R49-R65: Other categories
    
    const glToSubRow = {
      // REVENUE - Thu dự án (6-9)
      '511': 7,      // Main project revenue
      '511.1': 7,    // Sub variants of 511
      '511.2': 7,
      '511.3': 7,
      '5111': 8,     // Sold goods
      '5112': 8,     // Sold finished products
      '5113': 7,     // Service revenue
      '5113.1': 7,   // T&M
      '5113.2': 8,   // Fixed Price
      '5118': 9,     // Other revenue
      
      // REVENUE - Thu đầu tư tài chính (10)
      '515.3': 10,
      
      // REVENUE - Thu đầu tư R&D (11)
      '515.5': 11,
      '515.4': 15,   // Sub-detail under "Lãi/lỗ TG rút tiền"
      
      // REVENUE - Thu khác (12-15)
      '515.2': 12,
      '711.2': 12,
      '711.1': 13,
      '515.1': 14,
      '635': 14,
      
      // SALARY - Lương dự án (17-22)
      '334.1': 18,
      '334.2': 19,
      '334.4': 18,   // Project bonus (maps to project salary)
      
      // ADMIN/OFFICE - Quản lý văn phòng (23-27)
      '6422.2': 25,   // Utilities (Điện/Nước/Gửi xe)
      '6422.3': 26,   // Office supplies (mua sắm)
      '6422.4': 26,   // Admin costs
      '6422.5': 24,   // Internal activities -> "Chi phí thuê nhà" or general allocation
      
      // QA COST - Chi phí đảm bảo chất lượng (28-30)
      '154.1': 29,    // NCTT
      '154.2': 30,    // Vendor
      '154.3': 30,    // Project tools/training
      
      // HR/ADMIN - Hành chính/Nhân Sự (31-33)
      '6421.2': 32,   // HR salary
      '331': 32,      // Social insurance (linked to HR)
      '334.3': 32,    // Accounting staff salary (also admin)
      '334.5': 32,    // HR staff salary
      '334.8': 33,    // CSH/Admin (internal activities)
      
      // ACCOUNTING - Kế toán/Tài Chính (34-36)
      '6422.6': 35,
      
      // SALES (37-43)
      '6421.3': 38,
      '6421.4': 39,
      '6421.5': 40,
      '6421.6': 41,
      '6421.7': 42,
      '6421-19': 43,  // Commission
      '6421-11': 42,  // Equipment (sales support)
      '334.6': 38,    // Sales staff salary
      
      // MARKETING (44-48)
      '6421.8': 46,
      '6421.9': 47,
      '6421-15': 45,  // Marketing staff salary
      '334.7': 46,    // Marketing staff salary
      
      // OTHER / BONUS (48-65)
      '811': 63,      // Other costs (give/loan, credit)
      '2411': 64,     // Loans
      
      // BALANCE SHEET - these shouldn't normally appear but map as fallback
      '1111': 7,      // Cash -> map to revenue placeholder
      '1113': 7,      // Cash -> map to revenue placeholder
      '1121.1': 7,    // Bank -> map to revenue placeholder
      '1121.7': 7,    // Bank -> map to revenue placeholder
      '131.1': 7,     // AR -> map to revenue placeholder
      '131.2': 7,     // AR -> map to revenue placeholder
    };

    let totalFilled = 0;

    // For each month in GL data
    glByMonth.forEach((records, month) => {
      console.log(`\n   📅 Month ${month}:`);

      // Month column (Plan columns): G=7, I=9, K=11, M=13, O=15, Q=17, S=19, U=21, W=23, Y=25, [=27, ]=29
      // Formula: colIndex = 5 + month * 2
      const monthColIndex = 5 + month * 2;
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
