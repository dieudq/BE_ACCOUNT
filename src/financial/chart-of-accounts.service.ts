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
   * Returns Map<account_code, {name, type, category}>
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
   * Map GL account code → Cashflow category
   * Based on account prefix (111-128 = Cash, 334 = Salary, 515 = Revenue, etc.)
   */
  mapAccountToCategory(
    accountCode: string,
    coa: Map<string, { name: string; type: string }>,
  ): string {
    const code = accountCode.trim();

    // Cash accounts (111-128) → Tiền mặt
    if (code.startsWith('111') || code.startsWith('112')) {
      return 'Tiền mặt';
    }

    // Revenue (511-515) → Thu dự án
    if (code.startsWith('511') || code.startsWith('513') || code.startsWith('515')) {
      return 'Thu dự án';
    }

    // Employee salary (334.x) → Lương dự án
    if (code.startsWith('334')) {
      return 'Lương dự án';
    }

    // Sales expense (6421.x) → Quản lý bán hàng
    if (code.startsWith('6421')) {
      return 'Quản lý bán hàng';
    }

    // Admin expense (6422.x) → Quản lý văn phòng
    if (code.startsWith('6422')) {
      return 'Quản lý văn phòng';
    }

    // Other revenue (711.x) → Thu khác
    if (code.startsWith('711')) {
      return 'Thu khác';
    }

    // Financial expense (635.x) → Lãi/lỗ TG
    if (code.startsWith('635')) {
      return 'Lãi/lỗ TG';
    }

    // Project costs (154.x) → Chi phí dự án
    if (code.startsWith('154')) {
      return 'Chi phí đảm bảo chất lượng';
    }

    // Default to unknown
    return 'Khác';
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
      if (colB === 'Thu dự án') {
        mapping.set('Thu dự án', rowNumber);
      } else if (colB === 'Thu khác') {
        mapping.set('Thu khác', rowNumber);
      } else if (colB === 'Lương dự án') {
        mapping.set('Lương dự án', rowNumber);
      } else if (colB === 'Quản lý bán hàng') {
        mapping.set('Quản lý bán hàng', rowNumber);
      } else if (colB === 'Quản lý văn phòng') {
        mapping.set('Quản lý văn phòng', rowNumber);
      } else if (colB === 'Chi phí đảm bảo chất lượng') {
        mapping.set('Chi phí đảm bảo chất lượng', rowNumber);
      } else if (colB === 'Lãi/lỗ TG') {
        mapping.set('Lãi/lỗ TG', rowNumber);
      }
    });

    console.log(`✅ Mapped ${mapping.size} categories to rows`);
    mapping.forEach((rowNum, category) => {
      console.log(`   ${category} → Row ${rowNum}`);
    });

    return mapping;
  }
}
