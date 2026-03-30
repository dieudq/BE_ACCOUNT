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
   * Load template as reference
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
   * Create NEW minimal workbook with ONLY top-level category rows
   * (Do NOT copy entire template - that causes formula/sub-row mess)
   * 
   * Top-level rows (no sub-rows):
   * R6: Thu dự án
   * R10: Thu đầu tư tài chính, tiết kiệm
   * R11: Thu đầu tư R&D
   * R12: Thu khác
   * R17: Lương dự án
   * R23: Quản lý văn phòng
   * R28: Chi phí đảm bảo chất lượng
   * R31: Hành chính/ Nhân Sự
   * R34: Kế toán/Tài Chính
   * R37: Sales
   * R44: Marketing
   * R49: Hạ tầng IT
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

    // Copy headers (rows 1-3)
    for (let r = 1; r <= 3; r++) {
      const srcRow = templateWs.getRow(r);
      const dstRow = newWs.getRow(r);

      for (let c = 1; c <= 30; c++) {
        const srcCell = srcRow.getCell(c);
        const dstCell = dstRow.getCell(c);

        // Copy value, format, alignment
        dstCell.value = srcCell.value;
        dstCell.font = { ...srcCell.font };
        dstCell.fill = { ...srcCell.fill };
        dstCell.alignment = { ...srcCell.alignment };
        dstCell.border = { ...srcCell.border };
      }
    }

    console.log('   ✓ Headers copied (rows 1-3)');

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

    let destRow = 4;
    for (const item of topLevelRows) {
      const srcRow = templateWs.getRow(item.src);
      const dstRow = newWs.getRow(destRow);

      for (let c = 1; c <= 30; c++) {
        const srcCell = srcRow.getCell(c);
        const dstCell = dstRow.getCell(c);

        // Copy text only (no formulas/values)
        dstCell.value = srcCell.value;
        dstCell.font = { ...srcCell.font };
        dstCell.fill = { ...srcCell.fill };
        dstCell.alignment = { ...srcCell.alignment };
        dstCell.border = { ...srcCell.border };
      }

      console.log(`   ✓ Row ${item.src} → Row ${destRow}: ${item.name}`);
      destRow++;
    }

    console.log(`✅ Minimal workbook created (${destRow - 1} rows total)`);
    return newWb;
  }

  /**
   * Fill GL data with category mapping
   * For each month:
   * - Sum GL by category
   * - Fill into category row
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

    console.log('\n📍 Filling GL data into category rows...');

    glByMonth.forEach((records, month) => {
      console.log(`\n   Month ${month}:`);

      // Group by counter-account
      const accountTotals = new Map<string, { debit: number; credit: number }>();
      records.forEach((record: any) => {
        const account = record.counterAccount as string;
        if (!accountTotals.has(account)) {
          accountTotals.set(account, { debit: 0, credit: 0 });
        }
        const totals = accountTotals.get(account);
        if (totals) {
          totals.debit += (record.debitAmount as number) || 0;
          totals.credit += (record.creditAmount as number) || 0;
        }
      });

      // Map to categories
      const categoryTotals = new Map<string, number>();
      accountTotals.forEach((amounts, account) => {
        const category = chartOfAccountsService.mapAccountToCategory(account);
        const net = amounts.debit - amounts.credit;

        console.log(
          `     ${account} → ${category}: Debit=${amounts.debit}, Credit=${amounts.credit}, Net=${net}`,
        );

        if (!categoryTotals.has(category)) {
          categoryTotals.set(category, 0);
        }
        categoryTotals.set(category, (categoryTotals.get(category) || 0) + net);
      });

      // Month column (Actual only): F, H, J, L, N, P, R, T, V, X, Z, \
      const monthColIndex = 4 + month * 2;
      const colLetter = String.fromCharCode(64 + monthColIndex);

      console.log(`   Fill column ${colLetter} (index ${monthColIndex})`);

      let updateCount = 0;
      categoryTotals.forEach((value, category) => {
        // Find row in new workbook by category name
        let found = false;
        worksheet.eachRow((row, rowNum) => {
          const cellB = row.getCell(2).value;
          if (cellB && String(cellB).trim() === category.trim()) {
            const cell = row.getCell(monthColIndex);
            console.log(
              `     ✓ R${rowNum}C${monthColIndex}: "${category}" = ${value.toLocaleString(
                'vi-VN',
              )}`,
            );
            cell.value = value;
            cell.numFmt = '#,##0';
            updateCount++;
            found = true;
          }
        });

        if (!found) {
          console.log(`     ⚠️  Category "${category}" not found`);
        }
      });

      console.log(`     Updated ${updateCount} cells`);
    });

    console.log('\n✅ All months filled');
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
