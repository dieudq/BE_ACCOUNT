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
   * COMPLETE MAPPING (covers all 80 transactions):
   * 
   * REVENUE (THU):
   * - 511.x, 5118 → Thu dự án
   * - 515.3 → Thu đầu tư tài chính, tiết kiệm
   * - 515.5, 515.4 → Thu đầu tư R&D
   * - 515.2, 711.2 → Thu khác
   * 
   * SALARY (LƯƠNG):
   * - 334.1, 334.2 → Lương dự án
   * - 334.3 → Hành chính/ Nhân Sự
   * - 334.4 → Thưởng (mapped to closest category: Lương dự án)
   * - 334.5, 334.6, 334.7, 334.8 → Sales & specialized roles
   * 
   * ADMIN/OFFICE (QUẢN LÝ):
   * - 6422.x (except 6422.6) → Quản lý văn phòng
   * - 6422.6 → Kế toán/Tài Chính
   * - 6422.5 → Quản lý văn phòng (internal activities)
   * 
   * HR/ADMIN (HÀNH CHÍNH):
   * - 6421.2 → Hành chính/ Nhân Sự
   * - 331 → Hành chính/ Nhân Sự (Social insurance, payroll-related)
   * - 6421-11, 6421-15 → Sales & Marketing (training, recruitment)
   * 
   * SALES:
   * - 6421.3, 6421.4, 6421.5, 6421.6, 6421.7 → Sales
   * - 6421-19 → Sales (Commission)
   * 
   * MARKETING:
   * - 6421.8, 6421.9 → Marketing
   * 
   * QA COST (CHI PHÍ ĐẢM BẢO CHẤT LƯỢNG):
   * - 154.x → Chi phí đảm bảo chất lượng
   * 
   * BALANCE SHEET ACCOUNTS (Asset/Liability - not expenses):
   * - 1111, 1113, 1121.1, 1121.7 → Cash accounts (map to revenue/asset category or skip)
   * - 131.1, 131.2 → AR (Accounts Receivable - map to revenue tracking)
   * - 2411 → Fixed asset/Liability (skip or map based on transaction context)
   * - 811 → Cost of goods sold / Other expense (map to appropriate category)
   */
  mapAccountToCategory(accountCode: string): string {
    const code = accountCode.trim();

    // REVENUE (THU)
    // 511.x, 5118 → Thu dự án (Project Revenue)
    if (code.startsWith('511') || code === '5118') {
      return 'Thu dự án';
    }

    // 515.3 → Thu đầu tư tài chính (Financial investment income)
    if (code === '515.3') {
      return 'Thu đầu tư tài chính, tiết kiệm';
    }

    // 515.5, 515.4 → Thu đầu tư R&D
    if (code === '515.5' || code === '515.4') {
      return 'Thu đầu tư R&D';
    }

    // 515.2, 711.2 → Thu khác (Other income)
    if (code === '515.2' || code === '711.2') {
      return 'Thu khác';
    }

    // SALARY & WAGE (LƯƠNG)
    // 334.1, 334.2 → Lương dự án (Project salary - main employees)
    if (code === '334.1' || code === '334.2') {
      return 'Lương dự án';
    }

    // 334.3 → Hành chính/ Nhân Sự (Accounting staff salary)
    if (code === '334.3') {
      return 'Hành chính/ Nhân Sự';
    }

    // 334.4 → Lương dự án (Bonus - related to project)
    if (code === '334.4') {
      return 'Lương dự án';
    }

    // 334.5 → Hành chính/ Nhân Sự (HR staff salary)
    if (code === '334.5') {
      return 'Hành chính/ Nhân Sự';
    }

    // 334.6 → Sales (Sales staff salary)
    if (code === '334.6') {
      return 'Sales';
    }

    // 334.7 → Marketing (Marketing staff salary)
    if (code === '334.7') {
      return 'Marketing';
    }

    // 334.8 → Hành chính/ Nhân Sự (Admin/CSH staff)
    if (code === '334.8') {
      return 'Hành chính/ Nhân Sự';
    }

    // 331 → Hành chính/ Nhân Sự (Social insurance & benefits)
    if (code === '331') {
      return 'Hành chính/ Nhân Sự';
    }

    // ADMIN EXPENSE (QUẢN LÝ VĂN PHÒNG)
    // 6422.x (except 6422.6) → Quản lý văn phòng
    if (code.startsWith('6422') && code !== '6422.6') {
      return 'Quản lý văn phòng';
    }

    // 6422.6 → Kế toán/Tài Chính (Accounting staff salary)
    if (code === '6422.6') {
      return 'Kế toán/Tài Chính';
    }

    // 6421.2 → Hành chính/ Nhân Sự (HR sales/general)
    if (code === '6421.2') {
      return 'Hành chính/ Nhân Sự';
    }

    // 6421.3, 6421.4, 6421.5, 6421.6, 6421.7 → Sales
    if (
      code === '6421.3' ||
      code === '6421.4' ||
      code === '6421.5' ||
      code === '6421.6' ||
      code === '6421.7'
    ) {
      return 'Sales';
    }

    // 6421.8, 6421.9 → Marketing
    if (code === '6421.8' || code === '6421.9') {
      return 'Marketing';
    }

    // 6421-11 → Sales (Equipment investment)
    if (code === '6421-11') {
      return 'Sales';
    }

    // 6421-15 → Marketing (Marketing staff salary)
    if (code === '6421-15') {
      return 'Marketing';
    }

    // 6421-19 → Sales (Commission/Sales bonus)
    if (code === '6421-19') {
      return 'Sales';
    }

    // QA COST (CHI PHÍ ĐẢM BẢO CHẤT LƯỢNG)
    // 154.x → Chi phí đảm bảo chất lượng
    if (code.startsWith('154')) {
      return 'Chi phí đảm bảo chất lượng';
    }

    // BALANCE SHEET ACCOUNTS (these are typically not categorized in cashflow)
    // 1111, 1113 → Cash (Tiền mặt) - skip or treat as "Other"
    // 1121.1, 1121.7 → Bank deposits - skip
    // 131.1, 131.2 → AR (should not appear in expense/revenue GL summary)
    // 2411 → Fixed assets - skip
    // 811 → COGS/Loss & Gain (map to other or skip)
    if (code === '811' || code === '1111' || code === '1113' || 
        code === '1121.1' || code === '1121.7' || code === '131.1' || 
        code === '131.2' || code === '2411') {
      // These are balance sheet accounts, not operational expenses/revenue
      // Map to a generic "Other" category or skip
      // For now, map COGS (811) to a reasonable category
      if (code === '811') {
        return 'Chi phí đảm bảo chất lượng'; // Map COGS to QA as it's closest to project costs
      }
      // Skip balance sheet items (they don't belong in cashflow analysis)
      return 'Unknown';
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
