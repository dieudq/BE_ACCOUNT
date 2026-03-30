import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

export interface GLAccountRecord {
  date: Date;
  voucherDate: Date;
  voucherNo: string;
  description: string;
  counterAccount: string;
  debitAmount: number;
  creditAmount: number;
}

export interface ParsedGLData {
  sheetName: string;
  accounts: Map<string, { debit: number; credit: number }>;
  records: GLAccountRecord[];
  period: string;
  currency: string;
}

@Injectable()
export class GLFileParserService {
  /**
   * Parse GL Account Detail Excel file
   * Format: Single account header (Tài khoản: 1111) + all transactions
   * Extract counter-account (TK đối ứng) to categorize expenses/revenue
   * 
   * Column mapping:
   * 1=Ngày hạch toán, 2=Ngày chứng từ, 3=Số chứng từ, 4=Diễn giải, 5=TK đối ứng, 6=Phát sinh Nợ, 7=Phát sinh Có
   */
  async parseGLFile(filePath: string): Promise<ParsedGLData> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('No worksheet found in Excel file');
    }

    const data: ParsedGLData = {
      sheetName: worksheet.name,
      accounts: new Map(),
      records: [],
      period: '',
      currency: 'VND',
    };

    let headerRow = 0;

    // Scan rows to find headers and extract data
    worksheet.eachRow((row, rowNumber) => {
      const values = row.values as (string | number | Date | null)[];

      // Skip empty rows
      if (!values || values.length === 0) return;

      // Look for header row (contains "Ngày hạch toán")
      if (!headerRow && values.some((v) => String(v).includes('Ngày hạch toán'))) {
        headerRow = rowNumber;
        console.log(`   Found header at row ${headerRow}`);
        return;
      }

      // Extract period info from row 2 (e.g., "Loại tiền: <<Tổng hợp>>, Tháng 1 năm 2026")
      if (!data.period && rowNumber === 2) {
        const periodStr = String(values[1] || values[2] || '');
        const match = periodStr.match(/Tháng (\d+) năm (\d+)/);
        if (match) {
          data.period = `${match[2]}-${String(match[1]).padStart(2, '0')}`;
          console.log(`   Period: ${data.period}`);
        }
      }

      // Skip rows before header
      if (!headerRow || rowNumber <= headerRow) return;

      // Extract GL transaction data
      // Values: [date, voucherDate, voucherNo, description, counterAccount, debit, credit]
      if (values.length >= 7) {
        const dateVal = values[1];
        const voucherDateVal = values[2];
        const voucherNo = String(values[3] || '');
        const description = String(values[4] || '');
        const counterAccount = String(values[5] || '').trim(); // TK đối ứng
        const debitStr = String(values[6] || '0');
        const creditStr = String(values[7] || '0');

        // Parse amounts
        const debitAmount = this.parseAmount(debitStr);
        const creditAmount = this.parseAmount(creditStr);

        // Skip empty rows / summary rows
        if (!counterAccount || (debitAmount === 0 && creditAmount === 0)) {
          return;
        }

        // Use counter-account as the GL account key
        // This groups all GL transactions by their opposing account
        if (!data.accounts.has(counterAccount)) {
          data.accounts.set(counterAccount, { debit: 0, credit: 0 });
        }

        const record: GLAccountRecord = {
          date: this.parseDate(dateVal),
          voucherDate: this.parseDate(voucherDateVal),
          voucherNo,
          description,
          counterAccount,
          debitAmount,
          creditAmount,
        };

        data.records.push(record);

        // Aggregate by counter-account
        const account = data.accounts.get(counterAccount);
        if (account) {
          account.debit += debitAmount;
          account.credit += creditAmount;
        }
      }
    });

    console.log(`✅ Parsed GL file: ${data.sheetName}`);
    console.log(`   Period: ${data.period}`);
    console.log(`   Total accounts found: ${data.accounts.size}`);
    console.log(`   Accounts:`);
    data.accounts.forEach((amounts, account) => {
      console.log(
        `     ${account}: Debit=${amounts.debit.toLocaleString('vi-VN')}, Credit=${amounts.credit.toLocaleString('vi-VN')}`,
      );
    });
    return data;
  }

  /**
   * Parse amount from string (handles Vietnamese number format)
   */
  private parseAmount(value: string | number | null): number {
    if (!value) return 0;

    const str = String(value).trim();
    if (!str || str === '-') return 0;

    // Remove comma thousands separator, convert to number
    const cleaned = str.replace(/,/g, '').replace(/\./g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Parse date from various formats
   */
  private parseDate(value: string | number | Date | null): Date {
    if (!value) return new Date();

    if (value instanceof Date) {
      return value;
    }

    // Try to parse string
    const str = String(value).trim();
    if (!str) return new Date();

    // Try standard date parsing
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    // Fallback to today
    return new Date();
  }

  /**
   * Export parsed data for testing
   */
  async exportParsedData(data: ParsedGLData, outputPath: string): Promise<void> {
    const report = {
      sheetName: data.sheetName,
      period: data.period,
      totalAccounts: data.accounts.size,
      totalRecords: data.records.length,
      accounts: Object.fromEntries(data.accounts),
      sampleRecords: data.records.slice(0, 5),
    };

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`📄 Parsed data exported to: ${outputPath}`);
  }
}
