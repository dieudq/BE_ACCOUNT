import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Chart of Accounts Loader
 * Load Danh sách file → Build account → Cashflow category mapping
 * Match GL accounts to template rows
 */
@Injectable()
export class ChartOfAccountsService {
  /**
   * Load Danh sách file
   * Returns Map<account_code, {name, type}>
   */
  async loadChartOfAccounts(
    filePath: string,
  ): Promise<Map<string, { name: string; type: string }>> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('No worksheet found in Chart of Accounts file');
    }

    const coa = new Map<string, { name: string; type: string }>();

    console.log('📋 Loading Chart of Accounts...');

    worksheet.eachRow((row, rowNumber) => {
      // Skip header rows (1-3)
      if (rowNumber <= 3) return;

      // Column B: Account code, Column C: Account name, Column D: Type
      const accountCode = String(row.getCell(2).value || '').trim();
      const accountName = String(row.getCell(3).value || '').trim();
      const accountType = String(row.getCell(4).value || '').trim();

      if (accountCode && accountCode.length > 0) {
        coa.set(accountCode, { name: accountName, type: accountType });
      }
    });

    console.log(`✅ Loaded ${coa.size} accounts from Chart of Accounts`);
    return coa;
  }

  /**
   * Map GL account code → Cashflow category row name
   * Based on Danh sách + Template analysis
   * 
   * MAPPING:
   * 511.x → Thu dự án (Revenue)
   * 515.3, 515.5 → Thu đầu tư tài chính/R&D
   * 515.2 → Thu khác
   * 711.2 → Thu khác
   * 334.1, 334.2 → Lương dự án
   * 6422.x → Quản lý văn phòng (Admin expense)
   * 6421.2 → Hành chính/Nhân Sự
   * 6422.6 → Kế toán/Tài Chính
   * 6421.3, 6421.4, 6421.5, 6421.6 → Sales
   * 6421.8, 6421.9 → Marketing
   * 154.x → Chi phí đảm bảo chất lượng (QA cost)
   */
  mapAccountToCategory(accountCode: string): string {
    const code = accountCode.trim();

    // REVENUE (THU)
    // 511.x → Thu dự án
    if (code.startsWith('511')) {
      return 'Thu dự án';
    }

    // 515.3, 515.5 → Thu đầu tư tài chính/R&D
    if (code === '515.3') {
      return 'Thu đầu tư tài chính, tiết kiệm';
    }
    if (code === '515.5') {
      return 'Thu đầu tư R&D';
    }

    // 515.2 → Thu khác
    if (code === '515.2') {
      return 'Thu khác';
    }

    // 711.2 → Thu khác
    if (code === '711.2') {
      return 'Thu khác';
    }

    // SALARY (LƯƠNG)
    // 334.1, 334.2 → Lương dự án
    if (code === '334.1' || code === '334.2') {
      return 'Lương dự án';
    }

    // ADMIN EXPENSE (QUẢN LÝ)
    // 6422.x (except 6422.6) → Quản lý văn phòng
    if (code.startsWith('6422') && code !== '6422.6') {
      return 'Quản lý văn phòng';
    }

    // 6421.2 → Hành chính/Nhân Sự
    if (code === '6421.2') {
      return 'Hành chính/ Nhân Sự';
    }

    // 6422.6 → Kế toán/Tài Chính
    if (code === '6422.6') {
      return 'Kế toán/Tài Chính';
    }

    // 6421.3, 6421.4, 6421.5, 6421.6 → Sales
    if (
      code === '6421.3' ||
      code === '6421.4' ||
      code === '6421.5' ||
      code === '6421.6'
    ) {
      return 'Sales';
    }

    // 6421.8, 6421.9 → Marketing
    if (code === '6421.8' || code === '6421.9') {
      return 'Marketing';
    }

    // QA COST (CHI PHÍ ĐẢM BẢO CHẤT LƯỢNG)
    // 154.x → Chi phí đảm bảo chất lượng
    if (code.startsWith('154')) {
      return 'Chi phí đảm bảo chất lượng';
    }

    // Default: Unknown (skip)
    console.log(`⚠️  Unknown account: ${code}`);
    return 'Unknown';
  }

  /**
   * Load Cashflow template row mapping
   * Map category name → Template row number
   */
  async buildCategoryRowMapping(
    templatePath: string,
  ): Promise<Map<string, number>> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);

    const worksheet = workbook.getWorksheet('Cashflow_Misa');
    if (!worksheet) {
      throw new Error('Worksheet "Cashflow_Misa" not found');
    }

    const mapping = new Map<string, number>();

    console.log('🗺️  Building category → row mapping...');

    worksheet.eachRow((row, rowNumber) => {
      const colB = String(row.getCell(2).value || '').trim();

      // Map category names to rows
      const categoryNames = [
        'Thu dự án',
        'Thu đầu tư tài chính, tiết kiệm',
        'Thu đầu tư R&D',
        'Thu khác',
        'Lương dự án',
        'Quản lý bán hàng',
        'Quản lý văn phòng',
        'Chi phí đảm bảo chất lượng',
        'Hành chính/ Nhân Sự',
        'Kế toán/Tài Chính',
        'Sales',
        'Marketing',
        'Hạ tầng IT',
      ];

      if (categoryNames.includes(colB)) {
        mapping.set(colB, rowNumber);
      }
    });

    console.log(`✅ Mapped ${mapping.size} categories to rows`);
    mapping.forEach((rowNum, category) => {
      console.log(`   ${category} → Row ${rowNum}`);
    });

    return mapping;
  }
}
